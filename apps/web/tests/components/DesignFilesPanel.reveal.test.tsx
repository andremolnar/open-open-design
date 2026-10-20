// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DesignFilesPanel } from '../../src/components/DesignFilesPanel';

const mocks = vi.hoisted(() => ({ reveal: vi.fn(), version: vi.fn() }));
vi.mock('../../src/providers/project-reveal', () => ({ revealProjectPath: mocks.reveal }));
vi.mock('../../src/providers/registry', async (original) => ({
  ...await original<typeof import('../../src/providers/registry')>(), fetchAppVersionInfo: mocks.version,
}));
vi.mock('../../src/components/codebase-binding/CodebaseBindingEntry', () => ({ CodebaseBindingMenuItem: () => null }));

function panel(overrides: Partial<ComponentProps<typeof DesignFilesPanel>> = {}) {
  return <DesignFilesPanel
    projectId="project-a" projectKind="prototype"
    files={[{ name: 'notes & images.txt', path: 'notes & images.txt', type: 'file', kind: 'text', mime: 'text/plain', size: 1, mtime: 1 }]}
    folders={[{ name: 'assets', path: 'assets', type: 'dir', size: 0, mtime: 1 }]}
    liveArtifacts={[]} onRefreshFiles={vi.fn()} onOpenFile={vi.fn()} onOpenLiveArtifact={vi.fn()}
    onRenameFile={vi.fn()} onDeleteFile={vi.fn()} onDeleteFiles={vi.fn()} onUpload={vi.fn()}
    onUploadFiles={vi.fn()} onPaste={vi.fn()} onNewSketch={vi.fn()} {...overrides}
  />;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.version.mockResolvedValue({ platform: 'darwin' });
  mocks.reveal.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

describe('Design Files native reveal', () => {
  it('offers Reveal in Finder in the actual project actions menu and opens the project root', async () => {
    render(panel());
    fireEvent.click(screen.getByRole('button', { name: 'Project actions' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Reveal in Finder' }));
    await waitFor(() => expect(mocks.reveal).toHaveBeenCalledWith('project-a', {}, null));
    expect(screen.queryByRole('menu')).toBeNull();
  });
  it.each([['win32', 'Reveal in Explorer'], ['linux', 'Reveal in file manager'], ['unknown', 'Reveal in file manager']])('labels the action for the daemon platform %s', async (platform, label) => {
    mocks.version.mockResolvedValue({ platform });
    render(panel());
    fireEvent.click(screen.getByRole('button', { name: 'Project actions' }));
    expect(await screen.findByRole('menuitem', { name: label })).toBeTruthy();
  });
  it('reveals a file from its ellipsis menu without opening or downloading it', async () => {
    const onOpenFile = vi.fn();
    render(panel({ onOpenFile }));
    fireEvent.click(screen.getByTestId('design-files-tab-cat:text'));
    fireEvent.click(screen.getByTestId('design-file-menu-notes & images.txt'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Reveal in Finder' }));
    await waitFor(() => expect(mocks.reveal).toHaveBeenCalledWith('project-a', { path: 'notes & images.txt' }, null));
    expect(onOpenFile).not.toHaveBeenCalled();
  });
  it('reveals files from the native right-click context gesture', async () => {
    render(panel());
    fireEvent.click(screen.getByTestId('design-files-tab-cat:text'));
    fireEvent.contextMenu(screen.getByTestId('design-file-row-notes & images.txt'), { clientX: 250, clientY: 150 });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Reveal in Finder' }));
    await waitFor(() => expect(mocks.reveal).toHaveBeenCalledWith('project-a', { path: 'notes & images.txt' }, null));
  });
  it('provides a menu for empty folders as well', async () => {
    render(panel({ files: [] }));
    fireEvent.click(screen.getByTestId('design-folder-menu-assets'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Reveal in Finder' }));
    await waitFor(() => expect(mocks.reveal).toHaveBeenCalledWith('project-a', { path: 'assets' }, null));
  });
  it.each(['html', 'image'] as const)('reveals %s cards via right-click as well as their ellipsis', async (kind) => {
    const name = kind === 'html' ? 'page.html' : 'image.png';
    render(panel({ folders: [], files: [{ name, path: name, type: 'file', kind, mime: kind === 'html' ? 'text/html' : 'image/png', size: 1, mtime: 1 }] }));
    fireEvent.contextMenu(screen.getByTestId(`design-file-row-${name}`), { clientX: 250, clientY: 150 });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Reveal in Finder' }));
    await waitFor(() => expect(mocks.reveal).toHaveBeenCalledWith('project-a', { path: name }, null));
  });
  it('reports a failed native launch visibly', async () => {
    mocks.reveal.mockRejectedValue(new Error('native file browser is not available'));
    render(panel());
    fireEvent.click(screen.getByRole('button', { name: 'Project actions' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Reveal in Finder' }));
    expect((await screen.findByRole('alert')).textContent).toContain('native file browser is not available');
  });
  it('does not apply an old project failure after leaving and returning to that project', async () => {
    let reject!: (error: Error) => void;
    mocks.reveal.mockReturnValue(new Promise((_resolve, fail) => { reject = fail; }));
    const view = render(panel());
    fireEvent.click(screen.getByRole('button', { name: 'Project actions' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Reveal in Finder' }));
    view.rerender(panel({ projectId: 'project-b' }));
    view.rerender(panel({ projectId: 'project-a' }));
    await act(async () => reject(new Error('old project failure')));
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('keeps the existing read-only menu policy', () => {
    render(panel({ viewerOnly: true }));
    fireEvent.click(screen.getByTestId('design-files-tab-cat:text'));
    expect(screen.queryByRole('button', { name: 'Project actions' })).toBeNull();
    fireEvent.contextMenu(screen.getByTestId('design-file-row-notes & images.txt'));
    expect(screen.queryByTestId('design-file-menu-popover')).toBeNull();
    expect(mocks.reveal).not.toHaveBeenCalled();
  });
});
