import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, rmSync, statSync, watch, writeFileSync } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';

// Generated V2 plugin: no external dependencies in the packaged CLI's server.
// V2's private server has a different stdout from `opencode run`. A run-local
// JSONL file carries only tool previews back to the daemon; final CLI frames
// remain authoritative for tool results.
export const OPEN_CODE_EVENT_PLUGIN_SOURCE = String.raw`import { appendFileSync } from 'node:fs';

export default {
  id: 'open-design.tool-previews',
  setup(ctx) {
    const output = process.env.OD_OPENCODE_PREVIEW_FILE;
    if (!output) return;
    const controller = new AbortController();
    const names = new Map();
    const seen = new Set();
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          const data = event?.data;
          if (!data || typeof data.sessionID !== 'string' || typeof data.id !== 'string') continue;
          const key = data.sessionID + ':' + data.id;
          if (event.type === 'session.tool.input.started' && typeof data.name === 'string') {
            names.set(key, data.name);
          } else if (event.type === 'session.tool.called') {
            const name = names.get(key);
            if (!name || seen.has(key)) continue;
            seen.add(key);
            names.delete(key);
            const target = ['write', 'edit', 'read'].includes(name) && typeof data.input?.filePath === 'string'
              ? data.input.filePath : undefined;
            try {
              appendFileSync(output, JSON.stringify({ type: 'od_opencode_tool', version: 1,
                sessionID: data.sessionID, callID: data.id, tool: name, path: target }) + '\n');
            } catch { /* Previews must never interrupt tool execution. */ }
          } else if (event.type === 'session.tool.failure' || event.type === 'session.tool.success') {
            names.delete(key);
            seen.delete(key);
          }
        }
      } catch { /* A disconnected subscription must not affect the run. */ }
    })();
    return () => controller.abort();
  },
};
`;

export function supportsOpenCodeEventPlugin(version: string | undefined): boolean {
  return /^2\.\d+\.\d+$/u.test(version ?? '');
}

/** Stage the V2 plugin directory and create an isolated, run-local preview file. */
export function applyOpenCodeEventPlugin(
  env: NodeJS.ProcessEnv,
  dataDir: string,
  version: string | undefined,
  inheritedConfigContent?: string,
): string | null {
  if (!supportsOpenCodeEventPlugin(version)) return null;
  const overlay = env.OPENCODE_CONFIG_CONTENT ? JSON.parse(env.OPENCODE_CONFIG_CONTENT) as Record<string, unknown> : {};
  if (!overlay || typeof overlay !== 'object' || Array.isArray(overlay) ||
      (overlay.plugins !== undefined && !Array.isArray(overlay.plugins))) return null;
  const inherited = inheritedConfigContent ? JSON.parse(inheritedConfigContent) as Record<string, unknown> : {};
  const inheritedPlugins = Array.isArray(inherited.plugins) ? inherited.plugins : [];
  const plugins = Array.isArray(overlay.plugins) ? overlay.plugins : [];
  const hash = createHash('sha256').update(OPEN_CODE_EVENT_PLUGIN_SOURCE).digest('hex').slice(0, 16);
  const root = path.join(dataDir, 'agent-runtime', 'opencode');
  const pluginDir = path.join(root, `tool-events-${hash}`);
  const file = path.join(pluginDir, 'index.mjs');
  mkdirSync(pluginDir, { recursive: true });
  if (!existsSync(file) || readFileSync(file, 'utf8') !== OPEN_CODE_EVENT_PLUGIN_SOURCE) {
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, OPEN_CODE_EVENT_PLUGIN_SOURCE, { flag: 'wx', mode: 0o600 });
      renameSync(temporary, file);
    } finally {
      rmSync(temporary, { force: true });
    }
  }
  const previewDir = path.join(root, 'previews');
  mkdirSync(previewDir, { recursive: true });
  const previewFile = path.join(previewDir, `${randomUUID()}.jsonl`);
  writeFileSync(previewFile, '', { flag: 'wx', mode: 0o600 });
  env.OD_OPENCODE_PREVIEW_FILE = previewFile;
  env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
    ...overlay, plugins: [...new Set([...inheritedPlugins, ...plugins, pluginDir])],
  });
  return previewFile;
}

/** Drain complete JSONL frames, including a final write just before CLI exit. */
export function watchOpenCodeToolPreviews(file: string, feed: (line: string) => void): () => void {
  const fd = openSync(file, 'r');
  let offset = 0;
  let pending = '';
  const decoder = new StringDecoder('utf8');
  let closed = false;
  let watcher: FSWatcher | null = null;
  const drain = () => {
    if (closed) return;
    const size = statSync(file).size;
    const buffer = Buffer.allocUnsafe(16_384);
    // A corrupt or runaway producer must not make a close event unbounded.
    while (offset < size && offset < 2_097_152) {
      const bytes = readSync(fd, buffer, 0, Math.min(buffer.length, size - offset), offset);
      if (!bytes) break;
      offset += bytes;
      pending += decoder.write(buffer.subarray(0, bytes));
      if (pending.length > 65_536) { pending = ''; continue; }
      let end: number;
      while ((end = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 1);
        if (line) feed(`${line}\n`);
      }
    }
  };
  try {
    watcher = watch(file, () => { try { drain(); } catch { /* Optional preview only. */ } });
    watcher.on('error', () => { watcher?.close(); watcher = null; });
  } catch { /* Final close-time drain still works without filesystem watches. */ }
  return () => {
    try { drain(); } finally {
      closed = true;
      watcher?.close();
      closeSync(fd);
      try { rmSync(file, { force: true }); } catch { /* Preview cleanup cannot fail the Run. */ }
    }
  };
}
