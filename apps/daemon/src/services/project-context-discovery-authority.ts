import type Database from 'better-sqlite3';
import type {
  ProjectContextDiscoveryCoverageScope, ProjectContextDiscoveryRequest,
  ProjectContextDiscoveryWorkspaceScope, WorkspaceDirectoryItem,
} from '@open-design/contracts';
import { enforceLocalProjectDataPlaneRequest } from '../collab/project-request-authority.js';
import type { WorkspaceResourceAccessInput } from '../collab/workspace-resource-mutation.js';
import type { WorkspaceDirectoryFetchResult } from '../collab/vela-workspace-context.js';
import {
  PROJECT_CONTEXT_DISCOVERY_LIMITS,
  type ProjectContextDiscoveryProject,
} from './project-context-discovery.js';

export const PROJECT_CONTEXT_DISCOVERY_MAX_SCOPES = 128;
// Fail closed instead of trusting a prefix that could omit a conflicting row.
const MAX_DIRECTORY_ROWS = 2_048;

export class ProjectContextDiscoveryAuthorityError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 503,
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) { super(message); }
}

export interface ProjectContextDiscoveryHeaders {
  get(name: string): string | undefined;
}

export interface ProjectContextDiscoveryCatalog {
  projects: ProjectContextDiscoveryProject[];
  coverageScope: ProjectContextDiscoveryCoverageScope;
  scanTruncated: boolean;
  /** Opaque operation witness; never serialized in the HTTP response. */
  fingerprint: string;
  isProjectAuthorized(project: ProjectContextDiscoveryProject): boolean;
}

export interface ProjectContextDiscoveryAuthority {
  collect(req: ProjectContextDiscoveryHeaders, input: ProjectContextDiscoveryRequest): Promise<ProjectContextDiscoveryCatalog>;
}

interface AuthorityDependencies {
  db: Database.Database;
  /** The existing account-scoped broker's fresh read, never its cached read. */
  fetchWorkspaceDirectory?: () => Promise<WorkspaceDirectoryFetchResult>;
  authorityIdentity?: () => string;
  getProject(db: unknown, projectId: string): Omit<ProjectContextDiscoveryProject, 'workspaceScope'> | null | undefined;
  getWorkspaceProject(db: unknown, workspaceId: string, projectId: string): WorkspaceResourceAccessInput | null | undefined;
  getWorkspaceProjectByProjectId(db: unknown, projectId: string): WorkspaceResourceAccessInput | null | undefined;
  isProjectRevoked(projectId: string): boolean;
}

function requestedScope(req: ProjectContextDiscoveryHeaders, input: ProjectContextDiscoveryRequest):
  Pick<ProjectContextDiscoveryWorkspaceScope, 'workspaceId' | 'workspaceMemberId'> | null {
  const headerWorkspace = req.get('x-od-workspace-id');
  const headerMember = req.get('x-od-workspace-member-id');
  const hasHeaders = headerWorkspace !== undefined || headerMember !== undefined;
  const validId = (value: string | undefined): value is string =>
    typeof value === 'string' && value.length > 0 && value.length <= 256
    && value === value.trim() && !/[\u0000-\u001f\u007f,]/u.test(value);
  if (hasHeaders && (!validId(headerWorkspace) || !validId(headerMember))) {
    throw new ProjectContextDiscoveryAuthorityError(400, 'WORKSPACE_CONTEXT_INCOMPLETE',
      'both workspace and member identity headers are required');
  }
  const hasBody = input.workspaceId !== undefined || input.workspaceMemberId !== undefined;
  if (hasBody && (!validId(input.workspaceId) || !validId(input.workspaceMemberId))) {
    throw new ProjectContextDiscoveryAuthorityError(400, 'WORKSPACE_CONTEXT_INCOMPLETE',
      'both workspace and member identity are required');
  }
  if (hasHeaders && hasBody
    && (headerWorkspace !== input.workspaceId || headerMember !== input.workspaceMemberId)) {
    throw new ProjectContextDiscoveryAuthorityError(400, 'WORKSPACE_CONTEXT_CONFLICT',
      'workspace header and discovery scope must match');
  }
  if (hasBody) return { workspaceId: input.workspaceId!, workspaceMemberId: input.workspaceMemberId! };
  if (hasHeaders) return { workspaceId: headerWorkspace!, workspaceMemberId: headerMember! };
  return null;
}

