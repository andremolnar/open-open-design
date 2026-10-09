import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleMcpToolCall, localMcpToolDefinitions, MCP_SERVER_INSTRUCTIONS } from '../src/mcp.js';
import { _resetMcpWorkspaceContextCacheForTests } from '../src/mcp-workspace-context.js';

const base = 'http://127.0.0.1:19731';
const cwd = '/repo/apps/web/src';
const scope = { workspaceId: 'team-a', workspaceMemberId: 'member-a' };
const selected = { projectId: 'project-a', projectName: 'Exact project', sourceRoot: '/repo', appRelativePath: 'apps/web', bindingRevision: 3,
  status: 'ready', workspaceScope: { ...scope, workspaceName: 'Team A', workspaceType: 'team' } };
const discovery = { status: 'ready', selected, candidates: [selected], truncated: false };
const directory = { items: [
  { workspaceId: 'personal', workspaceMemberId: 'personal-member', workspaceType: 'personal', memberStatus: 'active', lifecycleState: 'active' },
  { ...scope, workspaceType: 'team', memberStatus: 'active', lifecycleState: 'active' },
], activeWorkspaceId: 'personal' };

afterEach(() => { vi.unstubAllGlobals(); _resetMcpWorkspaceContextCacheForTests(); });

describe('caller-cwd discovery MCP', () => {
  it('advertises explicit caller cwd and scope, and guides discovery before prepare', () => {
    const definitions = localMcpToolDefinitions();
    const tool = definitions.find((entry) => entry.name === 'discover_project_context')!;
    expect(tool.inputSchema).toMatchObject({ required: ['cwd'], additionalProperties: false });
    expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(tool.inputSchema.properties).toHaveProperty('workspaceId');
    for (const name of ['resolve_project_context', 'get_project_source_context']) {
      expect(definitions.find((entry) => entry.name === name)!.inputSchema.properties).toHaveProperty('workspaceMemberId');
    }
    expect(MCP_SERVER_INSTRUCTIONS).toContain('first obtain the actual current directory');
    expect(MCP_SERVER_INSTRUCTIONS.indexOf('discover_project_context')).toBeLessThan(MCP_SERVER_INSTRUCTIONS.indexOf('prepare_design_context'));
  });

  it('forwards host cwd without consulting default Personal scope, active UI or server cwd', async () => {
    const fetch = vi.fn(async () => Response.json(discovery)); vi.stubGlobal('fetch', fetch);
    const result = await handleMcpToolCall(base, 'discover_project_context', { cwd });
    expect(result.structuredContent).toEqual(discovery);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${base}/api/projects/source-context/discover`);
    expect(JSON.parse(String(init.body))).toEqual({ cwd });
    expect(init.headers).not.toHaveProperty('x-od-workspace-id');
  });

  it.each([
    {}, { cwd, workspaceId: 'team-a' }, { cwd, workspaceMemberId: 'member-a' },
    { cwd, unexpected: 'active-project' }, { cwd: 'x'.repeat(32769) },
  ])('rejects malformed discovery before any request: %j', async (args) => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const result = await handleMcpToolCall(base, 'discover_project_context', args);
    expect(result.isError).toBe(true); expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['ambiguous', 'no_match', 'selection_incomplete', 'missing_source'])('preserves %s without picking or preparing', async (reason) => {
    const response = { ...discovery, status: 'needs_selection', selected: null, reason };
    const fetch = vi.fn(async () => Response.json(response)); vi.stubGlobal('fetch', fetch);
    expect((await handleMcpToolCall(base, 'discover_project_context', { cwd })).structuredContent).toEqual(response);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('passes an explicit user-selected Team candidate to discovery without changing its identity', async () => {
    const fetch = vi.fn(async () => Response.json(discovery)); vi.stubGlobal('fetch', fetch);
    await handleMcpToolCall(base, 'discover_project_context', { cwd, projectId: 'project-a', ...scope });
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ cwd, projectId: 'project-a', ...scope });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['resolve_project_context', 'get_project_source_context'])('retains selected Team scope on %s instead of Personal', async (name) => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, ...(init ? { init } : {}) });
      return Response.json(url.endsWith('/api/workspace/directory') ? directory : { status: 'ready', projectId: selected.projectId });
    }));
    const args = name === 'resolve_project_context' ? { sourceRoot: '/repo', appRelativePath: 'apps/web' } : {};
    const result = await handleMcpToolCall(base, name, { ...args, projectId: selected.projectId, ...scope });
    expect(result.isError).not.toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.init?.headers).toMatchObject({ 'x-od-workspace-id': 'team-a', 'x-od-workspace-member-id': 'member-a' });
    if (name === 'resolve_project_context') expect(JSON.parse(String(calls[1]!.init?.body))).toEqual({ sourceRoot: '/repo', appRelativePath: 'apps/web', projectId: selected.projectId });
  });

  it('does not retry denied membership through Personal, headerless or active project', async () => {
    const fetch = vi.fn(async () => Response.json(directory)); vi.stubGlobal('fetch', fetch);
    const result = await handleMcpToolCall(base, 'resolve_project_context', { sourceRoot: '/repo', workspaceId: 'team-a', workspaceMemberId: 'other-member' });
    expect(result.isError).toBe(true); expect(fetch).toHaveBeenCalledTimes(1);
  });
});
