import { describe, expect, it } from 'vitest';

import buildSource from '@/mac/build.ts?raw';
import artifactSource from '@/mac/artifacts.ts?raw';

describe('mac build security attributes', () => {
  it.each([
    ['app build', buildSource],
    ['artifact finalization', artifactSource],
  ])('preserves quarantine and provenance during %s', (_name, source) => {
    expect(source).not.toContain('scrubMacExtendedAttributes');
    expect(source).not.toContain('xattr-scrub');
  });
});
