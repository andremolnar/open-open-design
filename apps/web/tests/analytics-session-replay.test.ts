// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';

import { applyConsent, bootstrapExceptionTracking, getAnalyticsClient } from '../src/analytics/client';

afterEach(() => vi.unstubAllGlobals());

it('does not initialize session replay or read capture credentials on a detached build', async () => {
  const fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
  const context = { anonymousId: 'anon', sessionId: 'session', clientType: 'web' as const,
    appVersion: '0.23.1', locale: 'en' };
  applyConsent(true);
  await bootstrapExceptionTracking(context);
  expect(await getAnalyticsClient(context)).toBeNull();
  expect(fetchSpy).not.toHaveBeenCalled();
});
