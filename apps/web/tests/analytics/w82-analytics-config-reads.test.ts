// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';

import { applyConsent, bootstrapExceptionTracking, getAnalyticsClient } from '../../src/analytics/client';

const context = {
  anonymousId: 'anon-1', sessionId: 'session-1', clientType: 'web' as const,
  locale: 'en', appVersion: '0.23.1',
};

afterEach(() => vi.unstubAllGlobals());

it('never queries analytics config or starts a capture client, including after consent changes', async () => {
  const fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
  await bootstrapExceptionTracking(context);
  expect(await getAnalyticsClient(context)).toBeNull();
  applyConsent(true);
  expect(await getAnalyticsClient(context)).toBeNull();
  applyConsent(false);
  expect(await getAnalyticsClient(context)).toBeNull();
  expect(fetchSpy).not.toHaveBeenCalled();
});
