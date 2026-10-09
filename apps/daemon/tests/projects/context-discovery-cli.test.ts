import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildProjectContextDiscoveryCliRequest } from '../../src/projects/context-discovery-cli.js';

describe('caller-cwd discovery CLI request', () => {
  it('requires a caller location instead of guessing the daemon location', () => {
    expect(() => buildProjectContextDiscoveryCliRequest({})).toThrow('--cwd');
    expect(() => buildProjectContextDiscoveryCliRequest({ cwd: ' ' })).toThrow('--cwd');
  });
  it('resolves relative cwd in the native CLI caller and sends no default scope', () => {
    const result = buildProjectContextDiscoveryCliRequest({ cwd: '.' });
    expect(result.path).toBe('/api/projects/source-context/discover');
    expect(result.init.method).toBe('POST');
    expect(JSON.parse(String(result.init.body))).toEqual({ cwd: path.resolve('.') });
    expect(result.init.headers).toBeUndefined();
  });
  it('preserves explicit candidate and scope', () => {
    const input = { cwd: '/repo/apps/web', projectId: 'project-a', workspaceId: 'team-a', workspaceMemberId: 'member-a' };
    expect(JSON.parse(String(buildProjectContextDiscoveryCliRequest(input).init.body))).toEqual(input);
  });
  it.each([{ workspaceId: 'team-a' }, { workspaceMemberId: 'member-a' }])('rejects incomplete scope %j', (scope) => {
    expect(() => buildProjectContextDiscoveryCliRequest({ cwd: '/repo', ...scope })).toThrow();
  });
});
