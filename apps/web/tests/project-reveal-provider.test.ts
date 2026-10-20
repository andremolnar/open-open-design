import { afterEach, describe, expect, it, vi } from 'vitest';
import { revealProjectPath } from '../src/providers/project-reveal';
import { workspaceContextFixture } from './helpers/workspace-context';

afterEach(() => vi.unstubAllGlobals());
describe('project reveal HTTP boundary', () => {
  it('uses project-relative paths and forwards exact workspace authority', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal('fetch', fetcher);
    const context = workspaceContextFixture({ workspaceId: 'workspace-a', workspaceMemberId: 'member-a' });
    await revealProjectPath('a/b', { path: 'assets/image & notes.png' }, context);
    expect(fetcher).toHaveBeenCalledWith('/api/projects/a%2Fb/reveal', {
      method: 'POST', body: JSON.stringify({ path: 'assets/image & notes.png' }),
      headers: expect.objectContaining({ 'Content-Type': 'application/json', 'x-od-workspace-id': context.workspaceId }),
    });
  });
  it.each([
    [{ error: { message: 'launch refused' } }, 'launch refused'],
    [{ error: 'location is unavailable' }, 'location is unavailable'],
    [null, 'Request failed (500)'],
  ])('surfaces API failures instead of pretending a folder opened', async (body, message) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body ? JSON.stringify(body) : 'not json', { status: 500 })));
    await expect(revealProjectPath('a', {})).rejects.toThrow(message);
  });
});
