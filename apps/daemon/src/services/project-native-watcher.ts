import { EventEmitter } from 'node:events';
import { lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

import { IGNORED_PROJECT_DIR_NAMES } from '../project-ignored-dirs.js';
import type { ProjectWatchKind, ProjectWatcherOptions } from '../project-watchers.js';

export interface ProjectFilesystemWatcher extends EventEmitter {
  close(): Promise<void>;
}

type Options = Required<Pick<ProjectWatcherOptions, 'ignored' | 'awaitWriteFinish'>>;
type PendingWrite = { timer?: NodeJS.Timeout; signature?: string; stableSince: number; kind: ProjectWatchKind };

/** Native macOS subtree watching must not open a descriptor per project file.
 * Adapt Parcel's FSEvents stream to the registry's file-only event contract,
 * keeping ignored paths, symlink containment and write-stability semantics.
 * Chokidar remains the portable/polling fallback.
 */
export function createNativeProjectWatcher(dir: string, opts: Options): ProjectFilesystemWatcher {
  const watcher = new EventEmitter() as ProjectFilesystemWatcher;
  const files = new Set<string>();
  const pending = new Map<string, PendingWrite>();
  let closed = false;
  let canonicalRoot: string;
  let subscription: { unsubscribe(): Promise<void> } | undefined;
  let closing: Promise<void> | undefined;
  const inside = (file: string) => file.startsWith(canonicalRoot + path.sep);
  const displayPath = (file: string) => path.join(dir, path.relative(canonicalRoot, file));

  const cancel = (file: string) => {
    clearTimeout(pending.get(file)?.timer);
    pending.delete(file);
  };
  const emit = (kind: ProjectWatchKind, file: string) => {
    if (!closed) watcher.emit(kind, displayPath(file));
  };
  const report = (error: unknown) => {
    if (!closed) watcher.emit('error', error);
  };

  const changed = async (file: string) => {
    if (closed || !inside(file) || opts.ignored(displayPath(file))) return;
    const stat = await lstat(file).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (!stat?.isFile() || opts.ignored(displayPath(file), stat)) return;
    const resolved = await realpath(file).catch(() => undefined);
    if (!resolved || !inside(resolved) || closed) return;

    const kind = files.has(file) ? 'change' : 'add';
    files.add(file);
    const previous = pending.get(file);
    cancel(file);
    if (opts.awaitWriteFinish === false) {
      emit(kind, file);
      return;
    }

    const { stabilityThreshold, pollInterval } = opts.awaitWriteFinish;
    const write: PendingWrite = {
      kind: previous?.kind ?? kind,
      signature: `${stat.ino}:${stat.size}:${stat.mtimeMs}`,
      stableSince: Date.now(),
    };
    pending.set(file, write);
    const check = async () => {
      if (closed || pending.get(file) !== write) return;
      const current = await lstat(file).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      });
      if (closed || pending.get(file) !== write) return;
      const resolved = current?.isFile() ? await realpath(file).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      }) : undefined;
      if (closed || pending.get(file) !== write) return;
      if (!current || !resolved || !inside(resolved) || opts.ignored(displayPath(file), current)) {
        cancel(file);
        return;
      }
      const signature = `${current.ino}:${current.size}:${current.mtimeMs}`;
      if (signature !== write.signature) {
        write.signature = signature;
        write.stableSince = Date.now();
      }
      if (Date.now() - write.stableSince >= stabilityThreshold) {
        cancel(file);
        emit(write.kind, file);
      } else {
        write.timer = setTimeout(() => { void check().catch(report); }, Math.max(1, pollInterval));
      }
    };
    write.timer = setTimeout(() => { void check().catch(report); }, Math.max(1, pollInterval));
  };

  const scan = async (directory: string): Promise<void> => {
    if (closed) return;
    const resolved = await realpath(directory);
    if (resolved !== canonicalRoot && !inside(resolved)) return;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (closed) return;
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink() || opts.ignored(displayPath(file))) continue;
      if (entry.isDirectory()) await scan(file);
      else if (entry.isFile()) files.add(file);
    }
  };

  // Defer startup until the registry has installed its error/event listeners.
  const started = Promise.resolve().then(async () => {
    const native = await import('@parcel/watcher');
    if (closed) return;
    canonicalRoot = await realpath(dir);
    subscription = await native.subscribe(canonicalRoot, (error, events) => {
      if (closed) return;
      if (error) { report(error); return; }
      for (const event of events) {
        if (!inside(event.path) || opts.ignored(displayPath(event.path))) continue;
        if (event.type === 'delete') {
          // Native streams may coalesce a removed subtree into one event.
          for (const file of files) {
            if (file !== event.path && !file.startsWith(event.path + path.sep)) continue;
            cancel(file);
            files.delete(file);
            emit('unlink', file);
          }
        } else {
          void changed(event.path).catch(report);
        }
      }
    }, {
      backend: 'fs-events',
      ignore: [...IGNORED_PROJECT_DIR_NAMES].filter(name => opts.ignored(path.join(dir, name))),
    });
    await scan(canonicalRoot);
    if (!closed) watcher.emit('ready');
  }).catch(report);

  watcher.close = () => closing ??= (async () => {
    closed = true;
    for (const file of pending.keys()) cancel(file);
    await started;
    await subscription?.unsubscribe();
    subscription = undefined;
    files.clear();
  })();
  return watcher;
}