function scopedRequest(scope: ProjectContextDiscoveryWorkspaceScope | null): ProjectContextDiscoveryHeaders {
  return {
    get(name) {
      if (name.toLowerCase() === 'x-od-workspace-id') return scope?.workspaceId;
      if (name.toLowerCase() === 'x-od-workspace-member-id') return scope?.workspaceMemberId;
      return undefined;
    },
  };
}

function scopeFor(item: WorkspaceDirectoryItem): ProjectContextDiscoveryWorkspaceScope {
  return {
    workspaceId: item.workspaceId, workspaceMemberId: item.workspaceMemberId,
    workspaceName: item.workspaceName, workspaceType: item.workspaceType,
  };
}

function authorityChanged(): never {
  throw new ProjectContextDiscoveryAuthorityError(503, 'WORKSPACE_AUTHORITY_UNAVAILABLE',
    'project discovery authority changed or is inconsistent; retry discovery', true);
}

/** Conflicting duplicate rows cannot choose a surviving identity by order. */
function consistentDirectory(items: WorkspaceDirectoryItem[]): WorkspaceDirectoryItem[] {
  if (items.length > MAX_DIRECTORY_ROWS) {
    throw new ProjectContextDiscoveryAuthorityError(503, 'WORKSPACE_AUTHORITY_UNAVAILABLE',
      'workspace membership directory exceeds the safe discovery limit');
  }
  const byWorkspace = new Map<string, { item: WorkspaceDirectoryItem; witness: string }>();
  for (const item of items) {
    const witness = JSON.stringify([item.workspaceId, item.workspaceMemberId, item.workspaceName,
      item.workspaceType, item.role, item.memberStatus, item.lifecycleState]);
    const previous = byWorkspace.get(item.workspaceId);
    if (previous && previous.witness !== witness) authorityChanged();
    if (!previous) byWorkspace.set(item.workspaceId, { item, witness });
  }
  return [...byWorkspace.values()].map(({ item }) => item);
}

