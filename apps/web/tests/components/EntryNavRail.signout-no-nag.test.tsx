// @vitest-environment jsdom
//
// A deliberate sign-out should not override a dismissed Cloud promotion or
// resurrect a passive sign-in nag. Sign-in remains available in Settings.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { WorkspaceCollabContext } from '@open-design/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EntryNavRail, resetWorkspaceDirectoryCache } from '../../src/components/EntryNavRail';
import { I18nProvider } from '../../src/i18n';

const DISMISSED_KEY = 'od.entry.cloudSignInTip.dismissed';
const originalFetch = globalThis.fetch;

function context(overrides: Partial<WorkspaceCollabContext> = {}): WorkspaceCollabContext {
  return {
    workspaceId: 'ws-1',
    workspaceType: 'team',
    workspaceMemberId: 'wm-1',
    teamName: 'Acme',
    role: 'owner',
    memberStatus: 'active',
    lifecycleState: 'active',
    billingState: 'free',
    planId: null,
    permissions: { canInviteMembers: true, canViewWorkspaceSettings: true },
    ...overrides,
  } as unknown as WorkspaceCollabContext;
}

beforeEach(() => {
  resetWorkspaceDirectoryCache();
  try {
    window.localStorage.clear();
  } catch {
    // ignore
  }
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })) as typeof fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  resetWorkspaceDirectoryCache();
  vi.restoreAllMocks();
});

describe('EntryNavRail sign-out', () => {
  it('keeps the dismissed Cloud promotion dismissed after signing out', async () => {
    window.localStorage.setItem(DISMISSED_KEY, '1');
    const onSignedOut = vi.fn();

    render(
      <I18nProvider initial="zh-CN">
        <EntryNavRail
          view="home"
          onViewChange={() => {}}
          onNewProject={() => {}}
          open
          context={context()}
          onSignedOut={onSignedOut}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByTestId('entry-nav-account'));
    fireEvent.click(screen.getByText('退出登录'));
    // Sign-out still requires explicit confirmation.
    fireEvent.click(screen.getByTestId('sign-out-confirm-accept'));

    await waitFor(() => expect(onSignedOut).toHaveBeenCalledOnce());
    expect(window.localStorage.getItem(DISMISSED_KEY)).toBe('1');
  });
});
