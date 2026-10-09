import express from 'express';
import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerDesignWorkflowRoutes } from '../src/routes/project/design-workflow.js';
import { DesignWorkflowError, type DesignWorkflowService } from '../src/services/design-workflow.js';

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.closeAllConnections(); server.close((error) => error ? reject(error) : resolve());
  })));
});

const identity = { projectId: 'project-a', workflowId: '3bca1487-7784-49ce-8d8c-18a9286cd071', hostSessionId: 'native-session' };
const contextRevision = 'a'.repeat(64);

async function fixture(authorized = true) {
  const service = {
    prepare: vi.fn(async () => ({ executionOwner: 'host' })),
    get: vi.fn(async () => ({ executionOwner: 'host' })),
    getAsset: vi.fn(async () => ({ base64: 'actual-bytes' })),
    checkpoint: vi.fn(async () => ({ revision: 2 })),
    registerArtifact: vi.fn(async () => ({ revision: 3 })),
    archive: vi.fn(async () => ({ revision: 4, phase: 'archived' })),
  };
  const app = express();
  app.use(express.json());
  const authorizeProjectRequest = vi.fn(async (_req, res, _id, _options) => {
    if (!authorized) res.status(403).json({ error: 'denied' });
    return authorized;
  });
  registerDesignWorkflowRoutes(app, {
    service: service as unknown as DesignWorkflowService, authorizeProjectRequest,
    sendApiError: (res, status, code, message, extras) => res.status(status).json({ code, message, ...extras }),
  });
  const server = createServer(app); servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture listener');
  const post = (action: string, body: unknown, projectId = identity.projectId) => fetch(
    `http://127.0.0.1:${address.port}/api/projects/${projectId}/design-workflow/${action}`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
  );
  return { service, post, authorizeProjectRequest };
}

describe('project-authorized design workflow HTTP boundary', () => {
  it('denies before reading context or assets and never falls back to another project', async () => {
    const { post, service } = await fixture(false);
    expect((await post('get', identity)).status).toBe(403);
    expect((await post('asset', { ...identity, contextRevision, assetId: 'a' })).status).toBe(403);
    expect(service.get).not.toHaveBeenCalled();
    expect(service.getAsset).not.toHaveBeenCalled();
  });

  it('rejects conflicting route/body identity and arbitrary file/network arguments', async () => {
    const { post, service, authorizeProjectRequest } = await fixture();
    expect((await post('get', identity, 'project-b')).status).toBe(400);
    expect((await post('asset', { ...identity, contextRevision, assetId: 'a', path: '/etc/passwd' })).status).toBe(400);
    expect((await post('asset', { ...identity, contextRevision, assetId: 'a', url: 'https://example.com/image.png' })).status).toBe(400);
    expect(authorizeProjectRequest).not.toHaveBeenCalled();
    expect(service.getAsset).not.toHaveBeenCalled();
  });

  it('uses read authority for context/assets and writeFiles for all durable mutations', async () => {
    const { post, service, authorizeProjectRequest } = await fixture();
    expect((await post('get', identity)).status).toBe(200);
    expect(authorizeProjectRequest.mock.calls.at(-1)?.[3]).toEqual({ mode: 'read' });
    expect((await post('asset', { ...identity, contextRevision, assetId: 'a' })).status).toBe(200);
    expect(service.getAsset).toHaveBeenCalledWith(expect.objectContaining({ offset: 0, maxBytes: 32768, representation: 'original' }));
    expect((await post('prepare', { projectId: identity.projectId, sourceRoot: '/repo', expectedBindingRevision: 2,
      hostSessionId: identity.hostSessionId, requestId: 'prepare-1', prompt: 'Implement here',
      capabilities: { imageContent: true, embeddedResources: true } })).status).toBe(200);
    expect(authorizeProjectRequest.mock.calls.at(-1)?.[3]).toEqual({ mode: 'write', capability: 'writeFiles' });
    expect((await post('checkpoint', { ...identity, contextRevision, expectedRevision: 1,
      requestId: 'checkpoint-1', phase: 'critique', summary: 'Source check only', checks: [{ name: 'visual check', status: 'not_run' }] })).status).toBe(200);
    expect((await post('register-artifact', { ...identity, contextRevision, expectedRevision: 2,
      requestId: 'register-1', name: 'preview.html', sha256: 'b'.repeat(64) })).status).toBe(200);
    expect(authorizeProjectRequest.mock.calls.at(-1)?.[3]).toEqual({ mode: 'write', capability: 'writeFiles' });
    expect((await post('archive', { ...identity, contextRevision, expectedRevision: 3, requestId: 'archive-1', confirm: true })).status).toBe(200);
    expect((await post('archive', { ...identity, contextRevision, expectedRevision: 3, requestId: 'archive-1' })).status).toBe(400);
  });

  it('returns explicit stale-binding errors and redacts unclassified filesystem failures', async () => {
    const { post, service } = await fixture();
    service.get.mockRejectedValueOnce(new DesignWorkflowError('binding_changed', 'Reconnect this binding.', 409));
    const conflict = await post('get', identity);
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ details: { reason: 'binding_changed' } });
    service.get.mockRejectedValueOnce(new Error('/private/server/path/token.json unreadable'));
    const failure = await post('get', identity);
    expect(failure.status).toBe(500);
    expect(await failure.text()).not.toContain('/private/server');
  });
});
