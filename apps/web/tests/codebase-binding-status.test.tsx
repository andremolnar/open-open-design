// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectCodebaseBindingResponse } from '@open-design/contracts';
import { useProjectCodebaseBinding } from '../src/hooks/useProjectCodebaseBinding';
import { CODEBASE_BINDING_CHANGED_EVENT } from '../src/providers/codebase-binding';
import { advanceWorkspaceAccountGeneration } from '../src/collab/workspace-identity';

function Probe({ projectId }: { projectId: string | null }) {
  const data = useProjectCodebaseBinding(projectId);
  return <output>{data ? `${data.projectId}:${data.status}` : 'unknown'}</output>;
}
function response(projectId: string, status: ProjectCodebaseBindingResponse['status'] = 'connected') {
  return new Response(JSON.stringify({ projectId, status }));
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('codebase status freshness', () => {
  it('hides the old project immediately and ignores a delayed response after navigation', async () => {
    const old = deferred<Response>();
    const fetcher = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce(response('b'));
    vi.stubGlobal('fetch', fetcher);
    const view = render(<Probe projectId="a" />);
    view.rerender(<Probe projectId="b" />);
    await act(async () => {});
    expect(screen.getByRole('status').textContent).toBe('b:connected');
    await act(async () => { old.resolve(response('a')); });
    expect(screen.getByRole('status').textContent).toBe('b:connected');
    expect(fetcher.mock.calls[0]?.[1].signal.aborted).toBe(true);
    view.rerender(<Probe projectId={null} />);
    expect(screen.getByRole('status').textContent).toBe('unknown');
  });

  it('rechecks focus and matching saves without polling or reacting to other projects', async () => {
    const fetcher = vi.fn().mockResolvedValue(response('a'));
    vi.stubGlobal('fetch', fetcher);
    render(<Probe projectId="a" />);
    await act(async () => {});
    fetcher.mockResolvedValue(response('a', 'unavailable'));
    fireEvent.focus(window);
    await act(async () => {});
    expect(screen.getByRole('status').textContent).toBe('a:unavailable');
    act(() => window.dispatchEvent(new CustomEvent(CODEBASE_BINDING_CHANGED_EVENT, { detail: { projectId: 'b' } })));
    expect(fetcher).toHaveBeenCalledTimes(2);
    fetcher.mockResolvedValue(response('a'));
    act(() => window.dispatchEvent(new CustomEvent(CODEBASE_BINDING_CHANGED_EVENT, { detail: { projectId: 'a' } })));
    await act(async () => {});
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(screen.getByRole('status').textContent).toBe('a:connected');
  });

  it('does not reuse status after a same-project account change or failed refresh', async () => {
    const fetcher = vi.fn().mockResolvedValue(response('a'));
    vi.stubGlobal('fetch', fetcher);
    const view = render(<Probe projectId="a" />);
    await act(async () => {});
    expect(screen.getByRole('status').textContent).toBe('a:connected');
    fetcher.mockRejectedValue(new Error('not authorized'));
    advanceWorkspaceAccountGeneration('codebase-status-test-account');
    view.rerender(<Probe projectId="a" />);
    expect(screen.getByRole('status').textContent).toBe('unknown');
    await act(async () => {});
    expect(screen.getByRole('status').textContent).toBe('unknown');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
