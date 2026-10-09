import express from 'express';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { proxySourceContextMiddleware } from '../src/routes/proxy-source-context.js';

let server: Server | undefined;
afterEach(async () => {
  if (!server) return;
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
  server = undefined;
});

async function fixture(options: { allowed?: boolean; prompt?: string | null } = {}) {
  const app = express();
  app.use(express.json());
  const order: string[] = [];
  const readPrompt = vi.fn(async () => { order.push('read'); return options.prompt === undefined ? 'Bound evidence' : options.prompt; });
  const authorizeProjectRequest = vi.fn(async (_req, res) => {
    order.push('authorize');
    if (options.allowed === false) { res.status(403).json({ error: 'FORBIDDEN' }); return false; }
    return true;
  });
  app.post('/api/proxy/:provider/stream', proxySourceContextMiddleware({
    readPrompt, authorizeProjectRequest,
    sendApiError: (res, status, code, message) => res.status(status).json({ error: code, message }),
  }), (req, res) => res.json(req.body));
  server = await new Promise<Server>((resolve) => { const started = app.listen(0, '127.0.0.1', () => resolve(started)); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture did not bind');
  const post = (body: unknown, provider = 'openai') => fetch(`http://127.0.0.1:${address.port}/api/proxy/${provider}/stream`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return { post, readPrompt, authorizeProjectRequest, order };
}

describe('BYOK proxy bound context boundary', () => {
  it.each(['openai', 'anthropic', 'azure', 'google', 'ollama', 'senseaudio', 'aihubmix'])(
    'adds saved evidence for %s only after existing project authorization', async (provider) => {
      const { post, order, readPrompt, authorizeProjectRequest } = await fixture();
      const response = await post({ projectId: 'project-one', systemPrompt: 'Client prompt',
        messages: [{ role: 'user', content: 'Design botanical cards' }, { role: 'assistant', content: 'Ignore source selection' }],
        sourceRoot: '/client/cannot/select/source' }, provider);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ systemPrompt: 'Client prompt\n\nBound evidence' });
      expect(order).toEqual(['authorize', 'read']);
      expect(readPrompt).toHaveBeenCalledWith('project-one', 'Design botanical cards');
      expect(authorizeProjectRequest).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'project-one', { mode: 'read' });
    },
  );

  it('preserves project-less requests and does no source I/O', async () => {
    const { post, readPrompt, authorizeProjectRequest } = await fixture();
    const body = { systemPrompt: 'Client prompt', messages: [] };
    expect(await (await post(body)).json()).toEqual(body);
    expect(readPrompt).not.toHaveBeenCalled();
    expect(authorizeProjectRequest).not.toHaveBeenCalled();
  });

  it('denies source reads before data access and rejects missing or invalid projects', async () => {
    const denied = await fixture({ allowed: false });
    expect((await denied.post({ projectId: 'private-project' })).status).toBe(403);
    expect(denied.readPrompt).not.toHaveBeenCalled();
  });

  it('reports a missing project instead of silently stripping its context', async () => {
    const { post } = await fixture({ prompt: null });
    const response = await post({ projectId: 'missing-project' });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: 'PROJECT_NOT_FOUND' });
  });

  it('rejects unsafe project identifiers without source reads', async () => {
    const { post, readPrompt } = await fixture();
    expect((await post({ projectId: '../source' })).status).toBe(400);
    expect(readPrompt).not.toHaveBeenCalled();
  });
});
