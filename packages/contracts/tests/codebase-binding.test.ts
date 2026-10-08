import { describe, expect, it } from 'vitest';
import { projectCodebaseBindingRequestSchema } from '../src/api/codebase-binding.js';

describe('codebase binding request boundary', () => {
  it('accepts root or an optional package and an explicit revision guard', () => {
    expect(projectCodebaseBindingRequestSchema.parse({ sourceRoot: '/repo', expectedRevision: null }))
      .toEqual({ sourceRoot: '/repo', expectedRevision: null });
    expect(projectCodebaseBindingRequestSchema.parse({ sourceRoot: '/repo', appRelativePath: 'apps/web', expectedRevision: 2 }))
      .toEqual({ sourceRoot: '/repo', appRelativePath: 'apps/web', expectedRevision: 2 });
    expect(projectCodebaseBindingRequestSchema.safeParse({ sourceRoot: '/repo', expectedRevision: null, expectedSelection: 'a'.repeat(64) }).success).toBe(true);
  });

  it.each([
    {}, { sourceRoot: '/repo' }, { sourceRoot: 1, expectedRevision: null },
    { sourceRoot: '', expectedRevision: null }, { sourceRoot: '/repo', expectedRevision: '1' },
    { sourceRoot: '/repo', expectedRevision: 0 }, { sourceRoot: '/repo', expectedRevision: -1 },
    { sourceRoot: '/repo', expectedRevision: 1.2 }, { sourceRoot: '/repo', expectedRevision: Infinity },
    { sourceRoot: '/repo', expectedRevision: Number.MAX_SAFE_INTEGER + 1 },
    { sourceRoot: '/repo', expectedRevision: null, appRelativePath: null },
    { sourceRoot: '/repo', expectedRevision: null, appRelativePath: [] },
    { sourceRoot: '/repo', expectedRevision: null, projectId: 'different-project' },
    { sourceRoot: '/repo', expectedRevision: null, schemaVersion: 2 },
    { sourceRoot: '/repo', expectedRevision: null, token: 'do-not-persist' },
    { sourceRoot: '/repo', expectedRevision: null, expectedSelection: 'not-a-fingerprint' },
  ])('rejects missing, mistyped and privileged extra fields: %j', (input) => {
    expect(projectCodebaseBindingRequestSchema.safeParse(input).success).toBe(false);
  });
});
