import type { RequestHandler, Response } from 'express';
import type { AuthorizeProjectRequest } from '../collab/project-request-authority.js';
import { isSafeId } from '../projects.js';

const CONTEXT_PROVIDERS = new Set(['anthropic', 'openai', 'azure', 'google', 'ollama', 'senseaudio', 'aihubmix']);

/** Project-less proxy calls stay byte-equivalent and never inspect local source. */
export function proxySourceContextMiddleware(deps: {
  authorizeProjectRequest: AuthorizeProjectRequest;
  readPrompt: (projectId: string, query?: string) => Promise<string | null>;
  sendApiError: (res: Response, status: number, code: string, message: string) => unknown;
}): RequestHandler {
  return async (req, res, next) => {
    const body = req.body as Record<string, unknown> | null | undefined;
    if (!CONTEXT_PROVIDERS.has(String(req.params.provider))
      || !body || body.projectId === undefined || body.projectId === null || body.projectId === '') {
      next();
      return;
    }
    if (typeof body.projectId !== 'string' || !isSafeId(body.projectId)) {
      deps.sendApiError(res, 400, 'BAD_REQUEST', 'projectId must be a safe identifier');
      return;
    }
    if (!await deps.authorizeProjectRequest(req, res, body.projectId, { mode: 'read' })) return;
    // Only the last user-authored text contributes optional relevance ranking.
    const lastUser = Array.isArray(body.messages)
      ? [...body.messages].reverse().find((entry) => entry?.role === 'user')
      : undefined;
    const query = typeof lastUser?.content === 'string' ? lastUser.content.slice(0, 2_000) : undefined;
    const evidence = await deps.readPrompt(body.projectId, query);
    if (evidence === null) {
      deps.sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      return;
    }
    if (evidence) {
      body.systemPrompt = [typeof body.systemPrompt === 'string' ? body.systemPrompt : '', evidence]
        .filter(Boolean).join('\n\n');
    }
    next();
  };
}
