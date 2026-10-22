import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProjectThumbnailCache } from '../../src/services/project-thumbnail-cache.js';

const roots: string[] = [];
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { force: true, recursive: true }))); });
async function root() { const value = await mkdtemp(join(tmpdir(), 'od-project-thumbs-')); roots.push(value); return value; }

describe('project thumbnail cache', () => {
  it('coalesces requests and persists thumbnails across service restarts', async () => {
    const dataRoot = await root();
    const render = vi.fn(async () => png);
    const read = vi.fn(async () => ({ html: '<h1>One</h1>', revision: 'one' }));
    const cache = createProjectThumbnailCache({ dataRoot, render });
    const [a, b] = await Promise.all([cache.get({ identity: 'workspace/project/view', read }), cache.get({ identity: 'workspace/project/view', read })]);
    expect(a.etag).toBe(b.etag);
    expect(render).toHaveBeenCalledTimes(1);
    const restarted = createProjectThumbnailCache({ dataRoot, render });
    expect((await restarted.get({ identity: 'workspace/project/view', read })).bytes).toEqual(png);
    expect(render).toHaveBeenCalledTimes(1);
    const withoutRenderer = createProjectThumbnailCache({ dataRoot, render: null });
    expect((await withoutRenderer.get({ identity: 'workspace/project/view', read })).bytes).toEqual(png);
  });

  it('invalidates for changed dependencies and separates workspace authority', async () => {
    const render = vi.fn(async () => png);
    const cache = createProjectThumbnailCache({ dataRoot: await root(), render });
    let revision = 'before';
    const read = async () => ({ html: '<h1>One</h1>', revision });
    const a = await cache.get({ identity: 'workspace-a/project/view', read });
    revision = 'after';
    const b = await cache.get({ identity: 'workspace-a/project/view', read });
    const c = await cache.get({ identity: 'workspace-b/project/view', read });
    expect(a.etag).not.toBe(b.etag);
    expect(b.etag).not.toBe(c.etag);
    expect(render).toHaveBeenCalledTimes(3);
  });

  it('never overlaps renderers and rejects a stale capture rather than caching it', async () => {
    let complete!: (bytes: Buffer) => void;
    let started!: () => void;
    let secondStarted!: () => void;
    const running = new Promise<void>(resolve => { started = resolve; });
    const secondRunning = new Promise<void>(resolve => { secondStarted = resolve; });
    const render = vi.fn(() => { if (render.mock.calls.length === 1) started(); else secondStarted(); return new Promise<Buffer>(resolve => { complete = resolve; }); });
    const cache = createProjectThumbnailCache({ dataRoot: await root(), render });
    let revision = 'before';
    const first = cache.get({ identity: 'first', read: async () => ({ html: revision, revision }) });
    const failed = expect(first).rejects.toThrow('changed during capture');
    await running;
    const second = cache.get({ identity: 'second', read: async () => ({ html: 'second', revision: 'second' }) });
    expect(render).toHaveBeenCalledTimes(1);
    revision = 'after';
    complete(png);
    await failed;
    // Completion, not a real-time delay, releases the next queued job.
    await secondRunning;
    expect(render).toHaveBeenCalledTimes(2);
    complete(png);
    await second;
  });

  it('never caches renderer failures', async () => {
    const cache = createProjectThumbnailCache({ dataRoot: await root(), render: async () => { throw new Error('renderer unavailable'); } });
    const input = { identity: 'one', read: async () => ({ html: 'one', revision: 'one' }) };
    await expect(cache.get(input)).rejects.toThrow('renderer unavailable');
    await expect(cache.get(input)).rejects.toThrow('renderer unavailable');
  });

  it('bounds the pending queue instead of spawning a renderer per card', async () => {
    let release!: () => void;
    const ready = new Promise<void>(resolve => { release = resolve; });
    const cache = createProjectThumbnailCache({ dataRoot: await root(), render: async () => { await ready; return png; } });
    const jobs = Array.from({ length: 48 }, (_, i) => cache.get({ identity: String(i), read: async () => ({ html: String(i), revision: String(i) }) }));
    await expect(cache.get({ identity: 'overflow', read: async () => ({ html: '', revision: '' }) })).rejects.toThrow('queue is full');
    release();
    await Promise.all(jobs);
  });
});
