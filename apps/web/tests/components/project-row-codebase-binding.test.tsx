// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectCodebaseBindingResponse, WorkspaceCollabContext } from '@open-design/contracts';
import { RecentProjectsStrip } from '../../src/components/RecentProjectsStrip';
import { RailRecentRow } from '../../src/components/entry-nav-rail/RailRecentRow';
import { I18nProvider } from '../../src/i18n';
import { advanceWorkspaceAccountGeneration, resetWorkspaceAccountGeneration } from '../../src/collab/workspace-identity';
import type { Project } from '../../src/types';

const mocks = vi.hoisted(() => ({
  get: vi.fn(), validate: vi.fn(), save: vi.fn(), pick: vi.fn(),
  reveal: vi.fn(), version: vi.fn(),
  context: null as WorkspaceCollabContext | null,
  loading: false,
}));
vi.mock('../../src/collab/useWorkspaceContext', () => ({
  notifyTeamProjectsChanged: vi.fn(),
  useWorkspaceBilling: () => null,
  useWorkspaceContext: () => ({ context: mocks.context, loading: mocks.loading, failure: null, refresh: vi.fn() }),
}));
vi.mock('../../src/collab/useTeamMembers', () => ({ useTeamMembers: () => ({ resolve: () => null }) }));
vi.mock('@open-design/host', async (original) => ({
  ...await original<typeof import('@open-design/host')>(),
  isOpenDesignHostAvailable: () => true,
  pickHostWorkingDir: mocks.pick,
}));
vi.mock('../../src/providers/registry', async (original) => ({
  ...await original<typeof import('../../src/providers/registry')>(),
  fetchProjectFiles: vi.fn(async () => []),
  fetchProjectFileText: vi.fn(async () => null),
  fetchAppVersionInfo: mocks.version,
}));
vi.mock('../../src/providers/project-reveal', () => ({ revealProjectPath: mocks.reveal }));
vi.mock('../../src/providers/codebase-binding', async (original) => ({
  ...await original<typeof import('../../src/providers/codebase-binding')>(),
  fetchProjectCodebaseBinding: mocks.get,
  validateProjectCodebaseBinding: mocks.validate,
  saveProjectCodebaseBinding: mocks.save,
}));

