// @vitest-environment jsdom
import { expect, it } from 'vitest';

import { applyConsent, getAnalyticsClient } from '../src/analytics/client';

it('cannot enable product capture by granting a legacy sharing preference', async () => {
  applyConsent(true);
  expect(await getAnalyticsClient({ anonymousId: 'anon', sessionId: 'session',
    clientType: 'web', locale: 'en', appVersion: '0.23.1' })).toBeNull();
});
