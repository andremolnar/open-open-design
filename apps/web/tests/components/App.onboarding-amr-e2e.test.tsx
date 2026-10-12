// @vitest-environment jsdom
//
// Mount the real App and router with a legacy incomplete setup and old bookmark.
// Neither may resurrect Welcome or block the Home surface after hydration.

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../../src/App';
import type { AppConfig } from '../../src/types';
import { loadConfig, fetchDaemonConfig } from '../../src/state/config';
import {
  daemonIsLive,
  fetchAgentsStream,
  fetchAppVersionInfo,
  fetchDesignSystems,
  fetchDesignTemplates,
  fetchPromptTemplates,
  fetchSkills,
} from '../../src/providers/registry';
import { fetchAmrModels } from '../../src/providers/daemon';
import { listProjects, listTemplates } from '../../src/state/projects';

const analyticsMocks = vi.hoisted(() => ({ track: vi.fn() }));

// App owns route eligibility; the host suites separately exercise authorization,
// network cancellation and verified content. These stand-ins expose whether App
// allows either host to display over the real onboarding page.
vi.mock('../../src/components/ProductionCampaignModal', () => ({
  ProductionCampaignModal: ({ authenticated }: { authenticated: boolean }) =>
    authenticated ? <div role="dialog" aria-label="Production campaign witness" /> : null,
}));
vi.mock('../../src/components/TestCampaignModal', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/components/TestCampaignModal')>()),
  TestCampaignModal: ({ authenticated }: { authenticated: boolean }) =>
    authenticated ? <div role="dialog" aria-label="Test campaign witness" /> : null,
}));

// The badge and the hover entry are the top-right CMS touchpoints. Their own
// suites cover authorization and content; here they only report whether App's
// route gating lets either one on screen.
vi.mock('../../src/components/ProductionCampaignBadge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/components/ProductionCampaignBadge')>()),
  ProductionCampaignBadge: () => <div data-testid="production-campaign-badge-witness" />,
}));
vi.mock('../../src/components/ProductionCampaignHover', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/components/ProductionCampaignHover')>()),
  ProductionCampaignHover: () => <div data-testid="production-campaign-hover-witness" />,
}));

vi.mock('../../src/analytics/provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/analytics/provider')>();
  return {
    ...actual,
    useAnalytics: () => ({
      newRequestId: vi.fn(() => 'request-1'),
      setConfigureGlobals: vi.fn(),
      setConsent: vi.fn(),
      setIdentity: vi.fn(),
      setUserId: vi.fn(),
      track: analyticsMocks.track,
    }),
    useAppVersion: () => null,
  };
});

