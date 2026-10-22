import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkspaceCollabContext } from '@open-design/contracts';
import { appendResourceQuery, workspaceAccountScopedCacheKey, workspaceProjectHeaders } from '../collab/workspace-identity';
import { bindMotionPreviewActivity, unbindMotionPreviewActivity } from '../runtime/motion-preview-activity';
import { projectPreviewHover } from '../runtime/project-preview-hover';
import { projectThumbnailUrl } from '../runtime/project-thumbnail-url';
import styles from './ProjectPreviewCover.module.css';

export const PROJECT_THUMBNAIL_REFRESH_MS = 30_000;

/** Browsing only: a static cached image plus one explicitly requested live
 * document. This does not change the full editor or historical chat cards. */
export function ProjectPreviewCover({ src, initial, workspaceContext, activateOnMount = false }: {
  src?: string;
  initial: string;
  workspaceContext?: WorkspaceCollabContext | null;
  activateOnMount?: boolean;
}) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [active, setActive] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [image, setImage] = useState<{ identity: string; url: string } | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const thumbnail = src ? projectThumbnailUrl(src) : null;
  const authority = workspaceAccountScopedCacheKey(workspaceContext);
  const identity = `${authority}|${thumbnail}`;
  const contextRef = useRef(workspaceContext);
  contextRef.current = workspaceContext;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const card = host.closest<HTMLElement>('[role="button"],button,a') ?? host.parentElement ?? host;
    const lease = projectPreviewHover.register(setActive);
    let foreground = !document.hidden && document.hasFocus();
    const enter = (event?: Event) => {
      if (event && 'pointerType' in event && event.pointerType === 'touch') return;
      if (foreground && !document.hidden) lease.enter();
    };
    const leave = () => lease.leave();
    const blur = (event: FocusEvent) => { if (!card.contains(event.relatedTarget as Node | null)) leave(); };
    const suspend = () => { foreground = false; projectPreviewHover.suspend(); };
    const focus = () => { foreground = true; };
    const visibility = () => { foreground = !document.hidden && document.hasFocus(); if (!foreground) suspend(); };
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      const inView = entries.some(entry => entry.isIntersecting);
      setVisible(inView);
      if (!inView) lease.release();
    });
    observer?.observe(card);
    if (!observer) setVisible(true);
    card.addEventListener('pointerenter', enter);
    card.addEventListener('pointerleave', leave);
    card.addEventListener('focusin', enter);
    card.addEventListener('focusout', blur);
    window.addEventListener('blur', suspend);
    window.addEventListener('focus', focus);
    window.addEventListener('pagehide', suspend);
    window.addEventListener('popstate', suspend);
    document.addEventListener('visibilitychange', visibility);
    if (activateOnMount) enter();
    return () => {
      observer?.disconnect();
      lease.dispose();
      card.removeEventListener('pointerenter', enter);
      card.removeEventListener('pointerleave', leave);
      card.removeEventListener('focusin', enter);
      card.removeEventListener('focusout', blur);
      window.removeEventListener('blur', suspend);
      window.removeEventListener('focus', focus);
      window.removeEventListener('pagehide', suspend);
      window.removeEventListener('popstate', suspend);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [src, authority, activateOnMount]);

  useEffect(() => {
    if (!visible || !thumbnail) return;
    let disposed = false;
    let inFlight = false;
    let etag: string | null = null;
    const abort = new AbortController();
    const refresh = async () => {
      if (disposed || inFlight || document.hidden) return;
      inFlight = true;
      const headers = contextRef.current ? workspaceProjectHeaders(contextRef.current) : undefined;
      const forget = () => {
        if (disposed) return;
        etag = null;
        setImage(null);
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      };
      try {
        if (etag) {
          const head = await fetch(thumbnail, { method: 'HEAD', headers, cache: 'no-cache', signal: abort.signal });
          if (head.status === 403 || head.status === 404) { forget(); return; }
          if (head.status === 304 || (head.ok && head.headers.get('etag') === etag)) return;
          if (!head.ok) return;
        }
        const response = await fetch(thumbnail, { headers, cache: 'no-cache', signal: abort.signal });
        if (response.status === 403 || response.status === 404) { forget(); return; }
        if (!response.ok || !response.headers.get('content-type')?.startsWith('image/png')) return;
        const blob = await response.blob();
        if (disposed) return;
        const next = URL.createObjectURL(blob);
        const previous = objectUrlRef.current;
        objectUrlRef.current = next;
        etag = response.headers.get('etag');
        setImage({ identity, url: next });
        if (previous) URL.revokeObjectURL(previous);
      } catch { /* Keep a valid static cover, never fall back to idle live HTML. */ }
      finally { inFlight = false; }
    };
    void refresh();
    const interval = setInterval(() => { void refresh(); }, PROJECT_THUMBNAIL_REFRESH_MS);
    const foreground = () => { if (!document.hidden) void refresh(); };
    document.addEventListener('visibilitychange', foreground);
    window.addEventListener('focus', foreground);
    return () => {
      disposed = true;
      abort.abort();
      clearInterval(interval);
      document.removeEventListener('visibilitychange', foreground);
      window.removeEventListener('focus', foreground);
    };
  }, [visible, thumbnail, identity]);

  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
  }, [identity]);

  useEffect(() => { setLoaded(false); }, [active, src]);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const setFrame = useCallback((frame: HTMLIFrameElement | null) => {
    if (frameRef.current) unbindMotionPreviewActivity(frameRef.current);
    frameRef.current = frame;
    if (frame) bindMotionPreviewActivity(frame);
  }, []);
  const imageUrl = image?.identity === identity ? image.url : null;
  return (
    <span ref={hostRef} className={styles.cover} data-project-preview={active ? 'live' : 'static'}>
      <span className={styles.pending}>{initial}</span>
      {imageUrl ? <img className={styles.image} src={imageUrl} alt="" draggable={false} /> : null}
      {active && src ? <iframe
        ref={setFrame}
        className={styles.frame}
        src={appendResourceQuery(src, 'odMotionPreview=1&odMotionThumbnail=1')}
        title=""
        sandbox="allow-scripts"
        tabIndex={-1}
        data-od-active="true"
        style={{ visibility: loaded ? 'visible' : 'hidden' }}
        onLoad={() => setLoaded(true)}
      /> : null}
    </span>
  );
}
