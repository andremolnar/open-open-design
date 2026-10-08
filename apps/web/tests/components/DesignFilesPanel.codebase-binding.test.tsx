// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import type { ProjectCodebaseBindingResponse } from '@open-design/contracts';
import { CollabProvider, type CollabContextValue } from '../../src/collab/collab-context';
import { advanceWorkspaceAccountGeneration, resetWorkspaceAccountGeneration } from '../../src/collab/workspace-identity';
import { DesignFilesPanel } from '../../src/components/DesignFilesPanel';
import { workspaceContextFixture } from '../helpers/workspace-context';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../src/providers/codebase-binding', async (original) => ({
  ...await original<typeof import('../../src/providers/codebase-binding')>(),
  fetchProjectCodebaseBinding: mocks.get,
}));
vi.mock('@open-design/host', () => ({
  isOpenDesignHostAvailable: () => false,
  pickHostWorkingDir: vi.fn(),
}));

function status(projectId = 'project-a', overrides: Partial<ProjectCodebaseBindingResponse> = {}): ProjectCodebaseBindingResponse {
  return {
    projectId, designStoragePath: `/designs/${projectId}`, binding: null,
    status: 'unbound', reason: null, message: null,
    capabilities: { canBind: true, requiresTrustedPicker: true }, ...overrides,
  };
}
const bound = {
  schemaVersion: 1, revision: 1, sourceRoot: '/source/repo', appRelativePath: '.', updatedAt: 1,
};
function collab(overrides: Partial<CollabContextValue> = {}): CollabContextValue {
  return {
    workspaceContext: null, workspaceContextLoading: false, projectResourceAuthority: 'local',
    enabled: false, member: null, present: [], publishedVersion: null, syncState: null,
    viewerOnly: false, writerAuthority: 'pending', isOwner: false, isEffectiveOwner: false,
    isSharedNonOwner: false, ownerDisplayName: null, ownerRole: null,
    downloadPending: false, materializationPending: false,
    reportChange: vi.fn(), requestPublish: vi.fn(), refreshPresence: vi.fn(), checkStatusNow: vi.fn(),
    ...overrides,
  };
}
function panel(overrides: Partial<ComponentProps<typeof DesignFilesPanel>> = {}, context = collab()) {
  return (
    <CollabProvider value={context}>
      <DesignFilesPanel
        projectId="project-a"
        projectName="Design A"
        projectKind="prototype"
        files={[]}
        liveArtifacts={[]}
        onRefreshFiles={vi.fn()}
        onOpenFile={vi.fn()}
        onOpenLiveArtifact={vi.fn()}
        onRenameFile={vi.fn()}
        onDeleteFile={vi.fn()}
        onDeleteFiles={vi.fn()}
        onUpload={vi.fn()}
        onUploadFiles={vi.fn()}
        onPaste={vi.fn()}
        onNewSketch={vi.fn()}
        {...overrides}
      />
    </CollabProvider>
  );
}
const flush = () => act(async () => {});
async function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'Project actions' }));
  await flush();
}
async function openDialog(label = 'Connect codebase…') {
  await openMenu();
  fireEvent.click(screen.getByRole('menuitem', { name: label }));
  await flush();
}

beforeEach(() => {
  vi.clearAllMocks();
  resetWorkspaceAccountGeneration();
  mocks.get.mockImplementation(async (projectId: string) => status(projectId));
});
afterEach(() => { cleanup(); resetWorkspaceAccountGeneration(); });