/** Membership grants the identity; persisted bindings only choose its namespace. */
export function createProjectContextDiscoveryAuthority(deps: AuthorityDependencies): ProjectContextDiscoveryAuthority {
  return {
    async collect(req, input) {
      const explicit = requestedScope(req, input);
      const identity = deps.authorityIdentity?.();
      const identityCurrent = () => deps.authorityIdentity?.() === identity;
      let scopes: ProjectContextDiscoveryWorkspaceScope[] = [];
      let scanTruncated = false;
      let coverageScope: ProjectContextDiscoveryCoverageScope = 'unbound_local';
      if (!deps.fetchWorkspaceDirectory) {
        if (explicit) {
          throw new ProjectContextDiscoveryAuthorityError(503, 'WORKSPACE_AUTHORITY_UNAVAILABLE',
            'workspace discovery requires an authoritative membership directory; unscoped discovery can inspect unbound local projects');
        }
      } else {
        const directory = await deps.fetchWorkspaceDirectory().catch(() => ({ ok: false, items: [] } as WorkspaceDirectoryFetchResult));
        if (!identityCurrent()) authorityChanged();
        if (!directory.ok) {
          if (directory.reason === 'unauthorized') {
            throw new ProjectContextDiscoveryAuthorityError(401, 'AMR_AUTH_REQUIRED',
              'AMR authorization expired. Sign in again to continue.');
          }
          throw new ProjectContextDiscoveryAuthorityError(503, 'WORKSPACE_AUTHORITY_UNAVAILABLE',
            'workspace membership authority is temporarily unavailable', true);
        }
        // A discovery result must be immediately usable. Locked/deleting and
        // removed memberships are not an invitation to fall back to local reads.
        const active = consistentDirectory(directory.items).filter((item) => item.memberStatus === 'active' && item.lifecycleState === 'active');
        if (explicit) {
          const membership = active.find((item) => item.workspaceId === explicit.workspaceId
            && item.workspaceMemberId === explicit.workspaceMemberId);
          if (!membership) {
            throw new ProjectContextDiscoveryAuthorityError(403, 'WORKSPACE_ACCESS_DENIED',
              'the requested workspace is not available to this member');
          }
          scopes = [scopeFor(membership)];
          coverageScope = 'explicit_workspace';
        } else {
          const seen = new Set<string>();
          for (const membership of active) {
            const key = JSON.stringify([membership.workspaceId, membership.workspaceMemberId]);
            if (seen.has(key)) continue;
            seen.add(key);
            if (scopes.length === PROJECT_CONTEXT_DISCOVERY_MAX_SCOPES) {
              scanTruncated = true;
              break;
            }
            scopes.push(scopeFor(membership));
          }
          coverageScope = 'authorized_projects';
        }
      }

      const limit = PROJECT_CONTEXT_DISCOVERY_LIMITS.maxScannedProjects;
      // Read only bounded catalog IDs before access checks. In particular no
      // codebase binding, project name, or filesystem path establishes identity.
      const ids = input.projectId ? [{ id: input.projectId }] : deps.db.prepare(
        'SELECT id FROM projects ORDER BY updated_at DESC, id ASC LIMIT ?',
      ).all(limit + 1) as Array<{ id: string }>;
      if (ids.length > limit) scanTruncated = true;
      const projects: ProjectContextDiscoveryProject[] = [];
      const witnesses = new Map<ProjectContextDiscoveryProject, string>();
      const localWitness = (id: string, scope: ProjectContextDiscoveryWorkspaceScope | null): string | null => {
        if (!identityCurrent() || deps.isProjectRevoked(id)) return null;
        const binding = deps.getWorkspaceProjectByProjectId(deps.db, id);
        if ((binding?.workspaceId ?? null) !== (scope?.workspaceId ?? null)) return null;
        if (!deps.db.prepare('SELECT 1 FROM projects WHERE id = ?').get(id)) return null;
        const row = scope ? deps.getWorkspaceProject(deps.db, scope.workspaceId, id) : null;
        return JSON.stringify([binding ?? null, row ?? null]);
      };
      for (const { id } of ids.slice(0, limit)) {
        if (deps.isProjectRevoked(id)) continue;
        const binding = deps.getWorkspaceProjectByProjectId(deps.db, id);
        const matching = binding?.workspaceId
          ? scopes.filter((scope) => scope.workspaceId === binding.workspaceId)
          : explicit ? [] : [null];
        for (const workspaceScope of matching) {
          const witness = localWitness(id, workspaceScope);
          if (witness === null) continue;
          const allowed = await enforceLocalProjectDataPlaneRequest({
            db: deps.db, req: scopedRequest(workspaceScope), projectId: id,
            options: { mode: 'read' }, getWorkspaceProject: deps.getWorkspaceProject,
            getWorkspaceProjectByProjectId: deps.getWorkspaceProjectByProjectId,
          });
          if (!allowed || localWitness(id, workspaceScope) !== witness) continue;
          const project = deps.getProject(deps.db, id);
          if (project) {
            const authorized = { ...project, workspaceScope };
            projects.push(authorized);
            witnesses.set(authorized, witness);
          }
        }
      }
      if (!identityCurrent()) authorityChanged();
      return {
        projects, coverageScope, scanTruncated,
        fingerprint: JSON.stringify([identity, scopes, coverageScope, scanTruncated,
          projects.map((project) => [project.id, project.name, project.metadata, project.workspaceScope, witnesses.get(project)])]),
        // Synchronous equality preserves the existing gate's exact decision,
        // without inventing another permission policy or yielding before I/O.
        isProjectAuthorized: (project) => witnesses.has(project)
          && localWitness(project.id, project.workspaceScope) === witnesses.get(project),
      };
    },
  };
}
