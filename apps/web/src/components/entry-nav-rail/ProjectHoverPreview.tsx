// The hover preview card the rail's 最近项目 rows float beside themselves —
// the cover plate over the wrapped project name — and the cover pipeline that
// feeds it.
//
// Both halves are exported so the chat project switcher (WorkspaceTabsBar's
// dock dropdown) can show the SAME card for the same project (OPEND-2694:
// 顶部项目列表应与 Home 侧栏一致): one markup, one stylesheet block
// (`.entry-nav-rail__recent-preview*` in home/entry-layout.css), one cover
// decision. A second implementation would have drifted the moment either
// surface was tuned.
//
// The cover IS the decision the projects grid renders: both surfaces resolve
// it through `lib/project-cover-pipeline` (files read → cover pick → HEAD
// probe, or the deck's cover-slide document) and store it in the process-wide
// LRU in `lib/project-cover-cache`, keyed by (workspace, project, version). A
// row whose project the grid already rendered paints instantly; a cache miss
// (the user landed on a surface that never rendered the grid) resolves once
// on hover and writes back through the same key, so the grid inherits it.
// (OPEND-2766: the preview used to skip the html half of that pipeline and
// showed only the tinted glyph for prototypes, decks, documents and clones.)

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import type { WorkspaceCollabContext } from '@open-design/contracts';

import { workspaceIdentityCacheKey } from '../../collab/workspace-identity';
import {
  getProjectCoverSnapshot,
  projectCoverSnapshotKey,
  setProjectCoverSnapshot,
} from '../../lib/project-cover-cache';
import {
  resolveProjectCover,
} from '../../lib/project-cover-pipeline';
import { projectCoverUrl, type ProjectCoverOverride } from '../project-cover';
import type { Project } from '../../types';
import { ProjectPreviewCover } from '../ProjectPreviewCover';

/** `undefined` = not resolved yet; `null` = resolved, this project has none. */
type CoverState = ProjectCoverOverride | null | undefined;

/**
 * One resolve per snapshot key at a time (per the ticket: 不产生明显的重复网络
 * 请求). A pointer that crosses the same row twice before its first resolve
 * lands — or the rail row and the switcher row of one project, hovered in
 * turn — joins the request already in flight instead of starting another.
 * Settled entries are dropped: the snapshot cache is the memory, this map
 * only merges concurrent callers.
 */
const inflightResolves = new Map<string, Promise<void>>();

export interface ProjectHoverCover {
  workspaceContext?: WorkspaceCollabContext | null;
  /** Resolve the cover once (cache-first); safe to call on every hover. */
  resolveCover: () => Promise<void>;
  coverSrc: string | null;
  showsImage: boolean;
  showsVideo: boolean;
  /** The cover is an HTML document: rendered in a sandboxed frame. */
  showsHtml: boolean;
  /** An HTML cover that is a deck: shown as its cover slide, not the live page. */
  isDeck: boolean;
}

/**
 * What the grid shows for a project whose cover is its imported entry file
 * (`projectCover()` in RecentProjectsStrip does the same without a probe): the
 * pipeline answers `null` for those because there is no artifact to scan, but
 * the entry itself is the thing to show.
 */
function entryFileCover(project: Project): ProjectCoverOverride | null {
  const entry = project.metadata?.entryFile;
  if (!entry) return null;
  const kind = project.metadata?.kind;
  if (kind === 'image' || kind === 'video') return { kind, name: entry, mtime: project.updatedAt };
  if (/\.html?$/i.test(entry)) return { kind: 'html', name: entry, mtime: project.updatedAt };
  return null;
}

/**
 * The cover behind one project's hover preview. The async resolve checks it is
 * still mounted (and still looking at the same project version) before it sets
 * state, so a row that leaves (the list re-sorts, the rail closes) mid-read is
 * simply dropped, and a late answer for an older version never paints.
 */
