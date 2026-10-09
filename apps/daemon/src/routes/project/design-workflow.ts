import type { Express } from 'express';
import {
  prepareDesignContextRequestSchema, getDesignWorkflowRequestSchema,
  getDesignAssetRequestSchema, checkpointDesignWorkflowRequestSchema,
  registerDesignArtifactRequestSchema,
  archiveDesignWorkflowRequestSchema,
} from '@open-design/contracts';
import type { AuthorizeProjectRequest } from '../../collab/project-request-authority.js';
import type { HttpDeps } from '../../server-context.js';
import { DesignWorkflowError, type DesignWorkflowService } from '../../services/design-workflow.js';

interface DesignWorkflowRouteDependencies {
  authorizeProjectRequest: AuthorizeProjectRequest;
  sendApiError: HttpDeps['sendApiError'];
  service: DesignWorkflowService;
}

/** All transports share this project-authorized boundary; no active UI selection. */
export function registerDesignWorkflowRoutes(app: Express, deps: DesignWorkflowRouteDependencies): void {
  function register<T extends { projectId: string }>(
    action: string,
    schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
    write: boolean,
    run: (input: T) => Promise<unknown>,
  ) {
    app.post(`/api/projects/:id/design-workflow/${action}`, async (req, res) => {
      const parsed = schema.safeParse(req.body);
      if (!parsed.success || parsed.data.projectId !== req.params.id) {
        return deps.sendApiError(res, 400, 'BAD_REQUEST', 'Provide a valid work-here request for this exact project ID.');
      }
      if (!await deps.authorizeProjectRequest(req, res, parsed.data.projectId,
        write ? { mode: 'write', capability: 'writeFiles' } : { mode: 'read' })) return;
      try {
        res.json(await run(parsed.data));
      } catch (error) {
        if (error instanceof DesignWorkflowError) {
          return deps.sendApiError(res, error.statusCode, 'DESIGN_WORKFLOW_ERROR', error.message,
            { details: { reason: error.code } });
        }
        // Never expose physical resource paths or raw filesystem exceptions.
        return deps.sendApiError(res, 500, 'INTERNAL_ERROR', 'The work-here context could not be prepared or read. Check the selected design resources and connection, then try again.');
      }
    });
  }
  register('prepare', prepareDesignContextRequestSchema, true, deps.service.prepare);
  register('get', getDesignWorkflowRequestSchema, false, deps.service.get);
  register('asset', getDesignAssetRequestSchema, false, deps.service.getAsset);
  register('checkpoint', checkpointDesignWorkflowRequestSchema, true, deps.service.checkpoint);
  register('register-artifact', registerDesignArtifactRequestSchema, true, deps.service.registerArtifact);
  register('archive', archiveDesignWorkflowRequestSchema, true, deps.service.archive);
}
