import { describe, expect, it } from 'vitest';

import { readPosthogConfig, readPublicConfigResponse } from '../src/analytics.js';
import { readTelemetrySinkConfig, readRunTelemetrySinkConfig } from '../src/langfuse-trace.js';
import { diagnosticRelayUrl } from '../src/integrations/diagnostic-relay.js';

describe('detached app telemetry destinations', () => {
  it('does not enable PostHog even if release credentials are present', () => {
    const env = { POSTHOG_KEY: 'phc_test', POSTHOG_HOST: 'https://example.test' };
    expect(readPosthogConfig(env)).toBeNull();
    expect(readPublicConfigResponse(env).enabled).toBe(false);
  });

  it('does not select relay, Langfuse, or Vela telemetry destinations', () => {
    const env = {
      OPEN_DESIGN_TELEMETRY_RELAY_URL: 'https://example.test/api/langfuse',
      LANGFUSE_PUBLIC_KEY: 'public',
      LANGFUSE_SECRET_KEY: 'secret',
    };
    expect(readTelemetrySinkConfig(env)).toBeNull();
    expect(readRunTelemetrySinkConfig(env, {})).toBeNull();
  });

  it('does not configure background diagnostic bundle uploads with relay credentials', () => {
    expect(diagnosticRelayUrl({
      OPEN_DESIGN_OBJECT_RELAY_URL: 'https://telemetry.open-design.ai/api/objects/batch',
      OPEN_DESIGN_TELEMETRY_RELAY_URL: 'https://telemetry.open-design.ai/api/langfuse',
    })).toBeNull();
  });
});
