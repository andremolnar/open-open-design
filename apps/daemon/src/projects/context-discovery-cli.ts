import { resolve } from 'node:path';
import { projectContextDiscoveryRequestSchema } from '@open-design/contracts';

/** Relative --cwd is resolved by the CLI caller, never by the daemon/MCP process. */
export function buildProjectContextDiscoveryCliRequest(input: {
  cwd?: string;
  projectId?: string;
  workspaceId?: string;
  workspaceMemberId?: string;
}): { path: string; init: RequestInit } {
  if (!input.cwd?.trim()) throw new Error('discover-context requires --cwd <caller-folder>');
  const body = projectContextDiscoveryRequestSchema.parse({
    cwd: resolve(input.cwd),
    ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
    ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId }),
    ...(input.workspaceMemberId === undefined ? {} : { workspaceMemberId: input.workspaceMemberId }),
  });
  return { path: '/api/projects/source-context/discover', init: { method: 'POST', body: JSON.stringify(body) } };
}
