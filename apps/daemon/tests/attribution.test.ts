import { describe, expect, it, vi } from 'vitest';

import { createAttributionService } from '../src/routes/attribution.js';

describe('detached download attribution', () => {
  it('does not consume installer tokens or mint cross-product tracking links', async () => {
    const fetchImpl = vi.fn();
    const service = createAttributionService({
      paths: { RUNTIME_DATA_DIR: 'unused' },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      analytics: {
        capture: vi.fn(), captureSafety: vi.fn(), groupIdentify: vi.fn(),
        mergeAnonymousPerson: vi.fn(), shutdown: vi.fn(),
      } as unknown as Parameters<typeof createAttributionService>[0]['analytics'],
      appConfig: { readAppConfig: vi.fn() },
      env: { OD_ATTRIBUTION_LEDGER_URL: 'https://ledger.test/api/attribution',
        OD_ATTRIBUTION_LEDGER_TOKEN: 'secret' },
    });
    await expect(service.claim({ token: 'odtoken_12345678', source: 'manual' }))
      .resolves.toMatchObject({ status: 'not_found', merged: false });
    await expect(service.claim({ token: 'invalid', source: 'manual' }))
      .resolves.toMatchObject({ status: 'invalid' });
    await expect(service.processPending()).resolves.toBeNull();
    await expect(service.bridgeUrl('https://open-design.ai/dashboard')).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
