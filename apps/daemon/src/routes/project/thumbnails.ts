import type { Express } from 'express';
import type { ProjectThumbnailRequest } from '@open-design/contracts';
import type { RouteDeps } from '../../server-context.js';
import { requestWithWorkspaceNavigationScope, workspaceResourceContextFromRequest } from '../../collab/workspace-resource-mutation.js';
import { createProjectThumbnailCache } from '../../services/project-thumbnail-cache.js';
import { freezeProjectThumbnailSource } from '../../artifacts/project-thumbnail-source.js';

export interface RegisterProjectThumbnailRoutesDeps extends RouteDeps<'db' | 'http' | 'paths' | 'projectStore' | 'authorizeProjectRequest' | 'liveArtifacts'> {
  renderProjectThumbnail?: ((html: string) => Promise<Buffer>) | null;
}

export function registerProjectThumbnailRoutes(app: Express, ctx: RegisterProjectThumbnailRoutesDeps): void {
  const cache = createProjectThumbnailCache({ dataRoot: ctx.paths.RUNTIME_DATA_DIR, render: ctx.renderProjectThumbnail ?? null });
  app.get('/api/projects/:id/thumbnail', async (req, res) => {
    const projectId = String(req.params.id);
    const authorized = async () => {
      const project = ctx.projectStore.getProject(ctx.db, projectId);
      if (!project || project.metadata?.teamMirrorRevokedAt) {
        ctx.http.sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
        return null;
      }
      if (!await ctx.authorizeProjectRequest(req, res, projectId, { mode: 'read', allowNavigationQuery: true })) return null;
      return project;
    };
    const project = await authorized();
    if (!project) return;
    const projectRootBinding = project.metadata?.baseDir ?? null;
    const fileName = typeof req.query.fileName === 'string' ? req.query.fileName : '';
    const liveArtifactId = typeof req.query.liveArtifactId === 'string' ? req.query.liveArtifactId : '';
    if ((!fileName && !liveArtifactId) || (fileName && liveArtifactId) || fileName.length > 2048 || liveArtifactId.length > 128 || (fileName && !/\.html?$/i.test(fileName))) {
      return ctx.http.sendApiError(res, 400, 'BAD_REQUEST', 'one HTML fileName or liveArtifactId is required');
    }
    const source: ProjectThumbnailRequest = fileName ? { fileName } : { liveArtifactId };
    const scoped = requestWithWorkspaceNavigationScope(req);
    const workspace = scoped === 'conflict' ? null : workspaceResourceContextFromRequest(scoped);
    const identity = JSON.stringify([workspace, projectId, projectRootBinding, source]);
    try {
      const image = await cache.get({
        identity,
        read: async () => {
          let html: string | undefined;
          if (source.liveArtifactId) {
            const preview = await ctx.liveArtifacts.ensureLiveArtifactPreview({ projectsRoot: ctx.paths.PROJECTS_DIR, projectId, artifactId: source.liveArtifactId });
            html = preview.html;
          }
          return freezeProjectThumbnailSource({ projectsRoot: ctx.paths.PROJECTS_DIR, projectId, fileName: source.fileName ?? 'index.html', metadata: project.metadata, ...(html === undefined ? {} : { html }) });
        },
      });
      // A capture can outlive a share revocation or a queued request's session.
      const currentProject = await authorized();
      if (!currentProject) return;
      if ((currentProject.metadata?.baseDir ?? null) !== projectRootBinding) {
        return ctx.http.sendApiError(res, 409, 'THUMBNAIL_UNAVAILABLE', 'project changed during capture');
      }
      res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'private, no-cache', ETag: image.etag, 'X-Content-Type-Options': 'nosniff' });
      if (req.headers['if-none-match'] === image.etag) return res.status(304).end();
      return res.send(image.bytes);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'thumbnail unavailable';
      const code = (error as NodeJS.ErrnoException).code;
      const status = code === 'ENOENT' ? 404 : message.includes('queue is full') ? 429 : message.includes('unavailable') ? 503 : message.includes('changed during capture') ? 409 : 400;
      // Do not expose host paths, renderer diagnostics or asset contents.
      return ctx.http.sendApiError(res, status, 'THUMBNAIL_UNAVAILABLE', 'project thumbnail unavailable');
    }
  });
}
