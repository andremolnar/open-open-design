// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectPreviewCover, PROJECT_THUMBNAIL_REFRESH_MS } from '../../src/components/ProjectPreviewCover';
import { PREVIEW_HOVER_DELAY_MS, PREVIEW_LEAVE_GRACE_MS, projectPreviewHover } from '../../src/runtime/project-preview-hover';

let etag = '"one"';
const fetcher = vi.fn(async (_url: string, options?: RequestInit) => new Response(options?.method === 'HEAD' ? null : 'png', { headers: { 'content-type': 'image/png', etag } }));
const revoke = vi.fn();
let nextBlob = 0;
const observers = new Set<(visible: boolean) => void>();
class VisibilityObserver {
  private target?: Element;
  constructor(private callback: IntersectionObserverCallback) { observers.add(this.emit); }
  emit = (visible: boolean) => this.callback([{ isIntersecting: visible, target: this.target } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  observe(target: Element) { this.target = target; this.emit(true); }
  disconnect() { observers.delete(this.emit); }
}
const flush = async () => { await act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); }); };
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
function card(id = 'one') {
  return <button aria-label={id}><ProjectPreviewCover src={`/api/projects/${id}/raw/index.html`} initial="P" /></button>;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  etag = '"one"'; nextBlob = 0;
  fetcher.mockClear(); revoke.mockClear();
  vi.stubGlobal('IntersectionObserver', VisibilityObserver);
  vi.stubGlobal('fetch', fetcher);
  const OriginalURL = URL;
  vi.stubGlobal('URL', class extends OriginalURL {
    static createObjectURL = () => `blob:thumbnail-${++nextBlob}`;
    static revokeObjectURL = revoke;
  });
});
afterEach(() => {
  cleanup();
  projectPreviewHover.suspend();
  expect(observers.size).toBe(0);
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe('static browsing covers and deliberate hover', () => {
  it('shows screenshots for 30 cards, never iframe documents during a pointer sweep', async () => {
    render(<>{Array.from({ length: 30 }, (_, i) => <div key={i}>{card(String(i))}</div>)}</>);
    await flush();
    expect(document.querySelectorAll('img')).toHaveLength(30);
    expect(document.querySelectorAll('iframe')).toHaveLength(0);
    for (let i = 0; i < 30; i++) {
      const button = screen.getByRole('button', { name: String(i) });
      fireEvent.pointerEnter(button);
      await advance(30);
      fireEvent.pointerLeave(button);
    }
    await advance(PREVIEW_HOVER_DELAY_MS);
    expect(document.querySelectorAll('iframe')).toHaveLength(0);
  });

  it('shares one live document, survives brief re-entry, and unloads after grace', async () => {
    render(<>{card('one')}{card('two')}</>);
    await flush();
    const a = screen.getByRole('button', { name: 'one' });
    const b = screen.getByRole('button', { name: 'two' });
    fireEvent.pointerEnter(a);
    await advance(PREVIEW_HOVER_DELAY_MS - 1);
    expect(document.querySelector('iframe')).toBeNull();
    await advance(1);
    expect(document.querySelector('iframe')?.getAttribute('src')).toContain('/one/raw/');
    fireEvent.pointerLeave(a);
    await advance(100);
    fireEvent.pointerEnter(a);
    await advance(PREVIEW_LEAVE_GRACE_MS);
    expect(document.querySelectorAll('iframe')).toHaveLength(1);
    fireEvent.pointerLeave(a);
    fireEvent.pointerEnter(b);
    await advance(PREVIEW_HOVER_DELAY_MS);
    expect(document.querySelectorAll('iframe')).toHaveLength(1);
    expect(document.querySelector('iframe')?.getAttribute('src')).toContain('/two/raw/');
    fireEvent.pointerLeave(b);
    await advance(PREVIEW_LEAVE_GRACE_MS);
    expect(document.querySelector('iframe')).toBeNull();
    expect(document.querySelectorAll('img')).toHaveLength(2);
  });

  it('revalidates dependencies periodically and releases hidden previews immediately', async () => {
    render(card());
    await flush();
    const old = document.querySelector('img')!.src;
    await advance(PROJECT_THUMBNAIL_REFRESH_MS);
    expect(fetcher).toHaveBeenCalledTimes(2); // GET once, HEAD unchanged.
    expect(document.querySelector('img')!.src).toBe(old);
    etag = '"two"';
    await advance(PROJECT_THUMBNAIL_REFRESH_MS);
    expect(document.querySelector('img')!.src).not.toBe(old);
    expect(revoke).toHaveBeenCalledWith(old);
    fireEvent.pointerEnter(screen.getByRole('button'));
    await advance(PREVIEW_HOVER_DELAY_MS);
    expect(document.querySelector('iframe')).not.toBeNull();
    act(() => { for (const emit of observers) emit(false); });
    expect(document.querySelector('iframe')).toBeNull();
    expect(document.querySelector('img')).not.toBeNull();
  });

  it('does not silently mount a live document when thumbnail generation fails', async () => {
    fetcher.mockResolvedValueOnce(new Response(null, { status: 503 }));
    render(card());
    await flush();
    expect(document.querySelector('iframe')).toBeNull();
    expect(screen.getByText('P')).toBeTruthy();
    fireEvent.focusIn(screen.getByRole('button'));
    await advance(PREVIEW_HOVER_DELAY_MS);
    expect(document.querySelector('iframe')).not.toBeNull();
    fireEvent(window, new Event('blur'));
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('does not reactivate on pointer movement in an unfocused window', async () => {
    render(card());
    await flush();
    fireEvent(window, new Event('blur'));
    fireEvent.pointerEnter(screen.getByRole('button'));
    await advance(PREVIEW_HOVER_DELAY_MS);
    expect(document.querySelector('iframe')).toBeNull();
    fireEvent(window, new Event('focus'));
    fireEvent.pointerEnter(screen.getByRole('button'));
    await advance(PREVIEW_HOVER_DELAY_MS);
    expect(document.querySelectorAll('iframe')).toHaveLength(1);
  });
});