export function useProjectHoverCover(
  project: Project,
  workspaceContext: WorkspaceCollabContext | null | undefined,
): ProjectHoverCover {
  const snapshotKey = projectCoverSnapshotKey(
    workspaceIdentityCacheKey(workspaceContext),
    project.id,
    project.updatedAt,
  );
  const [cover, setCover] = useState<CoverState>(
    () => getProjectCoverSnapshot(snapshotKey)?.cover,
  );
  const activeRef = useRef(true);
  const keyRef = useRef(snapshotKey);
  keyRef.current = snapshotKey;
  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  // A newer version of the project (rename, new content) misses the old key, so
  // the row drops back to unresolved and re-reads on the next hover.
  useEffect(() => {
    setCover(getProjectCoverSnapshot(snapshotKey)?.cover);
  }, [snapshotKey]);

  const resolveCover = useCallback(async () => {
    if (getProjectCoverSnapshot(snapshotKey) !== undefined) return;
    let run = inflightResolves.get(snapshotKey);
    if (!run) {
      run = (async () => {
        const next = await resolveProjectCover(
          project,
          new AbortController().signal,
          workspaceContext ?? null,
        );
        // `undefined` is transient (network failure): leave it unresolved so
        // the next hover is allowed to try again. `null` is authoritative.
        if (next === undefined) return;
        setProjectCoverSnapshot(snapshotKey, next);
      })().finally(() => {
        inflightResolves.delete(snapshotKey);
      });
      inflightResolves.set(snapshotKey, run);
    }
    await run;
    if (!activeRef.current || keyRef.current !== snapshotKey) return;
    const snapshot = getProjectCoverSnapshot(snapshotKey);
    if (snapshot !== undefined) setCover(snapshot.cover);
  }, [project, snapshotKey, workspaceContext]);

  const shown = cover === null ? entryFileCover(project) : cover;
  const coverSrc = shown
    ? projectCoverUrl(project.id, shown.name, shown.mtime, workspaceContext)
    : null;
  const showsImage = Boolean(coverSrc && (shown?.kind === 'image' || shown?.kind === 'logo'));
  const showsVideo = Boolean(coverSrc && shown?.kind === 'video');
  const showsHtml = Boolean(coverSrc && shown?.kind === 'html');
  const isDeck = showsHtml && project.metadata?.kind === 'deck';

  return { resolveCover, coverSrc, showsImage, showsVideo, showsHtml, isDeck, workspaceContext };
}

/**
 * The card itself: cover plate + the full name given room to wrap. Purely
 * informational — `aria-hidden`, no pointer events (the stylesheet) — so it can
 * never sit between the pointer and the row that spawned it. The caller owns
 * WHERE it goes (`style` carries the fixed top/left the row measured) and
 * portals it to <body>: inside the rail or the chat column it would stay behind
 * the content beside it whatever its z-index.
 */
export function ProjectHoverPreviewCard({
  project,
  cover,
  style,
  testId,
}: {
  project: Project;
  cover: Pick<ProjectHoverCover, 'coverSrc' | 'showsImage' | 'showsVideo' | 'showsHtml' | 'isDeck' | 'workspaceContext'>;
  style: CSSProperties;
  testId?: string;
}) {
  const { coverSrc, showsImage, showsVideo, showsHtml, isDeck } = cover;
  const glyph = (
    <span className="entry-nav-rail__recent-preview-glyph" aria-hidden>
      {(Array.from(project.name.trim())[0] ?? '?').toUpperCase()}
    </span>
  );
  return (
    <div
      className="entry-nav-rail__recent-preview"
      style={style}
      aria-hidden
      {...(testId ? { 'data-testid': testId } : {})}
    >
      <div className={`entry-nav-rail__recent-preview-plate${isDeck ? ' is-deck' : ''}`}>
        {showsImage ? (
          <img src={coverSrc ?? ''} alt="" draggable={false} decoding="async" />
        ) : showsVideo ? (
          <video src={coverSrc ?? ''} muted playsInline preload="metadata" />
        ) : showsHtml && coverSrc ? (
          <ProjectPreviewCover key={coverSrc} src={coverSrc} initial={(Array.from(project.name.trim())[0] ?? '?').toUpperCase()} workspaceContext={cover.workspaceContext} activateOnMount />
        ) : (
          glyph
        )}
      </div>
      {/* The name the row had to ellipsize, given room to wrap — that is the
          whole job of this card. No timestamp line (per product: 时间去掉，最多
          两行名称): a hover preview answers "which project is this". */}
      <p className="entry-nav-rail__recent-preview-name">{project.name}</p>
    </div>
  );
}
