import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PREVIEW_HISTORY_BACK,
  PREVIEW_HISTORY_PROBE,
  PREVIEW_HISTORY_STATE,
  buildPreviewHistoryBridge,
} from '@open-design/contracts/runtime/preview-history';

const documents: JSDOM[] = [];

afterEach(() => {
  for (const document of documents.splice(0)) document.window.close();
});

function createPreview() {
  const document = new JSDOM('<!doctype html>', {
    runScripts: 'outside-only',
    url: 'https://preview.test/prototype',
  });
  documents.push(document);
  const { window } = document;
  const states: boolean[] = [];
  window.postMessage = ((data: unknown) => {
    if ((data as { type?: string }).type === PREVIEW_HISTORY_STATE) {
      states.push((data as { canGoBack: boolean }).canGoBack);
    }
  }) as typeof window.postMessage;
  window.eval(buildPreviewHistoryBridge().replace(/^<script[^>]*>/, '').replace(/<\/script>$/, ''));
  const send = (type: string, requestId = 'preview-1') => window.dispatchEvent(new window.MessageEvent('message', {
    source: window.parent,
    data: { type, requestId },
  }));
  send(PREVIEW_HISTORY_PROBE);
  return { window, states, send };
}

describe('preview iframe Back', () => {
  it('cannot traverse host history until the iframe creates an entry', () => {
    const { window, states, send } = createPreview();
    const back = vi.spyOn(window.history, 'back');
    expect(states.at(-1)).toBe(false);
    send(PREVIEW_HISTORY_BACK);
    expect(back).not.toHaveBeenCalled();
    window.history.pushState({ page: 2 }, '', '/second');
    expect(states.at(-1)).toBe(true);
    send(PREVIEW_HISTORY_BACK, 'stale-document');
    expect(back).not.toHaveBeenCalled();
    send(PREVIEW_HISTORY_BACK);
    expect(back).toHaveBeenCalledOnce();
  });

  it('uses real iframe history for SPA routes and disables Back after returning', async () => {
    const { window, states, send } = createPreview();
    window.history.pushState(null, '', '/second');
    window.history.pushState(null, '', '/third');
    send(PREVIEW_HISTORY_BACK);
    await vi.waitFor(() => expect(window.location.pathname).toBe('/second'));
    expect(states.at(-1)).toBe(true);
    send(PREVIEW_HISTORY_BACK);
    await vi.waitFor(() => expect(window.location.pathname).toBe('/prototype'));
    expect(states.at(-1)).toBe(false);
  });

  it('recognizes native hash navigation without counting the initial host history', async () => {
    const { window, states, send } = createPreview();
    window.location.hash = '#step-two';
    await vi.waitFor(() => expect(states.at(-1)).toBe(true));
    send(PREVIEW_HISTORY_BACK);
    await vi.waitFor(() => expect(window.location.hash).toBe(''));
    expect(states.at(-1)).toBe(false);
  });

  it('does not expose host Back after authored code returns across an identical-URL entry', async () => {
    const { window, states, send } = createPreview();
    window.history.pushState({ screen: 'second' }, '', window.location.href);
    expect(states.at(-1)).toBe(true);
    const returned = new Promise<void>((resolve) => window.addEventListener('popstate', () => resolve(), { once: true }));
    window.history.back();
    await returned;
    expect(states.at(-1)).toBe(false);
    const back = vi.spyOn(window.history, 'back');
    send(PREVIEW_HISTORY_BACK);
    expect(back).not.toHaveBeenCalled();
  });

  it('does not enable Back when a cross-origin history push is rejected', () => {
    const { window, states, send } = createPreview();
    expect(() => window.history.pushState(null, '', 'https://other.test/page')).toThrow();
    expect(states.at(-1)).toBe(false);
    const back = vi.spyOn(window.history, 'back');
    send(PREVIEW_HISTORY_BACK);
    expect(back).not.toHaveBeenCalled();
  });

  it('recognizes authored multi-step traversal back to the initial preview entry', async () => {
    const { window, states } = createPreview();
    window.history.pushState(null, '', '/second');
    window.history.pushState(null, '', '/third');
    const returned = new Promise<void>((resolve) => window.addEventListener('popstate', () => resolve(), { once: true }));
    window.history.go(-2);
    await returned;
    expect(window.location.pathname).toBe('/prototype');
    expect(states.at(-1)).toBe(false);
  });
});
