// @vitest-environment jsdom
//
// Cover selection for the rail and project switcher. HTML/deck covers now
// select cached screenshots; image/video selections retain their behavior.
// The shared component's separate suite owns delayed live-frame activation.

import { act, cleanup, render } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Project, ProjectFile } from '../../src/types';

const filesByProject = new Map<string, ProjectFile[]>();

// This suite owns cover selection; dwell/unload behavior uses the real shared
// component in ProjectPreviewCover.test.tsx.
vi.mock('../../src/components/ProjectPreviewCover', async () => {
  const { projectThumbnailUrl } = await import('../../src/runtime/project-thumbnail-url');
  return { ProjectPreviewCover: ({ src }: { src: string }) => <img src={projectThumbnailUrl(src) ?? ''} alt="" /> };
});

vi.mock('../../src/providers/registry', () => ({
  fetchProjectFiles: vi.fn(async (projectId: string) => filesByProject.get(projectId) ?? []),
  fetchProjectFileText: vi.fn(async () => null),
  projectFileUrl: (projectId: string, fileName: string) =>
    `/api/projects/${projectId}/files/${fileName}`,
}));

import {
  ProjectHoverPreviewCard,
  useProjectHoverCover,
} from '../../src/components/entry-nav-rail/ProjectHoverPreview';
import { resetProjectCoverSnapshots } from '../../src/lib/project-cover-cache';
import { fetchProjectFiles } from '../../src/providers/registry';

const DECK_HTML = `<!doctype html>
<html><head><title>Deck</title><script>window.deck = 1;</script></head>
<body>
  <section class="slide" data-slide="1"><h1>Cover slide</h1></section>
  <section class="slide" data-slide="2"><h1>Agenda</h1></section>
</body></html>`;

const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (init?.method === 'HEAD') {
    return { ok: true, status: 200, statusText: 'OK' } as Response;
  }
  if (url.includes('deck.html')) {
    return { ok: true, status: 200, statusText: 'OK', text: async () => DECK_HTML } as Response;
  }
  return { ok: false, status: 404, statusText: 'Not Found', text: async () => '' } as Response;
});

function file(path: string, kind: ProjectFile['kind'], mtime = 1_700_000_000_000): ProjectFile {
  return { name: path.split('/').pop() ?? path, path, kind, mtime, type: 'file', size: 1 } as ProjectFile;
}

function project(id: string, metadata: Project['metadata'] = undefined): Project {
  return {
    id,
    name: `Project ${id}`,
    skillId: null,
    designSystemId: null,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...(metadata ? { metadata } : {}),
  } as Project;
}

/** A row's worth of the hook + card: resolve on mount, the way a hover does. */
function Preview({ project: subject }: { project: Project }) {
  const cover = useProjectHoverCover(subject, null);
  const { resolveCover } = cover;
  useEffect(() => {
    void resolveCover();
  }, [resolveCover]);
  return (
    <ProjectHoverPreviewCard
      project={subject}
      cover={cover}
      style={{ top: 0, left: 0 }}
      testId="hover-preview"
    />
  );
}

const flush = async (hops = 8): Promise<void> => {
  for (let i = 0; i < hops; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
};

function plate(container: HTMLElement): HTMLElement {
  const node = container.querySelector('.entry-nav-rail__recent-preview-plate');
  if (!(node instanceof HTMLElement)) throw new Error('preview plate missing');
  return node;
}

describe('ProjectHoverPreview — HTML and deck covers (OPEND-2766)', () => {
  beforeEach(() => {
    resetProjectCoverSnapshots();
    filesByProject.clear();
    fetchMock.mockClear();
    vi.mocked(fetchProjectFiles).mockClear();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('routes a prototype to a cached screenshot instead of an immediate iframe', async () => {
    filesByProject.set('proto', [file('index.html', 'html'), file('notes.md', 'text' as ProjectFile['kind'])]);
    const { container } = render(<Preview project={project('proto')} />);

    // Before the cover resolves: the tinted glyph, nothing else.
    expect(plate(container).querySelector('.entry-nav-rail__recent-preview-glyph')).not.toBeNull();
    expect(plate(container).querySelector('iframe')).toBeNull();

    await flush();

    expect(plate(container).querySelector('iframe')).toBeNull();
    expect(plate(container).querySelector('img')?.getAttribute('src')).toContain('/api/projects/proto/thumbnail?fileName=index.html');
  });

  it('routes decks through the same static screenshot contract', async () => {
    filesByProject.set('deck', [file('deck.html', 'html')]);
    const { container } = render(<Preview project={project('deck', { kind: 'deck' })} />);
    await flush();

    expect(plate(container).querySelector('iframe')).toBeNull();
    expect(plate(container).querySelector('img')?.getAttribute('src')).toContain('/api/projects/deck/thumbnail?fileName=deck.html');
  });

  it('keeps painting image and video covers as before', async () => {
    filesByProject.set('pic', [file('render.png', 'image')]);
    filesByProject.set('clip', [file('clip.mp4', 'video')]);

    const pic = render(<Preview project={project('pic')} />);
    await flush();
    const img = plate(pic.container).querySelector('img');
    expect(img?.getAttribute('src')).toContain('/api/projects/pic/files/render.png');
    expect(plate(pic.container).querySelector('iframe')).toBeNull();
    pic.unmount();

    const clip = render(<Preview project={project('clip')} />);
    await flush();
    const video = plate(clip.container).querySelector('video');
    expect(video?.getAttribute('src')).toContain('/api/projects/clip/files/clip.mp4');
    expect(plate(clip.container).querySelector('iframe')).toBeNull();
  });

  it('falls back to the glyph only when the project has nothing to show', async () => {
    filesByProject.set('empty', [file('README.md', 'text' as ProjectFile['kind'])]);
    const { container } = render(<Preview project={project('empty')} />);
    await flush();

    expect(plate(container).querySelector('iframe')).toBeNull();
    expect(plate(container).querySelector('img')).toBeNull();
    expect(plate(container).querySelector('.entry-nav-rail__recent-preview-glyph')?.textContent).toBe('P');
  });

  it('joins one in-flight resolve when the same row is hovered again before it lands', async () => {
    filesByProject.set('proto', [file('index.html', 'html')]);
    const subject = project('proto');

    let resolveCover: (() => Promise<void>) | null = null;
    function Capture() {
      const cover = useProjectHoverCover(subject, null);
      resolveCover = cover.resolveCover;
      return null;
    }
    render(<Capture />);
    await act(async () => {
      await Promise.all([resolveCover!(), resolveCover!(), resolveCover!()]);
    });
    expect(vi.mocked(fetchProjectFiles)).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'HEAD')).toHaveLength(1);
  });
});
