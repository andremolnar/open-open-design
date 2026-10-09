import type { Express } from 'express';
import { projectContextDiscoveryRequestSchema } from '@open-design/contracts';
import type { RouteDeps } from '../../server-context.js';
import { discoverProjectContext } from '../../services/project-context-discovery.js';
import { getCodebaseBinding } from '../../storage/codebase-binding.js';
import { ProjectContextDiscoveryAuthorityError } from '../../services/project-context-discovery-authority.js';

export interface RegisterProjectContextDiscoveryRoutesDeps
  extends RouteDeps<'db' | 'http' | 'paths' | 'contextDiscovery'> {}

export function registerProjectContextDiscoveryRoutes(app: Express, ctx: RegisterProjectContextDiscoveryRoutesDeps): void {
  app.post('/api/projects/source-context/discover', async (req, res) => {
    const { sendApiError } = ctx.http;
    const parsed = projectContextDiscoveryRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendApiError(res, 400, 'BAD_REQUEST',
        'Provide cwd, an optional stable projectId, and optionally workspaceId and workspaceMemberId together.');
    }
    if (Object.keys(req.query).length > 0) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'Discovery scope and cwd must be supplied in the request body.');
    }
    try {
      const catalog = await ctx.contextDiscovery.collect(req, parsed.data);
      const { projects, coverageScope, scanTruncated } = catalog;
      const changed = (): never => {
        throw new ProjectContextDiscoveryAuthorityError(503, 'WORKSPACE_AUTHORITY_UNAVAILABLE',
          'project discovery authority changed; retry discovery', true);
      };
      const isProjectAuthorized = (project: typeof projects[number]): boolean => {
        if (!catalog.isProjectAuthorized(project)) changed();
        return true;
      };
      const result = await discoverProjectContext(ctx.db, projects, {
        projectsRoot: ctx.paths.PROJECTS_DIR, runtimeDataRoot: ctx.paths.RUNTIME_DATA_DIR_CANONICAL,
      }, parsed.data, { coverageScope, scanTruncated, isProjectAuthorized });
      // Filesystem checks yield. Revalidate fresh account membership and the
      // complete authorized catalog before releasing any labels or source paths.
      projects.forEach(isProjectAuthorized);
      const bindingWitnesses = result.candidates.map((candidate) =>
        JSON.stringify(getCodebaseBinding(ctx.db, candidate.projectId)));
      const current = await ctx.contextDiscovery.collect(req, parsed.data);
      if (current.fingerprint !== catalog.fingerprint) changed();
      projects.forEach(isProjectAuthorized);
      // The fresh membership lookup also yielded: retain the service's binding
      // race fence without starting a second round of filesystem reads.
      if (result.candidates.some((candidate, index) =>
        JSON.stringify(getCodebaseBinding(ctx.db, candidate.projectId)) !== bindingWitnesses[index])) changed();
      res.json(result);
    } catch (error) {
      if (error instanceof ProjectContextDiscoveryAuthorityError) {
        return sendApiError(res, error.status, error.code, error.message,
          error.retryable ? { retryable: true } : {});
      }
      return sendApiError(res, 500, 'INTERNAL_ERROR', 'Project context could not be discovered. Try again.');
    }
  });
}