vi.mock('../../src/components/pet/PetOverlay', () => ({
  PetOverlay: () => null,
}));
vi.mock('../../src/components/pet/pets', () => ({
  migrateCustomPetAtlas: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../src/providers/registry', async () => {
  const actual = await vi.importActual<typeof import('../../src/providers/registry')>(
    '../../src/providers/registry',
  );
  return {
    ...actual,
    daemonIsLive: vi.fn(),
    fetchAgentsStream: vi.fn(),
    fetchAppVersionInfo: vi.fn(),
    fetchDesignSystems: vi.fn(),
    fetchDesignTemplates: vi.fn(),
    fetchPromptTemplates: vi.fn(),
    fetchSkills: vi.fn(),
  };
});

vi.mock('../../src/providers/daemon', async () => {
  const actual = await vi.importActual<typeof import('../../src/providers/daemon')>(
    '../../src/providers/daemon',
  );
  return { ...actual, fetchAmrModels: vi.fn() };
});

vi.mock('../../src/state/projects', async () => {
  const actual = await vi.importActual<typeof import('../../src/state/projects')>(
    '../../src/state/projects',
  );
  return { ...actual, listProjects: vi.fn(), listTemplates: vi.fn() };
});

// Keep the REAL mergeDaemonConfig/loadConfig logic; only stub the network
// writes and the daemon GET so we can drive a deterministic first-run.
vi.mock('../../src/state/config', async () => {
  const actual = await vi.importActual<typeof import('../../src/state/config')>(
    '../../src/state/config',
  );
  return {
    ...actual,
    fetchComposioConfigFromDaemon: vi.fn().mockResolvedValue(null),
    loadConfig: vi.fn(),
    fetchDaemonConfig: vi.fn(),
    fetchMediaProvidersFromDaemon: vi.fn().mockResolvedValue({ status: 'ok', providers: null }),
    syncComposioConfigToDaemon: vi.fn().mockResolvedValue(true),
    syncConfigToDaemon: vi.fn().mockResolvedValue(undefined),
    syncMediaProvidersToDaemon: vi.fn().mockResolvedValue(undefined),
    saveConfig: vi.fn(),
  };
});

const mockedDaemonIsLive = vi.mocked(daemonIsLive);
const mockedFetchAgentsStream = vi.mocked(fetchAgentsStream);
const mockedFetchAppVersionInfo = vi.mocked(fetchAppVersionInfo);
const mockedFetchDesignSystems = vi.mocked(fetchDesignSystems);
const mockedFetchDesignTemplates = vi.mocked(fetchDesignTemplates);
const mockedFetchPromptTemplates = vi.mocked(fetchPromptTemplates);
const mockedFetchSkills = vi.mocked(fetchSkills);
const mockedFetchAmrModels = vi.mocked(fetchAmrModels);
const mockedListProjects = vi.mocked(listProjects);
const mockedListTemplates = vi.mocked(listTemplates);
const mockedLoadConfig = vi.mocked(loadConfig);
const mockedFetchDaemonConfig = vi.mocked(fetchDaemonConfig);

const claudeAgent = {
  id: 'claude',
  name: 'Claude Code',
  bin: 'claude',
  available: true,
  version: '1.0.0',
  models: [{ id: 'sonnet', label: 'Sonnet' }],
};
const amrAgent = {
  id: 'amr',
  name: 'AMR',
  bin: 'vela',
  available: true,
  version: '1.0.0',
  models: [{ id: 'amr-model', label: 'AMR Model' }],
};

function firstRunConfig(): AppConfig {
  return {
    mode: 'daemon',
    apiKey: '',
    apiProtocol: 'anthropic',
    apiVersion: '',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-5',
    apiProviderBaseUrl: 'https://api.anthropic.com',
    apiProtocolConfigs: {},
    agentId: null,
    skillId: null,
    designSystemId: null,
    onboardingCompleted: false,
    privacyDecisionAt: 1,
    mediaProviders: {},
    composio: {},
    agentModels: {},
    agentCliEnv: {},
  } as AppConfig;
}

beforeEach(() => {
  // jsdom polyfills the full EntryView tree expects.
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
  const win = window as unknown as Record<string, unknown>;
  win.ResizeObserver ||= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  win.IntersectionObserver ||= class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  };
  window.scrollTo = window.scrollTo || (() => {});
  window.history.replaceState(null, '', '/');

  mockedDaemonIsLive.mockResolvedValue(true);
  // AMR (vela) detection LAGS: the first probe only sees Claude. Every
  // subsequent probe (the onboarding shell re-scans when it finds no AMR)
  // returns AMR as well.
  mockedFetchAgentsStream
    .mockResolvedValueOnce([{ ...claudeAgent }])
    .mockResolvedValue([{ ...amrAgent }, { ...claudeAgent }]);
  mockedFetchSkills.mockResolvedValue([]);
  mockedFetchDesignSystems.mockResolvedValue([]);
  mockedFetchDesignTemplates.mockResolvedValue([]);
  mockedFetchPromptTemplates.mockResolvedValue([]);
  mockedFetchAppVersionInfo.mockResolvedValue(null);
  mockedListProjects.mockResolvedValue([]);
  mockedListTemplates.mockResolvedValue([]);
  mockedFetchAmrModels.mockResolvedValue({
    source: 'preset',
    refreshing: false,
    models: [{ id: 'amr-model', label: 'AMR Model' }],
  });
  mockedLoadConfig.mockReturnValue(firstRunConfig());
  mockedFetchDaemonConfig.mockResolvedValue({});

  // The onboarding + inline switcher poll the vela login status; report a
  // signed-in account so the AMR runtime is fully selectable.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const json = url.includes('/api/integrations/vela/status')
        ? {
            loggedIn: true,
            profile: 'prod',
            user: { id: 'u', email: 'user@example.com' },
            configPath: '/x',
          }
        : {};
      return new Response(JSON.stringify(json), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  analyticsMocks.track.mockReset();
});

describe('direct entry after legacy onboarding', () => {
  it('renders Home rather than Welcome for a saved incomplete setup and a legacy bookmark', async () => {
    window.history.replaceState(null, '', '/onboarding');
    render(<App />);
    await screen.findByTestId('home-hero-input');
    expect(screen.queryByRole('heading', { name: 'Welcome to OpenDesign' })).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Production campaign witness' })).toBeNull();
    expect(screen.queryByTestId('production-campaign-badge-witness')).toBeNull();
    expect(screen.queryByTestId('production-campaign-hover-witness')).toBeNull();
  });
});