const context = {
  workspaceId: 'ws-one', workspaceType: 'team', workspaceMemberId: 'member-one',
  role: 'owner', memberStatus: 'active', lifecycleState: 'active',
  permissions: { canShareProjects: true, canWriteSyncedFiles: true },
} as WorkspaceCollabContext;
const projects: Project[] = ['Alpha', 'Beta'].map((name, index) => ({
  id: name.toLowerCase(), name, skillId: null, designSystemId: null,
  createdAt: 1, updatedAt: 2 - index,
}));
const binding = { schemaVersion: 1, revision: 2, sourceRoot: '/source/beta', appRelativePath: '.', updatedAt: 1 };
function status(projectId: string, overrides: Partial<ProjectCodebaseBindingResponse> = {}): ProjectCodebaseBindingResponse {
  return {
    projectId, designStoragePath: `/designs/${projectId}`, binding: null,
    status: 'unbound', reason: null, message: null,
    capabilities: { canBind: true, requiresTrustedPicker: true }, ...overrides,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
const flush = () => act(async () => {});
type Surface = 'Home cards' | 'recent rail';
function renderSurface(surface: Surface, options: { foreign?: boolean; callbacks?: boolean } = {}) {
  const onOpen = vi.fn();
  const onRename = options.callbacks ? vi.fn() : undefined;
  const onDuplicate = options.callbacks ? vi.fn() : undefined;
  const onDelete = options.callbacks ? vi.fn(async () => true) : undefined;
  const onMove = vi.fn();
  const tree = (catalog = projects) => (
    <I18nProvider initial="en">
      {surface === 'Home cards' ? (
        <RecentProjectsStrip
          projects={catalog}
          onOpen={onOpen}
          onRename={onRename}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
          isSharedProject={(id) => options.foreign === true && id === 'beta'}
          projectOwnerMemberIds={options.foreign ? new Map([['beta', 'member-other']]) : undefined}
        />
      ) : catalog.map((project) => (
        <RailRecentRow
          key={project.id}
          project={project}
          workspaceContext={mocks.context}
          ownedBySelf={!options.foreign || project.id !== 'beta'}
          shared={options.foreign && project.id === 'beta'}
          moveToTeamAvailable
          onOpen={onOpen}
          onRename={onRename}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
          onMoveToTeam={options.callbacks ? onMove : undefined}
        />
      ))}
    </I18nProvider>
  );
  const view = render(tree());
  return { ...view, rerenderCatalog: (catalog = projects) => view.rerender(tree(catalog)), onOpen, onDuplicate };
}
async function openMenu(row = 0) {
  const trigger = screen.getAllByRole('button', { name: 'More actions' })[row]!;
  fireEvent.click(trigger);
  await flush();
  return trigger;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  resetWorkspaceAccountGeneration();
  window.localStorage.clear();
  mocks.context = context;
  mocks.loading = false;
  mocks.version.mockResolvedValue({ platform: 'darwin' });
  mocks.reveal.mockResolvedValue({ ok: true });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } })));
  mocks.get.mockImplementation(async (id: string) => status(id, id === 'beta' ? { binding, status: 'connected' } : {}));
  mocks.pick.mockResolvedValue({ ok: true, baseDir: '/source/selected', token: 'picker-token' });
  mocks.validate.mockResolvedValue({ sourceRoot: '/source/selected', appRelativePath: '.', appRoot: '/source/selected', selectionFingerprint: 'selection' });
  mocks.save.mockImplementation(async (id: string) => status(id, { binding, status: 'connected' }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); resetWorkspaceAccountGeneration(); });

