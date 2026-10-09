import type { Express, Request } from 'express';
import { projectSourceContextResolveRequestSchema } from '@open-design/contracts';
import type { RouteDeps } from '../../server-context.js';
import {
  readProjectSourceContext,
  resolveProjectSourceContext,
  type ProjectSourceContextProject,
} from '../../services/project-source-context.js';

export interface ProjectSourceContextRouteServices {
  /** Only projects the actual request may read, including local revocation rules. */
  listAuthorizedProjects(req: Request): Promise<ProjectSourceContextProject[]>;
}

export interface RegisterProjectSourceContextRoutesDeps
  extends RouteDeps<'db' | 'http' | 'paths' | 'projectStore' | 'authorizeProjectRequest'> {
  sourceContext: ProjectSourceContextRouteServices;
}

export function registerProjectSourceContextRoutes(app: Express, ctx: RegisterProjectSourceContextRoutesDeps): void {
  const { db, authorizeProjectRequest, sourceContext } = ctx;
  const { sendApiError } = ctx.http;
  const paths = {
    projectsRoot: ctx.paths.PROJECTS_DIR,
    runtimeDataRoot: ctx.paths.RUNTIME_DATA_DIR_CANONICAL,
  };

  app.get('/api/projects/:id/source-context', async (req, res) => {
    try {
      const id = req.params.id as string;
      // Authorization must precede project/binding metadata and all source I/O.
      if (!await authorizeProjectRequest(req, res, id, { mode: 'read' })) return;
      const project = ctx.projectStore.getProject(db, id);
      if (!project) return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      const query = req.query.query;
      if (Object.keys(req.query).some((key) => key !== 'query')
        || (query !== undefined && (typeof query !== 'string' || query.length > 2000))) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'query must be a string of at most 2000 characters');
      }
      res.json(await readProjectSourceContext(db, project, paths, {
        ...(typeof query === 'string' ? { query } : {}),
      }));
    } catch {
      sendApiError(res, 500, 'INTERNAL_ERROR', 'The connected source context could not be read. Try again.');
    }
  });

  app.post('/api/projects/source-context/resolve', async (req, res) => {
    try {
      const parsed = projectSourceContextResolveRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'Provide sourceRoot, an optional appRelativePath, optional stable projectId, and an optional query (at most 2000 characters).');
      }
      const input = parsed.data;
      if (input.projectId
        && !await authorizeProjectRequest(req, res, input.projectId, { mode: 'read' })) return;
      // Candidate filtering uses the real request's authority, never binding
      // metadata as a caller identity. The service sees no rejected projects.
      const projects = await sourceContext.listAuthorizedProjects(req);
      res.json(await resolveProjectSourceContext(db, projects, paths, input));
    } catch {
      sendApiError(res, 500, 'INTERNAL_ERROR', 'The connected project could not be resolved. Try again.');
    }
  });
}
