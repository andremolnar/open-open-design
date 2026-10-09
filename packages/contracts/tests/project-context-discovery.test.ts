import { describe, expect, it } from 'vitest';
import { projectContextDiscoveryRequestSchema } from '../src/api/project-context-discovery.js';

describe('project context discovery request boundary', () => {
  it('requires explicit cwd and accepts an explicit project and exact scope pair', () => {
    expect(projectContextDiscoveryRequestSchema.parse({ cwd: '/repo/apps/web' }))
      .toEqual({ cwd: '/repo/apps/web' });
    const request = { cwd: '/repo', projectId: 'design-a', workspaceId: 'team-a', workspaceMemberId: 'member-a' };
    expect(projectContextDiscoveryRequestSchema.parse(request)).toEqual(request);
    expect(projectContextDiscoveryRequestSchema.parse({ cwd: 'C:\\repo\\app' })).toEqual({ cwd: 'C:\\repo\\app' });
  });

  it.each([
    {}, { cwd: '' }, { cwd: null }, { cwd: 42 }, { cwd: [] },
    { cwd: '/repo', projectId: null }, { cwd: '/repo', projectId: '' },
    { cwd: '/repo', workspaceId: 'team-a' }, { cwd: '/repo', workspaceMemberId: 'member-a' },
    { cwd: '/repo', workspaceId: '', workspaceMemberId: 'member-a' },
    { cwd: '/repo', workspaceId: 1, workspaceMemberId: 2 },
    { cwd: '/repo', workspaceId: null, workspaceMemberId: null },
    { cwd: 'x'.repeat(32_769) }, { cwd: '/repo', projectId: 'x'.repeat(257) },
    { cwd: '/repo', workspaceId: 'x'.repeat(257), workspaceMemberId: 'member' },
    { cwd: '/repo', workspaceId: 'team', workspaceMemberId: 'x'.repeat(257) },
    { cwd: '/repo', sourceRoot: '/another' }, { cwd: '/repo', query: 'read source' },
    { cwd: '/repo', trusted: true }, { cwd: '/repo', token: 'credential' },
    { cwd: '/repo', workspaceScope: { workspaceId: 'team', workspaceMemberId: 'member' } },
  ])('rejects missing/mistyped/partial inputs and unknown authority fields: %j', (input) => {
    expect(projectContextDiscoveryRequestSchema.safeParse(input).success).toBe(false);
  });
});
