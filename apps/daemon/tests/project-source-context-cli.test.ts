import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildProjectSourceContextCliRequest } from '../src/projects/source-context-cli.js';

describe('connected source CLI HTTP requests', () => {
  it('uses exact stable identity and encodes the optional query', () => {
    expect(buildProjectSourceContextCliRequest({ command: 'context', projectId: 'stable/id', query: 'design tokens' })).toEqual({
      path: '/api/projects/stable%2Fid/source-context?query=design+tokens', init: { method: 'GET' },
    });
  });

  it('resolves a caller source path without opening it or writing a local reference', () => {
    const request = buildProjectSourceContextCliRequest({
      command: 'resolve-context', sourceRoot: './does-not-need-to-exist', appRelativePath: 'apps/web', projectId: 'stable-id', query: 'Card',
    });
    expect(request.path).toBe('/api/projects/source-context/resolve');
    expect(request.init.method).toBe('POST');
    expect(JSON.parse(String(request.init.body))).toEqual({
      sourceRoot: resolve('./does-not-need-to-exist'), appRelativePath: 'apps/web', projectId: 'stable-id', query: 'Card',
    });
  });

  it('never supplies an implicit project ID for reverse lookup', () => {
    const request = buildProjectSourceContextCliRequest({ command: 'resolve-context', sourceRoot: '/repo' });
    expect(JSON.parse(String(request.init.body))).toEqual({ sourceRoot: '/repo' });
  });

  it('rejects missing explicit selectors and oversized relevance queries', () => {
    expect(() => buildProjectSourceContextCliRequest({ command: 'context' })).toThrow('explicit stable project ID');
    expect(() => buildProjectSourceContextCliRequest({ command: 'resolve-context' })).toThrow('--source');
    expect(() => buildProjectSourceContextCliRequest({ command: 'context', projectId: 'p', query: 'x'.repeat(2001) })).toThrow('2000');
  });
});
