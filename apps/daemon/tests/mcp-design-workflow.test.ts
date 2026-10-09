import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesignAssetResponse } from '@open-design/contracts';
import { handleMcpToolCall, localMcpToolDefinitions } from '../src/mcp.js';
import { designAssetMcpResult, designWorkflowMcpRequest } from '../src/mcp-design-workflow.js';
import { _resetMcpWorkspaceContextCacheForTests } from '../src/mcp-workspace-context.js';

// A real 1x1 PNG, not a path, fake image-shaped string or mocked visual answer.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nGQAAAAASUVORK5CYII=', 'base64');
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const identity = { projectId: 'exact-project', workflowId: '9d4fdba3-6db3-4dc3-b2d2-57d4ba178bc9', hostSessionId: 'host-session' };
const contextRevision = 'a'.repeat(64);
const payload: DesignAssetResponse = {
  version: 1, ...identity, contextRevision, representation: 'image', base64: png.toString('base64'),
  offset: 0, totalBytes: png.length, nextOffset: null, chunkSha256: hash(png),
  resource: { id: 'reference-image', name: 'project/reference.png', role: 'project_asset',
    provenance: 'project:exact-project', mimeType: 'image/png', bytes: png.length,
    sha256: hash(png), required: false, transformed: false, representations: ['image', 'original'] },
};

afterEach(() => { _resetMcpWorkspaceContextCacheForTests(); vi.unstubAllGlobals(); });

