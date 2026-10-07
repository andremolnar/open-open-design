import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

const posthogCtor = vi.hoisted(() => vi.fn());
vi.mock('posthog-node', () => ({ PostHog: posthogCtor }));

import { createAnalyticsService, readPublicConfigResponse } from '../src/analytics.js';

describe('detached app analytics', () => {
  it('never exposes upstream capture credentials to the renderer', () => {
    expect(readPublicConfigResponse({ POSTHOG_KEY: 'phc_test', POSTHOG_HOST: 'https://example.test' })).toMatchObject({
      enabled: false,
      key: null,
      host: null,
    });
  });

  it('does not instantiate a PostHog client or queue a capture with credentials and consent', async () => {
    const analytics = createAnalyticsService({
      dataDir: mkdtempSync(join(tmpdir(), 'od-no-analytics-')),
      env: { POSTHOG_KEY: 'phc_test' },
    });
    const result = await analytics.capture({
      eventName: 'run_finished',
      context: { deviceId: 'device-1' } as Parameters<typeof analytics.capture>[0]['context'],
      appVersion: '0.23.1',
      properties: {},
      insertId: 'local-only',
    });
    expect(result).toEqual({ status: 'not_expected', acknowledgement: 'none', errorType: 'not_configured' });
    expect(posthogCtor).not.toHaveBeenCalled();
  });
});