describe.each<Surface>(['Home cards', 'recent rail'])('%s codebase action', (surface) => {
  it('offers native reveal beside Manage codebase and targets the selected project', async () => {
    const view = renderSurface(surface, { callbacks: true });
    await openMenu(1);
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Manage codebase…' })).toBeTruthy();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Reveal in Finder' }));
    await flush();
    expect(mocks.reveal).toHaveBeenCalledWith('beta', {}, context);
    expect(view.onOpen).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
  });
  it('opens Manage for the chosen row, dismisses its menu, and preserves other project actions', async () => {
    const view = renderSurface(surface, { callbacks: true });
    const trigger = await openMenu(1);
    const menu = screen.getByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Manage codebase…', 'Reveal in Finder', 'Rename', 'Duplicate project', 'Move to team space', 'Delete',
    ]);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Manage codebase…' }));
    await flush();
    expect(screen.queryByRole('menu')).toBeNull();
    const dialog = screen.getByRole('dialog', { name: 'Manage codebase' });
    expect(within(dialog).getByText('Beta')).toBeTruthy();
    expect(within(dialog).getByText('/designs/beta')).toBeTruthy();
    expect(mocks.get).toHaveBeenLastCalledWith('beta', expect.objectContaining({ workspaceContext: context }));
    expect(view.onOpen).not.toHaveBeenCalled();
    if (surface === 'recent rail') {
      // React portal events still traverse the owning row. A modal must not
      // reopen its hover preview after releasing that row's menu claim.
      const pointer = new MouseEvent('pointerover', { bubbles: true });
      Object.defineProperty(pointer, 'pointerType', { value: 'mouse' });
      fireEvent(dialog, pointer);
      expect(document.querySelector('.entry-nav-rail__recent-preview')).toBeNull();
    }
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await openMenu(1);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate project' }));
    await flush();
    expect(view.onDuplicate).toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('offers Connect even without other action callbacks and keeps a save attached to the selected row after sorting', async () => {
    // No team action can incidentally keep the old menu trigger available.
    mocks.context = { ...context, workspaceType: 'personal', permissions: { ...context.permissions, canShareProjects: false } };
    const pending = deferred<ProjectCodebaseBindingResponse>();
    mocks.save.mockReturnValue(pending.promise);
    const view = renderSurface(surface);
    await openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Connect codebase…' }));
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Choose folder' }));
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    const save = screen.getByRole('button', { name: 'Save connection' });
    act(() => { fireEvent.click(save); fireEvent.click(save); });
    view.rerenderCatalog(projects.map((project) => ({ ...project, updatedAt: 3 - project.updatedAt })));
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save).toHaveBeenCalledWith('alpha', {
      sourceRoot: '/source/selected', appRelativePath: '.', expectedRevision: null, expectedSelection: 'selection',
    }, { workspaceContext: mocks.context, desktopImportToken: 'picker-token' });
    expect(within(screen.getByRole('dialog')).getByText('Alpha')).toBeTruthy();
    await act(async () => { pending.resolve(status('alpha', { binding, status: 'connected' })); });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('disables binding for a foreign-owned row and for an unsupported workspace', async () => {
    renderSurface(surface, { foreign: true, callbacks: true });
    await openMenu(1);
    const foreign = screen.getByRole('menuitem', { name: 'Manage codebase…' }) as HTMLButtonElement;
    expect(foreign.disabled).toBe(true);
    fireEvent.click(foreign);
    expect(screen.queryByRole('dialog')).toBeNull();
    mocks.get.mockImplementation(async (id: string) => status(id, { status: 'unsupported', capabilities: { canBind: false, requiresTrustedPicker: true } }));
    await openMenu();
    const unsupported = screen.getByRole('menuitem', { name: 'Connect codebase…' }) as HTMLButtonElement;
    expect(unsupported.disabled).toBe(true);
    fireEvent.click(unsupported);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('dismisses when its project leaves the catalog and ignores the abandoned picker', async () => {
    const picker = deferred<{ ok: true; baseDir: string; token: string }>();
    mocks.pick.mockReturnValue(picker.promise);
    const view = renderSurface(surface);
    await openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Connect codebase…' }));
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Choose folder' }));
    view.rerenderCatalog([projects[1]!]);
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(async () => { picker.resolve({ ok: true, baseDir: '/late', token: 'late-token' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(mocks.validate).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('never lets an old account save dismiss a newly opened row dialog', async () => {
    const pending = deferred<ProjectCodebaseBindingResponse>();
    mocks.save.mockReturnValue(pending.promise);
    const view = renderSurface(surface);
    await openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Connect codebase…' }));
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Choose folder' }));
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    fireEvent.click(screen.getByRole('button', { name: 'Save connection' }));
    advanceWorkspaceAccountGeneration('new-account-during-save');
    view.rerenderCatalog();
    expect(screen.queryByRole('dialog')).toBeNull();
    await openMenu(1);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Manage codebase…' }));
    await flush();
    await act(async () => { pending.resolve(status('alpha', { binding, status: 'connected' })); });
    expect(within(screen.getByRole('dialog')).getByText('Beta')).toBeTruthy();
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save.mock.calls[0]?.[0]).toBe('alpha');
  });

  it.each(['workspace', 'account'] as const)('dismisses across a %s change and ignores a late folder-picker result', async (boundary) => {
    const picker = deferred<{ ok: true; baseDir: string; token: string }>();
    mocks.pick.mockReturnValue(picker.promise);
    const view = renderSurface(surface);
    await openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Connect codebase…' }));
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Choose folder' }));
    if (boundary === 'workspace') mocks.context = { ...context, workspaceId: 'ws-two' };
    else advanceWorkspaceAccountGeneration('new-account');
    view.rerenderCatalog();
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(async () => { picker.resolve({ ok: true, baseDir: '/late', token: 'late-token' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(mocks.validate).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    await openMenu(1);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Manage codebase…' }));
    await flush();
    expect(within(screen.getByRole('dialog')).getByText('Beta')).toBeTruthy();
    expect(mocks.get).toHaveBeenLastCalledWith('beta', expect.objectContaining({ workspaceContext: mocks.context }));
  });
});