describe('host-owned design workflow MCP', () => {
  it('carries exact image bytes beside text and structured provenance metadata', () => {
    const result = designAssetMcpResult(payload);
    expect(result.content[0].type).toBe('text');
    expect(result.structuredContent).not.toHaveProperty('base64');
    expect(result.structuredContent).toMatchObject({ contextRevision, resource: { sha256: hash(png), transformed: false } });
    const image = result.content[1];
    expect(image.type).toBe('image');
    if (image.type !== 'image') throw new Error('Expected actual MCP image content');
    expect(image.mimeType).toBe('image/png');
    expect(Buffer.from(image.data, 'base64')).toEqual(png);
  });

  it('provides original bytes as a bounded embedded JSON text resource for native host writes', () => {
    const chunk = png.subarray(7, 25);
    const result = designAssetMcpResult({ ...payload, representation: 'original', offset: 7,
      nextOffset: 25, base64: chunk.toString('base64'), chunkSha256: hash(chunk) });
    const resource = result.content[1];
    if (resource.type !== 'resource') throw new Error('Expected embedded original-byte resource');
    expect(resource.resource.mimeType).toBe('application/json');
    expect(resource.resource.uri).toContain(identity.workflowId);
    const envelope = JSON.parse(resource.resource.text);
    expect(Buffer.from(envelope.base64, 'base64')).toEqual(chunk);
    expect(envelope.resource.sha256).toBe(hash(png));
    expect(envelope).toMatchObject({ offset: 7, nextOffset: 25, totalBytes: png.length });
  });

  it.each([
    { base64: 'not-base64' }, { chunkSha256: 'b'.repeat(64) },
    { resource: { ...payload.resource, mimeType: 'image/svg+xml' } },
    { resource: { ...payload.resource, sha256: 'b'.repeat(64) } },
    { offset: 1 }, { base64: Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64') },
  ])('rejects invalid or misleading image envelopes (%#)', (change) => {
    expect(() => designAssetMcpResult({ ...payload, ...change })).toThrow();
  });

  it('advertises exact scope, bounded assets and idempotent host-reported mutations', () => {
    const tools = localMcpToolDefinitions();
    for (const name of ['prepare_design_context', 'get_design_workflow', 'get_design_asset', 'checkpoint_design_workflow', 'register_design_artifact']) {
      const tool = tools.find((entry) => entry.name === name)!;
      expect(tool.inputSchema.required).toContain('projectId');
      expect(tool.inputSchema.required).toContain('hostSessionId');
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.annotations).toMatchObject({ idempotentHint: true, destructiveHint: false });
    }
    expect(tools.find((entry) => entry.name === 'get_design_asset')!.annotations.readOnlyHint).toBe(true);
    expect(tools.find((entry) => entry.name === 'prepare_design_context')!.annotations.readOnlyHint).toBe(false);
  });

  it('requires explicit identity and paired refresh revision, never active project fallback', () => {
    expect(() => designWorkflowMcpRequest('get_design_workflow', { hostSessionId: 'session' })).toThrow();
    expect(() => designWorkflowMcpRequest('get_design_asset', { ...identity, contextRevision,
      assetId: 'a', path: '/etc/passwd' })).toThrow();
    expect(() => designWorkflowMcpRequest('prepare_design_context', { projectId: 'p', sourceRoot: '/repo',
      expectedBindingRevision: 1, hostSessionId: 's', requestId: 'r', prompt: 'build',
      capabilities: { imageContent: true, embeddedResources: true }, workflowId: identity.workflowId })).toThrow();
  });

  it('passes scoped HTTP image bytes to the current MCP session without any Run request', async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith('/api/workspace/directory')) return Response.json({ items: [{
        workspaceId: 'workspace-a', workspaceMemberId: 'member-a', workspaceType: 'personal',
        memberStatus: 'active', lifecycleState: 'active',
      }] });
      return Response.json(payload);
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await handleMcpToolCall('http://127.0.0.1:19017', 'get_design_asset', {
      ...identity, contextRevision, assetId: payload.resource.id, representation: 'image',
    });
    expect(result.isError).not.toBe(true);
    expect(result.content[1]).toMatchObject({ type: 'image', data: png.toString('base64') });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://127.0.0.1:19017/api/workspace/directory',
      'http://127.0.0.1:19017/api/projects/exact-project/design-workflow/asset',
    ]);
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({ method: 'POST', headers: {
      'x-od-workspace-id': 'workspace-a', 'x-od-workspace-member-id': 'member-a',
    } });
  });
  it('honors exact Team membership even when Personal is also available', async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith('/api/workspace/directory')) return Response.json({ items: [
        { workspaceId: 'personal', workspaceMemberId: 'personal-member', workspaceType: 'personal', memberStatus: 'active', lifecycleState: 'active' },
        { workspaceId: 'team', workspaceMemberId: 'team-member', workspaceType: 'team', memberStatus: 'active', lifecycleState: 'active' },
      ] });
      return Response.json({ ...identity, phase: 'prepared' });
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await handleMcpToolCall('http://127.0.0.1:19017', 'get_design_workflow', {
      ...identity, workspaceId: 'team', workspaceMemberId: 'team-member',
    });
    expect(result.isError).not.toBe(true);
    const request = fetchMock.mock.calls[1]![1]!;
    expect(request.headers).toMatchObject({ 'x-od-workspace-id': 'team', 'x-od-workspace-member-id': 'team-member' });
    expect(JSON.parse(String(request.body))).toEqual(identity);
    fetchMock.mockClear();
    const denied = await handleMcpToolCall('http://127.0.0.1:19017', 'get_design_workflow', {
      ...identity, workspaceId: 'team', workspaceMemberId: 'personal-member',
    });
    expect(denied.isError).toBe(true);
    expect(fetchMock.mock.calls).toHaveLength(1);
    expect(denied.content[0].text).toContain('no Personal fallback');
    fetchMock.mockClear();
    const partial = await handleMcpToolCall('http://127.0.0.1:19017', 'get_design_workflow', {
      ...identity, workspaceId: 'team',
    });
    expect(partial.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires explicit cache-discard confirmation and declares destructive scope', () => {
    const request = { ...identity, contextRevision, expectedRevision: 1, requestId: 'archive-1' };
    expect(() => designWorkflowMcpRequest('archive_design_workflow', request)).toThrow();
    expect(designWorkflowMcpRequest('archive_design_workflow', { ...request, confirm: true }).path).toMatch(/\/archive$/);
    const tool = localMcpToolDefinitions().find((entry) => entry.name === 'archive_design_workflow')!;
    expect(tool.annotations).toMatchObject({ readOnlyHint: false, idempotentHint: true, destructiveHint: true });
  });

});
