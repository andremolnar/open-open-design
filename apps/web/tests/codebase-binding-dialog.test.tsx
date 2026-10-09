// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectCodebaseBindingResponse } from '@open-design/contracts';
import { en } from '../src/i18n/locales/en';

const mocks = vi.hoisted(() => ({
  get: vi.fn(), validate: vi.fn(), save: vi.fn(), hostAvailable: vi.fn(), pickHost: vi.fn(), pickDaemon: vi.fn(),
}));
vi.mock('../src/i18n', () => {
  const translate = (key: keyof typeof en) => en[key];
  return { useT: () => translate };
});
vi.mock('@open-design/host', () => ({
  isOpenDesignHostAvailable: mocks.hostAvailable,
  pickHostWorkingDir: mocks.pickHost,
}));
vi.mock('../src/providers/registry', () => ({ openFolderDialog: mocks.pickDaemon }));
vi.mock('../src/providers/codebase-binding', async (original) => ({
  ...await original<typeof import('../src/providers/codebase-binding')>(),
  fetchProjectCodebaseBinding: mocks.get,
  validateProjectCodebaseBinding: mocks.validate,
  saveProjectCodebaseBinding: mocks.save,
}));
import { CodebaseBindingDialog } from '../src/components/codebase-binding/CodebaseBindingDialog';
import { CodebaseBindingError } from '../src/providers/codebase-binding';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function status(overrides: Partial<ProjectCodebaseBindingResponse> = {}): ProjectCodebaseBindingResponse {
  return {
    projectId: 'project-a', designStoragePath: '/designs/project-a', binding: null,
    status: 'unbound', reason: null, message: null,
    capabilities: { canBind: true, requiresTrustedPicker: true }, ...overrides,
  };
}
const binding = { schemaVersion: 1, revision: 4, sourceRoot: '/source/old', appRelativePath: 'apps/web', updatedAt: 1 };
const flush = () => act(async () => {});
async function choose() {
  fireEvent.click(screen.getByRole('button', { name: /^(Choose folder|Choose another folder|Reconnect)$/ }));
  await flush();
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
}
const saveButton = () => screen.getByRole('button', { name: 'Save connection' }) as HTMLButtonElement;
const appInput = () => screen.getByRole('textbox', { name: 'App/package folder' }) as HTMLInputElement;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.get.mockResolvedValue(status());
  mocks.hostAvailable.mockReturnValue(true);
  mocks.pickHost.mockResolvedValue({ ok: true, baseDir: '/alias/source', token: 'picker-token' });
  mocks.validate.mockImplementation(async (_id, input) => ({
    sourceRoot: '/canonical/source', appRelativePath: input.appRelativePath, selectionFingerprint: 'validated-selection',
    appRoot: input.appRelativePath === '.' ? '/canonical/source' : `/canonical/source/${input.appRelativePath}`,
  }));
  mocks.save.mockResolvedValue(status({ binding: { ...binding, revision: 1, sourceRoot: '/canonical/source', appRelativePath: '.' }, status: 'connected' }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('CodebaseBindingDialog', () => {
  it('offers a selectable host-session prompt with the exact saved project, root, package and revision', async () => {
    const saved = { ...binding, sourceRoot: '/source/My App', appRelativePath: 'packages/site', revision: 7 };
    mocks.get.mockResolvedValue(status({ binding: saved, status: 'connected' }));
    render(<CodebaseBindingDialog projectId="project-a" projectName="A mutable display name" onClose={vi.fn()} />);
    await flush();
    const region = screen.getByRole('region', { name: 'Work here with your coding agent' });
    const prompt = within(region).getByRole('textbox', { name: 'Prompt for your coding agent' }) as HTMLTextAreaElement;
    expect(prompt.readOnly).toBe(true);
    expect(prompt.value).toContain(JSON.stringify({ projectId: 'project-a', sourceRoot: saved.sourceRoot, appRelativePath: saved.appRelativePath, expectedBindingRevision: 7 }, null, 2));
    expect(prompt.value).not.toContain('A mutable display name');
    expect(prompt.value).not.toContain('"workspaceId":');
    expect(prompt.value).not.toContain('"workspaceMemberId":');
    expect(prompt.value).toContain('your own stable hostSessionId');
    expect(prompt.value).toContain('prepare_design_context');
    expect(prompt.value).toContain('get_design_asset');
    expect(prompt.value).toContain('checkpoint_design_workflow');
    expect(prompt.value).toContain('native tools for source edits, tests, permissions');
    expect(prompt.value).toContain('explicitly refresh');
    expect(prompt.value).toContain('binding is unchanged');
    expect(prompt.value).toContain('do not refresh the old workflow');
    expect(prompt.value).toContain('without the old workflowId or expectedRevision');
    expect(prompt.value).toContain('If authorization or project identity fails, stop');
    fireEvent.focus(prompt);
    expect(prompt.selectionStart).toBe(0);
    expect(prompt.selectionEnd).toBe(prompt.value.length);
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.validate).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('copies the exact authorized team scope into every-call MCP instructions', async () => {
    mocks.get.mockResolvedValue(status({ binding, status: 'connected', workspaceScope: { workspaceId: 'team-exact', workspaceMemberId: 'member-exact' } }));
    render(<CodebaseBindingDialog projectId="project-a" projectName="Design A" onClose={vi.fn()} />);
    await flush();
    const prompt = screen.getByRole('textbox', { name: 'Prompt for your coding agent' }) as HTMLTextAreaElement;
    expect(prompt.value).toContain('"workspaceId": "team-exact"');
    expect(prompt.value).toContain('"workspaceMemberId": "member-exact"');
    expect(prompt.value).toContain('include those exact fields in every MCP call');
    expect(prompt.value).toContain('Do not fall back to a Personal workspace');
  });

  it.each(['unbound', 'unavailable', 'unsupported'] as const)('hides work-here for a %s source', async (sourceStatus) => {
    mocks.get.mockResolvedValue(status({ status: sourceStatus, binding: sourceStatus === 'unbound' ? null : binding }));
    render(<CodebaseBindingDialog projectId="project-a" projectName="Design A" onClose={vi.fn()} />);
    await flush();
    expect(screen.queryByRole('region', { name: 'Work here with your coding agent' })).toBeNull();
  });

  it('hides the saved prompt when a rebind is being drafted or the binding changes elsewhere', async () => {
    mocks.get.mockResolvedValue(status({ binding, status: 'connected' }));
    const view = render(<CodebaseBindingDialog projectId="project-a" projectName="Design A" onClose={vi.fn()} />);
    await flush();
    await choose();
    expect(screen.queryByRole('region', { name: 'Work here with your coding agent' })).toBeNull();
    view.unmount();
    render(<CodebaseBindingDialog projectId="project-a" projectName="Design A" onClose={vi.fn()} />);
    await flush();
    mocks.get.mockResolvedValue(status({ binding: { ...binding, revision: 5 }, status: 'connected' }));
    fireEvent.focus(window);
    await flush();
    expect(screen.queryByRole('region', { name: 'Work here with your coding agent' })).toBeNull();
  });

  it('does not offer a prompt for a mismatched project response', async () => {
    mocks.get.mockResolvedValue(status({ projectId: 'other-project', binding, status: 'connected' }));
    render(<CodebaseBindingDialog projectId="project-a" projectName="Design A" onClose={vi.fn()} />);
    await flush();
    expect(screen.queryByRole('region', { name: 'Work here with your coding agent' })).toBeNull();
  });

  it('keeps design storage separate, displays canonical selection, and saves the signed picker path once', async () => {
    const pending = deferred<ProjectCodebaseBindingResponse>();
    mocks.save.mockReturnValue(pending.promise);
    const close = vi.fn();
    render(<CodebaseBindingDialog projectId="project-a" projectName="Design A" onClose={close} />);
    await flush();
    expect(within(screen.getByRole('region', { name: 'Design storage' })).getByText('/designs/project-a')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Connected source' })).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
    await choose();
    expect(screen.getByText('/canonical/source')).toBeTruthy();
    expect(saveButton().disabled).toBe(false);
    const button = saveButton();
    act(() => { fireEvent.click(button); fireEvent.click(button); });
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save).toHaveBeenCalledWith('project-a', {
      sourceRoot: '/alias/source', appRelativePath: '.', expectedRevision: null, expectedSelection: 'validated-selection',
    }, expect.objectContaining({ desktopImportToken: 'picker-token' }));
    expect(close).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { pending.resolve(status({ status: 'connected' })); });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('validates the optional app directory and preserves inputs after save failure', async () => {
    mocks.save.mockRejectedValue(new CodebaseBindingError('App folder is missing.', 400));
    render(<CodebaseBindingDialog projectId="project-a" projectName="Design A" onClose={vi.fn()} />);
    await flush();
    await choose();
    fireEvent.change(appInput(), { target: { value: 'apps/site' } });
    expect(saveButton().disabled).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(screen.getByText('/canonical/source/apps/site')).toBeTruthy();
    fireEvent.click(saveButton());
    await flush();
    expect(screen.getByText('App folder is missing.')).toBeTruthy();
    expect(appInput().value).toBe('apps/site');
    expect(screen.getByText('/alias/source')).toBeTruthy();
    expect(mocks.save.mock.calls[0]?.[1]).toEqual({ sourceRoot: '/alias/source', appRelativePath: 'apps/site', expectedRevision: null, expectedSelection: 'validated-selection' });
    expect(saveButton().disabled).toBe(false);
  });

  it('native-picker cancel, Cancel and Escape do not save; remount reads the saved binding', async () => {
    mocks.pickHost.mockResolvedValue({ ok: false, canceled: true });
    const close = vi.fn();
    const view = render(<CodebaseBindingDialog projectId="project-a" projectName="Design A" onClose={close} />);
    await flush();
    await choose();
    expect(mocks.validate).not.toHaveBeenCalled();
    expect(saveButton().disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(close).toHaveBeenCalledTimes(2);
    expect(mocks.save).not.toHaveBeenCalled();
    view.unmount();
    mocks.get.mockResolvedValue(status({ binding, status: 'connected' }));
    render(<CodebaseBindingDialog projectId="project-a" projectName="Design A" onClose={close} />);
    await flush();
    expect(screen.getByRole('dialog', { name: 'Manage codebase' })).toBeTruthy();
    expect(appInput().value).toBe('apps/web');
    expect(screen.getByText('/source/old')).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
  });

  it('discards a canceled rebind and reloads the previous saved source on reopen', async () => {
    mocks.get.mockResolvedValue(status({ binding, status: 'connected' }));
    const close = vi.fn();
    const view = render(<CodebaseBindingDialog projectId="project-a" projectName="Design A" onClose={close} />);
    await flush();
    await choose();
    expect(screen.getByText('/alias/source')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(close).toHaveBeenCalledTimes(1);
    view.unmount();
    render(<CodebaseBindingDialog projectId="project-a" projectName="Design A" onClose={close} />);
    await flush();
    expect(screen.getByText('/source/old')).toBeTruthy();
    expect(screen.queryByText('/alias/source')).toBeNull();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('ignores a native picker result after Cancel closes the dialog', async () => {
    const picker = deferred<{ ok: true; baseDir: string; token: string }>();
    mocks.pickHost.mockReturnValue(picker.promise);
    const close = vi.fn();
    const view = render(<CodebaseBindingDialog projectId="project-a" projectName="Design A" onClose={close} />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Choose folder' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    view.unmount();
    await act(async () => { picker.resolve({ ok: true, baseDir: '/late', token: 'late-token' }); });
    expect(close).toHaveBeenCalledTimes(1);
    expect(mocks.validate).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('keeps a stale save open with its draft and requires reviewing the newer connection', async () => {
    mocks.save.mockRejectedValue(new CodebaseBindingError('Selection changed.', 409));
    const close = vi.fn();
    render(<CodebaseBindingDialog projectId="project-a" projectName="Design A" onClose={close} />);
    await flush();
    await choose();
    fireEvent.click(saveButton());
    await flush();
    expect(screen.getByText('This connection changed elsewhere. Close and reopen to review the latest connection.')).toBeTruthy();
    expect(screen.getByText('/alias/source')).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
    expect(close).not.toHaveBeenCalled();
  });

  it('shows a missing source and reconnects with the existing revision and app folder', async () => {
    mocks.get.mockResolvedValue(status({ binding, status: 'unavailable', reason: 'missing_source', message: 'Source folder is missing.' }));
    render(<CodebaseBindingDialog projectId="project-a" projectName="Design A" onClose={vi.fn()} />);
    await flush();
    expect(screen.getByText('Codebase unavailable')).toBeTruthy();
    await choose();
    fireEvent.click(saveButton());
    await flush();
    expect(mocks.save.mock.calls[0]?.[1]).toEqual({ sourceRoot: '/alias/source', appRelativePath: 'apps/web', expectedRevision: 4, expectedSelection: 'validated-selection' });
  });

  it.each(['../outside', '/absolute', 'C:\\outside', 'apps/../../outside'])('rejects an unsafe relative folder %s before submission', async (path) => {
    render(<CodebaseBindingDialog projectId="project-a" projectName="Design A" onClose={vi.fn()} />);
    await flush();
    await choose();
    mocks.validate.mockClear();
    fireEvent.change(appInput(), { target: { value: path } });
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(screen.getByRole('alert').textContent).toBe('Enter a relative folder inside the source folder.');
    expect(saveButton().disabled).toBe(true);
    expect(mocks.validate).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('ignores an older validation result after the app folder changes', async () => {
    const old = deferred<{ sourceRoot: string; appRelativePath: string; appRoot: string }>();
    mocks.validate.mockReturnValueOnce(old.promise);
    render(<CodebaseBindingDialog projectId="project-a" projectName="Design A" onClose={vi.fn()} />);
    await flush();
    await choose();
    fireEvent.change(appInput(), { target: { value: 'apps/new' } });
    await act(async () => { old.resolve({ sourceRoot: '/stale', appRelativePath: '.', appRoot: '/stale' }); });
    expect(screen.queryByText('/stale')).toBeNull();
    expect(saveButton().disabled).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(screen.getByText('/canonical/source/apps/new')).toBeTruthy();
    expect(saveButton().disabled).toBe(false);
  });

  it('does not leak a delayed status read into the next project', async () => {
    const old = deferred<ProjectCodebaseBindingResponse>();
    mocks.get.mockReturnValueOnce(old.promise).mockResolvedValueOnce(status({ projectId: 'project-b', designStoragePath: '/designs/project-b' }));
    const view = render(<CodebaseBindingDialog projectId="project-a" projectName="Design A" onClose={vi.fn()} />);
    view.rerender(<CodebaseBindingDialog projectId="project-b" projectName="Design B" onClose={vi.fn()} />);
    await flush();
    await act(async () => { old.resolve(status({ binding, status: 'connected' })); });
    expect(screen.getByText('/designs/project-b')).toBeTruthy();
    expect(screen.queryByText('/designs/project-a')).toBeNull();
    expect(screen.queryByText('/source/old')).toBeNull();
  });

  it('keeps an in-flight save attached to its captured project and does not close the next dialog', async () => {
    const pending = deferred<ProjectCodebaseBindingResponse>();
    mocks.save.mockReturnValueOnce(pending.promise);
    const oldClose = vi.fn();
    const nextClose = vi.fn();
    const view = render(<CodebaseBindingDialog projectId="project-a" projectName="Design A" onClose={oldClose} />);
    await flush();
    await choose();
    fireEvent.click(saveButton());
    mocks.get.mockResolvedValue(status({ projectId: 'project-b', designStoragePath: '/designs/project-b' }));
    view.rerender(<CodebaseBindingDialog projectId="project-b" projectName="Design B" onClose={nextClose} />);
    await flush();
    await act(async () => { pending.resolve(status({ status: 'connected' })); });
    expect(mocks.save.mock.calls[0]?.[0]).toBe('project-a');
    expect(oldClose).not.toHaveBeenCalled();
    expect(nextClose).not.toHaveBeenCalled();
    expect(screen.getByText('/designs/project-b')).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
  });

  it('rechecks status on focus without erasing edits and blocks a stale revision', async () => {
    mocks.get.mockResolvedValue(status({ binding, status: 'connected' }));
    render(<CodebaseBindingDialog projectId="project-a" projectName="Design A" onClose={vi.fn()} />);
    await flush();
    await choose();
    fireEvent.change(appInput(), { target: { value: 'apps/draft' } });
    mocks.get.mockResolvedValue(status({ binding: { ...binding, revision: 5 }, status: 'connected' }));
    fireEvent.focus(window);
    await flush();
    expect(appInput().value).toBe('apps/draft');
    expect(screen.getByText('This connection changed elsewhere. Close and reopen to review the latest connection.')).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
  });

  it('supports retry after a read failure and keeps keyboard focus inside the dialog', async () => {
    mocks.get.mockRejectedValueOnce(new Error('offline'));
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const view = render(<CodebaseBindingDialog projectId="project-a" projectName="Design A" onClose={vi.fn()} />);
    await flush();
    expect(screen.getByText('Could not load the codebase connection.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await flush();
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(document.activeElement).toBe(cancel);
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Choose folder' }));
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(cancel);
    view.unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('does not fall back to the daemon picker when the trusted host is missing', async () => {
    mocks.hostAvailable.mockReturnValue(false);
    render(<CodebaseBindingDialog projectId="project-a" projectName="Design A" onClose={vi.fn()} />);
    await flush();
    expect((screen.getByRole('button', { name: 'Choose folder' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Choose a folder on this computer to connect a codebase.')).toBeTruthy();
    expect(mocks.pickDaemon).not.toHaveBeenCalled();
  });

  it('uses the existing daemon picker only when capabilities permit it', async () => {
    mocks.hostAvailable.mockReturnValue(false);
    mocks.get.mockResolvedValue(status({ capabilities: { canBind: true, requiresTrustedPicker: false } }));
    mocks.pickDaemon.mockResolvedValue('/daemon/source');
    render(<CodebaseBindingDialog projectId="project-a" projectName="Design A" onClose={vi.fn()} />);
    await flush();
    await choose();
    fireEvent.click(saveButton());
    await flush();
    expect(mocks.save.mock.calls[0]?.[1].sourceRoot).toBe('/daemon/source');
    expect(mocks.save.mock.calls[0]?.[2].desktopImportToken).toBeUndefined();
    expect(mocks.pickHost).not.toHaveBeenCalled();
  });

  it('leaves unsupported bindings read-only', async () => {
    mocks.get.mockResolvedValue(status({ binding, status: 'unsupported', capabilities: { canBind: false, requiresTrustedPicker: true } }));
    render(<CodebaseBindingDialog projectId="project-a" projectName="Design A" onClose={vi.fn()} />);
    await flush();
    expect(screen.getByText('/source/old')).toBeTruthy();
    expect(screen.getByText('Codebase connections are unavailable in this environment.')).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Choose another folder' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
