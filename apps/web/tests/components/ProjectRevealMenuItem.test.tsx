// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectRevealMenuItem } from '../../src/components/project-actions/ProjectRevealMenuItem';

const mocks = vi.hoisted(() => ({ reveal: vi.fn(), version: vi.fn() }));
vi.mock('../../src/providers/project-reveal', () => ({ revealProjectPath: mocks.reveal }));
vi.mock('../../src/providers/registry', async (original) => ({
  ...await original<typeof import('../../src/providers/registry')>(), fetchAppVersionInfo: mocks.version,
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.version.mockResolvedValue({ platform: 'darwin' });
  mocks.reveal.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

describe('shared project reveal menu action', () => {
  it.each([['darwin', 'Reveal in Finder'], ['win32', 'Reveal in Explorer'], ['linux', 'Reveal in file manager']])('labels the native file browser for %s', async (platform, label) => {
    mocks.version.mockResolvedValue({ platform });
    render(<ProjectRevealMenuItem projectId="project-a" onRevealed={vi.fn()} />);
    expect(await screen.findByRole('menuitem', { name: label })).toBeTruthy();
  });
  it('keeps a native launch failure visible in the originating menu', async () => {
    const close = vi.fn();
    mocks.reveal.mockRejectedValue(new Error('native file browser unavailable'));
    render(<ProjectRevealMenuItem projectId="project-a" onRevealed={close} />);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Reveal in Finder' }));
    expect((await screen.findByRole('alert')).textContent).toContain('native file browser unavailable');
    expect(close).not.toHaveBeenCalled();
  });
  it('prevents duplicate launches while a request is pending', async () => {
    let resolve!: () => void;
    mocks.reveal.mockReturnValue(new Promise<void>((done) => { resolve = done; }));
    const close = vi.fn();
    render(<ProjectRevealMenuItem projectId="project-a" onRevealed={close} />);
    const button = await screen.findByRole('menuitem', { name: 'Reveal in Finder' });
    act(() => { fireEvent.click(button); fireEvent.click(button); });
    expect(mocks.reveal).toHaveBeenCalledOnce();
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await act(async () => resolve());
    expect(close).toHaveBeenCalledOnce();
  });
  it('ignores an abandoned menu request after switching project', async () => {
    let resolve!: () => void;
    mocks.reveal.mockReturnValue(new Promise<void>((done) => { resolve = done; }));
    const close = vi.fn();
    const view = render(<ProjectRevealMenuItem projectId="project-a" onRevealed={close} />);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Reveal in Finder' }));
    view.rerender(<ProjectRevealMenuItem projectId="project-b" onRevealed={close} />);
    await act(async () => resolve());
    expect(close).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
    await waitFor(() => expect((screen.getByRole('menuitem') as HTMLButtonElement).disabled).toBe(false));
  });
  it('does not launch for a disabled project action', async () => {
    render(<ProjectRevealMenuItem projectId="project-a" disabled onRevealed={vi.fn()} />);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Reveal in Finder' }));
    expect(mocks.reveal).not.toHaveBeenCalled();
  });
});
