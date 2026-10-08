import { resolve } from 'node:path';

/** Only builds an HTTP request. It never opens or modifies the caller's source. */
export function buildProjectSourceContextCliRequest(input: {
  command: 'context' | 'resolve-context';
  projectId?: string;
  sourceRoot?: string;
  appRelativePath?: string;
  query?: string;
}): { path: string; init: RequestInit } {
  if (input.query !== undefined && input.query.length > 2_000) {
    throw new Error('--query must be at most 2000 characters');
  }
  if (input.command === 'context') {
    if (!input.projectId?.trim()) throw new Error('context requires an explicit stable project ID');
    const query = input.query ? `?${new URLSearchParams({ query: input.query })}` : '';
    return {
      path: `/api/projects/${encodeURIComponent(input.projectId.trim())}/source-context${query}`,
      init: { method: 'GET' },
    };
  }
  if (!input.sourceRoot?.trim()) throw new Error('resolve-context requires --source <folder>');
  return {
    path: '/api/projects/source-context/resolve',
    init: {
      method: 'POST',
      body: JSON.stringify({
        sourceRoot: resolve(input.sourceRoot),
        ...(input.appRelativePath === undefined ? {} : { appRelativePath: input.appRelativePath }),
        ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
        ...(input.query === undefined ? {} : { query: input.query }),
      }),
    },
  };
}
