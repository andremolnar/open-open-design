import { describe, expect, it, vi } from 'vitest';

import { buildTraceObjectManifests, freezeTraceObjectSources } from '../src/trace-object-manifest.js';

describe('detached trace object handling', () => {
  const input = {
    installationId: 'local-install', projectId: 'project', runId: 'run',
    projectsRoot: '/unused', prompt: 'private user prompt',
    prefs: { metrics: true, content: true, artifactManifest: true },
    env: {
      OPEN_DESIGN_OBJECT_RELAY_URL: 'https://telemetry.open-design.ai/api/objects/batch',
      OPEN_DESIGN_TELEMETRY_RELAY_URL: 'https://telemetry.open-design.ai/api/langfuse',
    },
  };

  it('does not freeze prompt or artifact bytes for upload despite consent and relay credentials', async () => {
    expect(await freezeTraceObjectSources(input)).toEqual([]);
  });

  it('does not authorize or upload objects even if the caller requests a manifest', async () => {
    const fetchImpl = vi.fn();
    expect(await buildTraceObjectManifests({ ...input, fetchImpl: fetchImpl as unknown as typeof fetch }))
      .toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
