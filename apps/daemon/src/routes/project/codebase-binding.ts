import type { Express, Request, Response } from 'express';
import { projectCodebaseBindingRequestSchema, type ProjectCodebaseBindingSelection } from '@open-design/contracts';
import type { RouteDeps } from '../../server-context.js';
import type { DesktopImportTokenVerification } from '../../desktop-auth.js';
import { enforceLocalProjectDataPlaneRequest } from '../../collab/project-request-authority.js';
import {
  codebaseBindingStatus,
  CodebaseBindingValidationError,
  validateCodebaseBinding,
} from '../../services/codebase-binding.js';
import {
  CodebaseBindingConflictError,
  getCodebaseBinding,
  saveCodebaseBinding,
} from '../../storage/codebase-binding.js';

interface BindingAuth {
  consumedImportNonces: Map<string, number>;
  desktopAuthSecret: () => Buffer | null;
  isDesktopAuthGateActive: () => boolean;
  pruneExpiredImportNonces: (now: number) => void;
  verifyDesktopImportToken: (
    secret: Buffer, sourceRoot: string, token: string, now: number,
    consumedNonces: Map<string, number>,
  ) => DesktopImportTokenVerification;
}

export interface RegisterProjectCodebaseBindingRoutesDeps
  extends RouteDeps<'db' | 'http' | 'paths' | 'projectStore' | 'authorizeProjectRequest'> {
  auth: BindingAuth;
}

export function registerProjectCodebaseBindingRoutes(app: Express, ctx: RegisterProjectCodebaseBindingRoutesDeps): void {
  const { db, auth, authorizeProjectRequest } = ctx;
  const { sendApiError } = ctx.http;
  const { getProject, getWorkspaceProject, getWorkspaceProjectByProjectId } = ctx.projectStore;
  const paths = { projectsRoot: ctx.paths.PROJECTS_DIR, runtimeDataRoot: ctx.paths.RUNTIME_DATA_DIR_CANONICAL };
  const route = '/api/projects/:id/codebase-binding';

  function trust(req: Request, res: Response, sourceRoot: string):
    { nonce: string; exp: number } | true | false {
    if (!auth.isDesktopAuthGateActive()) return true;
    const secret = auth.desktopAuthSecret();
    if (secret === null) {
      sendApiError(res, 503, 'DESKTOP_AUTH_PENDING', 'Desktop authorization is not ready. Restart desktop or wait for registration.', { retryable: true });
      return false;
    }
    const now = Date.now();
    auth.pruneExpiredImportNonces(now);
    const verification = auth.verifyDesktopImportToken(secret, sourceRoot,
      req.get('x-od-desktop-import-token') ?? '', now, auth.consumedImportNonces);
    if (!verification.ok) {
      sendApiError(res, 403, 'FORBIDDEN', 'Choose the source folder again to authorize this connection.',
        { details: { reason: verification.reason } });
      return false;
    }
    return verification;
  }

  function failure(res: Response, error: unknown): void {
    if (error instanceof CodebaseBindingConflictError) {
      sendApiError(res, 409, error.unsupported ? 'CODEBASE_BINDING_UNSUPPORTED' : 'CODEBASE_BINDING_CONFLICT', error.message);
    } else if (error instanceof CodebaseBindingValidationError) {
      sendApiError(res, 400, 'BAD_REQUEST', error.message, { details: { reason: error.reason } });
    } else {
      sendApiError(res, 500, 'INTERNAL_ERROR', 'The codebase connection could not be read or saved. Try again.');
    }
  }

  function scope(req: Request) {
    const workspaceId = req.get('x-od-workspace-id');
    const workspaceMemberId = req.get('x-od-workspace-member-id');
    return workspaceId && workspaceMemberId ? { workspaceScope: { workspaceId, workspaceMemberId } } : {};
  }

  app.get(route, async (req, res) => {
    try {
      const id = req.params.id as string;
      if (!await authorizeProjectRequest(req, res, id, { mode: 'read' })) return;
      const project = getProject(db, id);
      if (!project) return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      const writable = await enforceLocalProjectDataPlaneRequest({
        req, db, projectId: id, getWorkspaceProject, getWorkspaceProjectByProjectId,
        options: { mode: 'write', capability: 'writeFiles' },
      });
      res.json({ ...scope(req), ...await codebaseBindingStatus(db, project, paths, {
        canBind: writable && !project.metadata?.sharedProjectPlaceholderAt
          && (!auth.isDesktopAuthGateActive() || auth.desktopAuthSecret() !== null),
        requiresTrustedPicker: auth.isDesktopAuthGateActive(),
      }) });
    } catch (error) { failure(res, error); }
  });

  async function saveOrValidate(req: Request, res: Response, persist: boolean): Promise<void> {
    try {
      const id = req.params.id as string;
      if (!await authorizeProjectRequest(req, res, id, { mode: 'write', capability: 'writeFiles' })) return;
      const project = getProject(db, id);
      if (!project) { sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found'); return; }
      const parsed = projectCodebaseBindingRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        sendApiError(res, 400, 'BAD_REQUEST', 'Provide sourceRoot, an optional appRelativePath, and expectedRevision (null for a new connection).');
        return;
      }
      const input = parsed.data;
      if (!trust(req, res, input.sourceRoot)) return;
      const previous = getCodebaseBinding(db, id);
      if (previous && previous.schemaVersion !== 1) throw new CodebaseBindingConflictError(true);
      if ((previous?.revision ?? null) !== input.expectedRevision) throw new CodebaseBindingConflictError();
      const selection = await validateCodebaseBinding(project, paths, input);
      if (input.expectedSelection && input.expectedSelection !== selection.selectionFingerprint) {
        sendApiError(res, 409, 'CODEBASE_BINDING_CONFLICT', 'The selected folder changed after validation. Choose it again before saving.');
        return;
      }
      if (!persist) {
        const body: ProjectCodebaseBindingSelection = {
          sourceRoot: selection.sourceRoot, appRelativePath: selection.appRelativePath, appRoot: selection.appRoot,
          selectionFingerprint: selection.selectionFingerprint,
        };
        res.json(body);
        return;
      }
      // Validation awaits filesystem I/O. Recheck the nonce immediately before
      // the synchronous CAS so two simultaneous requests cannot reuse it.
      const authorization = trust(req, res, input.sourceRoot);
      if (!authorization) return;
      saveCodebaseBinding(db, id, input.expectedRevision, selection);
      if (authorization !== true) auth.consumedImportNonces.set(authorization.nonce, authorization.exp);
      res.json({ ...scope(req), ...await codebaseBindingStatus(db, project, paths, {
        canBind: true, requiresTrustedPicker: auth.isDesktopAuthGateActive(),
      }) });
    } catch (error) { failure(res, error); }
  }

  app.post(`${route}/validate`, (req, res) => saveOrValidate(req, res, false));
  app.put(route, (req, res) => saveOrValidate(req, res, true));
}
