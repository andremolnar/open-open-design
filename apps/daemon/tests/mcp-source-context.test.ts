import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleMcpToolCall, localMcpToolDefinitions } from '../src/mcp.js';
import { _resetMcpWorkspaceContextCacheForTests } from '../src/mcp-workspace-context.js';

const base = 'http://127.0.0.1:19017';
const ready = { status: 'ready', projectId: 'stable-id', bindingRevision: 3, evidence: [] };
function mockDaemon(payload: unknown = ready, status = 200) {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.endsWith('/api/workspace/directory')) return Response.json({ items: [{
      workspaceId: 'workspace-a', workspaceMemberId: 'member-a', workspaceType: 'personal',
      memberStatus: 'active', lifecycleState: 'active',
    }] });
    return Response.json(payload, { status });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  _resetMcpWorkspaceContextCacheForTests();
  vi.unstubAllGlobals();
});

describe('read-only connected source MCP tools', () => {
  it('advertises explicit stable identity, bounded query, and read-only annotations', () => {
    const definitions = localMcpToolDefinitions();
    const read = definitions.find((tool) => tool.name === 'get_project_source_context')!;
    const resolve = definitions.find((tool) => tool.name === 'resolve_project_context')!;
    expect(read.inputSchema.required).toEqual(['projectId']);
    expect(resolve.inputSchema.required).toEqual(['sourceRoot']);
    expect(read.inputSchema.additionalProperties).toBe(false);
    expect(resolve.inputSchema.additionalProperties).toBe(false);
    expect(read.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(resolve.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(read.inputSchema.properties).toHaveProperty('query.maxLength', 2000);
    expect(resolve.inputSchema.properties).toHaveProperty('projectId');
  });

  it('reads the exact project ID through scoped HTTP without project-name or active resolution', async () => {
    const fetchMock = mockDaemon();
    const result = await handleMcpToolCall(base, 'get_project_source_context', {
      projectId: 'stable-id', query: 'button tokens',
    });
    expect(JSON.parse(result.content[0]!.text)).toEqual(ready);
    expect(fetchMock.mock.calls).toHaveLength(2);
    expect(fetchMock.mock.calls[1]).toEqual([
      `${base}/api/projects/stable-id/source-context?query=button+tokens`,
      { headers: { 'x-od-workspace-id': 'workspace-a', 'x-od-workspace-member-id': 'member-a' } },
    ]);
  });

  it('requires explicit identity rather than falling back to the active project', async () => {
    const fetchMock = mockDaemon();
    const result = await handleMcpToolCall(base, 'get_project_source_context', {});
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('explicit stable projectId');
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([`${base}/api/workspace/directory`]);
  });

  it.each(['needs_selection', 'unavailable', 'ready'])('preserves daemon %s resolution without active fallback', async (status) => {
    const payload = { status, projectId: status === 'ready' ? 'stable-id' : null, evidence: [] };
    const fetchMock = mockDaemon(payload);
    const request = { sourceRoot: '/repo', appRelativePath: 'apps/web', projectId: 'stable-id', query: 'Card' };
    const result = await handleMcpToolCall(base, 'resolve_project_context', request);
    expect(JSON.parse(result.content[0]!.text)).toEqual(payload);
    expect(fetchMock.mock.calls).toHaveLength(2);
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe(`${base}/api/projects/source-context/resolve`);
    expect(init).toMatchObject({ method: 'POST', headers: {
      'Content-Type': 'application/json', 'x-od-workspace-id': 'workspace-a', 'x-od-workspace-member-id': 'member-a',
    } });
    expect(JSON.parse(String(init?.body))).toEqual(request);
  });

  it('does not retry a permission denial through headerless or active-project calls', async () => {
    const fetchMock = mockDaemon({ error: { code: 'WORKSPACE_PROJECT_PERMISSION_DENIED', message: 'denied' } }, 403);
    const result = await handleMcpToolCall(base, 'resolve_project_context', { sourceRoot: '/repo' });
    expect(result.isError).toBe(true);
    expect(fetchMock.mock.calls).toHaveLength(2);
    expect(result.content[0]!.text).toContain('403');
  });

  it.each([{ sourceRoot: '' }, { sourceRoot: '/repo', projectId: '' }, { sourceRoot: '/repo', query: 'x'.repeat(2001) }])('rejects malformed source lookup arguments %j', async (args) => {
    const fetchMock = mockDaemon();
    const result = await handleMcpToolCall(base, 'resolve_project_context', args);
    expect(result.isError).toBe(true);
    expect(fetchMock.mock.calls).toHaveLength(1);
  });
});
