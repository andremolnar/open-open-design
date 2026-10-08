import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceCollabContext } from '@open-design/contracts';
import {
  CodebaseBindingError,
  fetchProjectCodebaseBinding,
  saveProjectCodebaseBinding,
  validateProjectCodebaseBinding,
} from '../src/providers/codebase-binding';

const context = {
  workspaceId: 'workspace-a', workspaceType: 'team', workspaceMemberId: 'member-a',
  role: 'member', lifecycleState: 'active', memberStatus: 'active',
  permissions: { canShareProjects: false, canWriteSyncedFiles: true },
} as WorkspaceCollabContext;

afterEach(() => vi.unstubAllGlobals());

describe('codebase binding HTTP boundary', () => {
  it('scopes a read to the exact project and workspace without caching', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ projectId: 'a/b' })));
    vi.stubGlobal('fetch', fetcher);
    const signal = new AbortController().signal;
    expect(await fetchProjectCodebaseBinding('a/b', { workspaceContext: context, signal })).toEqual({ projectId: 'a/b' });
    expect(fetcher).toHaveBeenCalledWith('/api/projects/a%2Fb/codebase-binding', {
      method: 'GET', cache: 'no-store', signal,
      headers: expect.objectContaining({
        'x-od-workspace-id': 'workspace-a', 'x-od-workspace-member-id': 'member-a',
      }),
    });
    expect(fetcher.mock.calls[0]?.[1].body).toBeUndefined();
  });

  it('validates and saves only the binding, retaining the signed picker path and token header', async () => {
    const fetcher = vi.fn().mockImplementation(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetcher);
    const body = { sourceRoot: '/picked/alias', appRelativePath: 'apps/web', expectedRevision: 3 };
    const options = { desktopImportToken: 'trust-token', workspaceContext: context };
    await validateProjectCodebaseBinding('stable-project', body, options);
    await saveProjectCodebaseBinding('stable-project', { ...body, expectedSelection: 'canonical-fingerprint' }, options);
    expect(fetcher.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
      ['/api/projects/stable-project/codebase-binding/validate', 'POST'],
      ['/api/projects/stable-project/codebase-binding', 'PUT'],
    ]);
    const validateRequest = fetcher.mock.calls[0]?.[1];
    const saveRequest = fetcher.mock.calls[1]?.[1];
    expect(validateRequest.headers['x-od-desktop-import-token']).toBe('trust-token');
    expect(saveRequest.headers['x-od-desktop-import-token']).toBe('trust-token');
    expect(saveRequest.headers['x-od-workspace-id']).toBe('workspace-a');
    expect(JSON.parse(validateRequest.body)).toEqual(body);
    expect(JSON.parse(saveRequest.body)).toEqual({ ...body, expectedSelection: 'canonical-fingerprint' });
    expect(saveRequest.body).not.toContain('trust-token');
  });

  it('sends no desktop header in an explicitly token-free flow', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetcher);
    await saveProjectCodebaseBinding('a', { sourceRoot: '/source', expectedRevision: null });
    expect(fetcher.mock.calls[0]?.[1].headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it.each([
    [409, { error: { code: 'CONFLICT', message: 'Connection changed.' } }, 'Connection changed.', 'CONFLICT'],
    [403, { error: 'Choose a folder again.' }, 'Choose a folder again.', undefined],
    [500, null, 'Request failed (500).', undefined],
  ])('retains HTTP %i and the existing API error envelope', async (status, body, message, code) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body ? JSON.stringify(body) : 'not-json', { status })));
    const promise = fetchProjectCodebaseBinding('a');
    await expect(promise).rejects.toBeInstanceOf(CodebaseBindingError);
    await expect(promise).rejects.toMatchObject({ status, message, code });
  });
});