describe('Design Files codebase action', () => {
  it('opens the shared dialog from the assets menu even without legacy actions and keeps it mounted after the menu closes', async () => {
    render(panel());
    await openDialog();

    expect(screen.queryByRole('menu')).toBeNull();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Design A')).toBeTruthy();
    expect(within(dialog).getByText('/designs/project-a')).toBeTruthy();
    expect(mocks.get).toHaveBeenLastCalledWith('project-a', expect.objectContaining({ workspaceContext: null }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Project actions' }));
    await openDialog();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Project actions' }));
  });

  it('preserves Create design system and Duplicate beside the new action', async () => {
    const onCreateDesignSystemFromProject = vi.fn();
    const onDuplicateProject = vi.fn();
    render(panel({ onCreateDesignSystemFromProject, onDuplicateProject }));
    await openMenu();
    expect(screen.getByRole('menuitem', { name: 'Connect codebase…' })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Create design system from this project' }));
    expect(onCreateDesignSystemFromProject).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
    await openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate project' }));
    expect(onDuplicateProject).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows Manage for a connected project and uses its exact project workspace in both reads', async () => {
    const workspaceContext = workspaceContextFixture({ workspaceId: 'project-team', workspaceMemberId: 'owner' });
    mocks.get.mockResolvedValue(status('project-a', { binding: bound, status: 'connected' }));
    render(panel({}, collab({ workspaceContext, projectResourceAuthority: 'workspace', writerAuthority: 'allowed' })));
    await openDialog('Manage codebase…');
    expect(within(screen.getByRole('dialog')).getByText('/source/repo')).toBeTruthy();
    expect(mocks.get).toHaveBeenCalledTimes(2);
    for (const [projectId, options] of mocks.get.mock.calls) {
      expect(projectId).toBe('project-a');
      expect(options.workspaceContext).toBe(workspaceContext);
    }
  });

  it.each(['pending', 'denied'] as const)('disables binding when team writer authority is %s', async (writerAuthority) => {
    const workspaceContext = workspaceContextFixture({ workspaceId: 'team-a', workspaceMemberId: 'member-a' });
    render(panel({}, collab({ workspaceContext, projectResourceAuthority: 'workspace', writerAuthority })));
    await openMenu();
    const action = screen.getByRole('menuitem', { name: 'Connect codebase…' }) as HTMLButtonElement;
    expect(action.disabled).toBe(true);
    fireEvent.click(action);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it.each(['pending', 'denied'] as const)('disables binding while project resource authority is %s', async (projectResourceAuthority) => {
    render(panel({}, collab({ projectResourceAuthority })));
    await openMenu();
    expect((screen.getByRole('menuitem', { name: 'Connect codebase…' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it.each([
    { workspaceContextLoading: true },
    { viewerOnly: true },
  ])('respects unresolved scope and workspace read-only gates', async (restriction) => {
    render(panel({}, collab(restriction)));
    await openMenu();
    const action = screen.getByRole('menuitem', { name: 'Connect codebase…' }) as HTMLButtonElement;
    expect(action.disabled).toBe(true);
    fireEvent.click(action);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the existing viewer-only project menu hidden and disables unsupported binding', async () => {
    const view = render(panel({ viewerOnly: true }));
    expect(screen.queryByRole('button', { name: 'Project actions' })).toBeNull();
    view.rerender(panel());
    mocks.get.mockResolvedValue(status('project-a', { status: 'unsupported', capabilities: { canBind: false, requiresTrustedPicker: true } }));
    await openMenu();
    const action = screen.getByRole('menuitem', { name: 'Connect codebase…' }) as HTMLButtonElement;
    expect(action.disabled).toBe(true);
    fireEvent.click(action);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it.each(['project', 'workspace', 'account'] as const)('dismisses the dialog across a %s switch and does not resurrect it when switching back', async (boundary) => {
    const workspaceContext = workspaceContextFixture({ workspaceId: 'team-a', workspaceMemberId: 'owner' });
    const context = collab({ workspaceContext, projectResourceAuthority: 'workspace', writerAuthority: 'allowed' });
    const view = render(panel({}, context));
    await openDialog();
    expect(screen.getByRole('dialog')).toBeTruthy();
    if (boundary === 'account') advanceWorkspaceAccountGeneration('next-account');
    const nextContext = boundary === 'workspace'
      ? { ...context, workspaceContext: workspaceContextFixture({ workspaceId: 'team-b', workspaceMemberId: 'owner-b' }) }
      : context;
    const nextProps = boundary === 'project' ? { projectId: 'project-b', projectName: 'Design B' } : {};
    view.rerender(panel(nextProps, nextContext));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
    view.rerender(panel({}, context));
    expect(screen.queryByRole('dialog')).toBeNull();
    await openDialog();
    expect(within(screen.getByRole('dialog')).getByText('Design A')).toBeTruthy();
  });

  it('closes an open dialog if writer authority is revoked', async () => {
    const workspaceContext = workspaceContextFixture({ workspaceId: 'team-a', workspaceMemberId: 'owner' });
    const context = collab({ workspaceContext, projectResourceAuthority: 'workspace', writerAuthority: 'allowed' });
    const view = render(panel({}, context));
    await openDialog();
    view.rerender(panel({}, { ...context, writerAuthority: 'denied' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    view.rerender(panel({}, context));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('ignores a previous menu status response after navigating and opens only the newly selected project', async () => {
    let resolveOld!: (value: ProjectCodebaseBindingResponse) => void;
    mocks.get.mockReturnValueOnce(new Promise<ProjectCodebaseBindingResponse>((resolve) => { resolveOld = resolve; }));
    const view = render(panel());
    await openMenu();
    const oldSignal = mocks.get.mock.calls[0]?.[1].signal as AbortSignal;
    view.rerender(panel({ projectId: 'project-b', projectName: 'Design B' }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(oldSignal.aborted).toBe(true);
    await act(async () => { resolveOld(status('project-a', { binding: bound, status: 'connected' })); });
    await openMenu();
    expect(screen.queryByRole('menuitem', { name: 'Manage codebase…' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Connect codebase…' }));
    await flush();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Design B')).toBeTruthy();
    expect(within(dialog).getByText('/designs/project-b')).toBeTruthy();
    expect(mocks.get).toHaveBeenLastCalledWith('project-b', expect.anything());
  });
});
