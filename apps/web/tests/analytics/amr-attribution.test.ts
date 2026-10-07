// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  amrHandoffDeviceId,
  attributedAmrUrl,
  readAmrAttribution,
  recordAmrEntry,
  syncAmrAttributionWithOnboardingProfile,
} from '../../src/analytics/amr-attribution';
import { saveOnboardingProfile } from '../../src/state/onboarding-profile';

describe('AMR attribution helper', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    window.localStorage.clear();
    fetchMock = vi.fn(async () => new Response('{}', { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('accepts every AMR entry source defined for OpenDesign entry points', () => {
    const track = vi.fn();
    const sources = [
      'onboarding_amr_card',
      'onboarding_amr_sign_in_continue',
      'inline_model_switcher_amr_row',
      'settings_amr_agent_card',
      'settings_amr_authorize',
      'settings_amr_console',
      'settings_amr_install',
      'avatar_amr_console',
      'handoff_amr_website',
      'chat_error_authorize_retry',
      'chat_error_recharge',
      'chat_error_upgrade',
      'chat_error_switch_retry_card',
      'generation_preview_authorize_retry',
      'generation_preview_recharge',
      'generation_preview_switch_retry_card',
      'artifact_success_upgrade',
    ] as const;

    for (const [index, source] of sources.entries()) {
      recordAmrEntry(
        track,
        source,
        new Date(`2026-06-03T12:00:${index.toString().padStart(2, '0')}.000Z`),
        { metricsConsent: true },
      );
    }

    expect(track).toHaveBeenCalledTimes(sources.length);
    expect(track.mock.calls.map(([, props]) => props.element)).toEqual(sources);
  });

  it('records a last-touch AMR entry without mirroring it to the cloud', () => {
    const track = vi.fn();
    const now = new Date('2026-06-03T12:00:00.000Z');

    const attribution = recordAmrEntry(track, 'chat_error_recharge', now, {
      metricsConsent: true,
    });

    expect(attribution).toMatchObject({
      sourceProduct: 'open_design',
      sourceDetail: 'chat_error_recharge',
      occurredAt: '2026-06-03T12:00:00.000Z',
    });
    expect(attribution.entryId).toMatch(/^od-amr-/u);
    expect(readAmrAttribution(now)).toEqual(attribution);
    expect(track).toHaveBeenCalledWith(
      'ui_click',
      expect.objectContaining({
        page_name: 'chat_panel',
        area: 'amr_entry',
        element: 'chat_error_recharge',
        action: 'click_amr_entry',
        entry_id: attribution.entryId,
        source_product: 'open_design',
        source_detail: 'chat_error_recharge',
        entry_occurred_at: '2026-06-03T12:00:00.000Z',
      }),
      undefined,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('attaches the persisted onboarding profile locally without forwarding it', () => {
    saveOnboardingProfile({
      role: 'pm',
      orgSize: 'startup',
      useCase: ['product', 'design-system'],
      source: 'github',
    });
    const track = vi.fn();
    const now = new Date('2026-06-03T12:00:00.000Z');

    const attribution = recordAmrEntry(track, 'chat_error_recharge', now, {
      metricsConsent: true,
    });

    expect(attribution).toMatchObject({
      odRole: 'pm',
      odOrgSize: 'startup',
      odUseCase: ['product', 'design-system'],
      odSource: 'github',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('omits profile fields entirely when no onboarding profile is stored', () => {
    const track = vi.fn();
    const attribution = recordAmrEntry(
      track,
      'chat_error_recharge',
      new Date('2026-06-03T12:00:00.000Z'),
      { metricsConsent: true },
    );

    expect(attribution.odRole).toBeUndefined();
    expect(attribution.odOrgSize).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reuses a previous entry id for follow-up actions in the same source path', () => {
    const track = vi.fn();
    const first = recordAmrEntry(
      track,
      'onboarding_amr_card',
      new Date('2026-06-03T12:00:00.000Z'),
      { metricsConsent: true },
    );

    const second = recordAmrEntry(
      track,
      'onboarding_amr_sign_in_continue',
      new Date('2026-06-03T12:00:05.000Z'),
      { reuseExistingFrom: ['onboarding_amr_card'] },
    );

    expect(second).toEqual(first);
    expect(track).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(readAmrAttribution(new Date('2026-06-03T12:00:05.000Z'))).toEqual(
      first,
    );
  });

  it('updates a local AMR entry after About you without exporting the profile', () => {
    const track = vi.fn();
    const entryTime = new Date('2026-06-03T12:00:00.000Z');
    const profileTime = new Date('2026-06-03T12:03:00.000Z');
    const attribution = recordAmrEntry(track, 'onboarding_amr_card', entryTime);
    fetchMock.mockClear();

    const updated = syncAmrAttributionWithOnboardingProfile(
      {
        role: 'pm',
        orgSize: 'startup',
        useCase: ['product', 'design-system'],
        source: 'github',
      },
      {
        metricsConsent: true,
        odDeviceId: 'od-install-abc',
        now: profileTime,
      },
    );

    expect(updated).toMatchObject({
      entryId: attribution.entryId,
      sourceDetail: 'onboarding_amr_card',
      odDeviceId: 'od-install-abc',
      odRole: 'pm',
      odOrgSize: 'startup',
      odUseCase: ['product', 'design-system'],
      odSource: 'github',
    });
    expect(readAmrAttribution(profileTime)).toEqual(updated);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not mirror AMR entry analytics without metrics consent', () => {
    const track = vi.fn();
    const now = new Date('2026-06-03T12:00:00.000Z');

    const attribution = recordAmrEntry(track, 'chat_error_recharge', now);

    expect(attribution).toMatchObject({
      sourceProduct: 'open_design',
      sourceDetail: 'chat_error_recharge',
      occurredAt: '2026-06-03T12:00:00.000Z',
    });
    expect(readAmrAttribution(now)).toEqual(attribution);
    expect(track).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not mirror AMR onboarding profile analytics without metrics consent', () => {
    const track = vi.fn();
    const entryTime = new Date('2026-06-03T12:00:00.000Z');
    const profileTime = new Date('2026-06-03T12:03:00.000Z');
    const attribution = recordAmrEntry(track, 'onboarding_amr_card', entryTime);
    fetchMock.mockClear();

    const updated = syncAmrAttributionWithOnboardingProfile(
      {
        role: 'pm',
        orgSize: 'startup',
        useCase: ['product', 'design-system'],
        source: 'github',
      },
      { odDeviceId: null, now: profileTime },
    );

    expect(updated).toMatchObject({
      entryId: attribution.entryId,
      sourceDetail: 'onboarding_amr_card',
      odRole: 'pm',
      odOrgSize: 'startup',
      odUseCase: ['product', 'design-system'],
      odSource: 'github',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    'settings_amr_console',
    'avatar_amr_console',
    'handoff_amr_website',
  ] as const)(
    'ignores %s attribution when About you is submitted later',
    (sourceDetail) => {
      const track = vi.fn();
      const entryTime = new Date('2026-06-03T12:00:00.000Z');
      const profileTime = new Date('2026-06-03T12:03:00.000Z');
      const attribution = recordAmrEntry(track, sourceDetail, entryTime, {
        metricsConsent: true,
      });
      fetchMock.mockClear();

      const updated = syncAmrAttributionWithOnboardingProfile(
        {
          role: 'pm',
          orgSize: 'startup',
          useCase: ['product', 'design-system'],
          source: 'github',
        },
        {
          metricsConsent: true,
          odDeviceId: 'od-install-abc',
          now: profileTime,
        },
      );

      expect(updated).toBeNull();
      expect(readAmrAttribution(profileTime)).toEqual(attribution);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('expires stored attribution after seven days', () => {
    const track = vi.fn();
    const attribution = recordAmrEntry(
      track,
      'settings_amr_authorize',
      new Date('2026-06-03T12:00:00.000Z'),
    );

    expect(readAmrAttribution(new Date('2026-06-10T11:59:59.000Z'))).toEqual(
      attribution,
    );
    expect(readAmrAttribution(new Date('2026-06-10T12:00:01.000Z'))).toBeNull();
  });

  // A campaign entry has to outlive the ordinary window, because the campaign
  // itself is longer than it: someone who clicks a banner on day 1 and
  // subscribes on day 11 is a conversion the campaign earned, and a 7-day
  // record would have dropped their entry before the payment landed —
  // under-reporting the campaign against its own success metric.
  it('keeps a campaign entry for the full two-week campaign window', () => {
    const track = vi.fn();
    const attribution = recordAmrEntry(
      track,
      'deepseek_workbench_badge',
      new Date('2026-08-14T12:00:00.000Z'),
      { campaignId: 'deepseek_v4_pro', conversionSource: 'deepseek_workbench_badge' },
    );

    // Day 11 — past the ordinary window, still inside the campaign.
    expect(readAmrAttribution(new Date('2026-08-25T12:00:00.000Z'))).toEqual(
      attribution,
    );
    // The last moment of the fourteenth day still counts.
    expect(readAmrAttribution(new Date('2026-08-28T11:59:59.000Z'))).toEqual(
      attribution,
    );
    // Past fourteen days it expires like anything else — the longer window is
    // scoped to the campaign, not an open-ended exemption.
    expect(readAmrAttribution(new Date('2026-08-28T12:00:01.000Z'))).toBeNull();
  });

  // The extended window is keyed on the campaign stamp, so a non-campaign entry
  // recorded during the campaign keeps the ordinary seven days.
  it('leaves non-campaign entries on the ordinary seven-day window', () => {
    const track = vi.fn();
    recordAmrEntry(
      track,
      'settings_amr_authorize',
      new Date('2026-08-14T12:00:00.000Z'),
    );

    expect(readAmrAttribution(new Date('2026-08-25T12:00:00.000Z'))).toBeNull();
  });

  it('keeps functional AMR wallet parameters while removing tracking identifiers', () => {
    expect(
      attributedAmrUrl('https://open-design.ai/amr/dashboard?tab=recharge&source=open_design&od_entry_id=old&utm_source=app', {
        entryId: 'od-amr-entry-123',
        sourceProduct: 'open_design',
        sourceDetail: 'generation_preview_recharge',
        occurredAt: '2026-06-03T12:00:00.000Z',
      }, 'od-install-abc'),
    ).toBe('https://open-design.ai/amr/dashboard?tab=recharge');
  });

  it('never forwards the installation id even with legacy metrics consent', () => {
    expect(
      amrHandoffDeviceId({
        metricsConsent: true,
        resolvedDeviceId: 'od-install-abc',
        installationId: 'od-install-abc',
      }),
    ).toBeNull();
  });
});
