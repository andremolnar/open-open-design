import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubscribeCallback } from '@parcel/watcher';

const mocks = vi.hoisted(() => ({
  callback: undefined as SubscribeCallback | undefined,
  unsubscribe: vi.fn(async () => {}),
  stat: vi.fn(),
  realpath: vi.fn(),
}));
vi.mock('@parcel/watcher', () => ({
  subscribe: vi.fn(async (_root: string, callback: SubscribeCallback) => {
    mocks.callback = callback;
    return { unsubscribe: mocks.unsubscribe };
  }),
}));
vi.mock('node:fs/promises', () => ({
  lstat: mocks.stat,
  realpath: mocks.realpath,
  readdir: vi.fn(async () => []),
}));

import { createNativeProjectWatcher, type ProjectFilesystemWatcher } from '../../src/services/project-native-watcher.js';

const root = path.resolve('fixture-project');
const file = path.join(root, 'index.html');
let watcher: ProjectFilesystemWatcher | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  mocks.callback = undefined;
  mocks.unsubscribe.mockClear();
  mocks.realpath.mockImplementation(async (file: string) => file);
  mocks.stat.mockResolvedValue({ isFile: () => true, ino: 1, size: 5, mtimeMs: 1 });
});
afterEach(async () => {
  await watcher?.close();
  watcher = undefined;
  vi.useRealTimers();
});

async function start() {
  watcher = createNativeProjectWatcher(root, {
    ignored: () => false,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 20 },
  });
  const events: string[] = [];
  watcher.on('add', () => events.push('add'));
  watcher.on('change', () => events.push('change'));
  watcher.on('unlink', () => events.push('unlink'));
  await new Promise<void>(resolve => watcher!.once('ready', resolve));
  return events;
}

describe('native project watcher adapter', () => {
  it('waits for file metadata to remain stable before publishing a write', async () => {
    const events = await start();
    mocks.callback!(null, [{ path: file, type: 'create' }]);
    await vi.advanceTimersByTimeAsync(80);
    expect(events).toEqual([]);
    mocks.stat.mockResolvedValue({ isFile: () => true, ino: 1, size: 10, mtimeMs: 2 });
    await vi.advanceTimersByTimeAsync(80);
    expect(events).toEqual([]);
    await vi.advanceTimersByTimeAsync(40);
    expect(events).toEqual(['add']);
  });

  it('does not publish a file whose real path escapes the selected root', async () => {
    const events = await start();
    mocks.realpath.mockResolvedValue(path.resolve('outside-project', 'secret'));
    mocks.callback!(null, [{ path: file, type: 'create' }]);
    await vi.advanceTimersByTimeAsync(500);
    expect(events).toEqual([]);
  });

  it('cancels pending writes and unsubscribes when the last observer closes', async () => {
    const events = await start();
    mocks.callback!(null, [{ path: file, type: 'create' }]);
    await vi.advanceTimersByTimeAsync(0);
    await watcher!.close();
    watcher = undefined;
    await vi.advanceTimersByTimeAsync(500);
    expect(events).toEqual([]);
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  });

  it('unsubscribes only once when shutdown requests overlap', async () => {
    await start();
    await Promise.all([watcher!.close(), watcher!.close()]);
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
    watcher = undefined;
  });
});
