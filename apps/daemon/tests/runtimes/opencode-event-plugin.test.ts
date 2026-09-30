import { appendFileSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { applyOpenCodeEventPlugin, OPEN_CODE_EVENT_PLUGIN_SOURCE, supportsOpenCodeEventPlugin, watchOpenCodeToolPreviews } from '../../src/runtimes/opencode-event-plugin.js';
import { createJsonEventStreamHandler } from '../../src/runtimes/json-event-stream.js';

type Frame = Record<string, unknown>;
function parser() {
  const events: Frame[] = [];
  const handler = createJsonEventStreamHandler('opencode', event => events.push(event));
  const feed = (event: Frame) => handler.feed(`${JSON.stringify(event)}\n`);
  feed({ type: 'step_start', sessionID: 'root' });
  const preview = (extra: Frame = {}) => feed({ type: 'od_opencode_tool', version: 1, sessionID: 'root', callID: 'call', tool: 'write', ...extra });
  return { events, handler, feed, preview };
}

test('stages a V2 plugin directory with a unique private preview stream while preserving config', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'od-opencode-plugin-'));
  try {
    const env: NodeJS.ProcessEnv = { OPENCODE_CONFIG_CONTENT: JSON.stringify({ mcp: { servers: {} }, plugins: ['overlay-plugin'] }) };
    const first = applyOpenCodeEventPlugin(env, root, '2.0.18', JSON.stringify({ plugins: ['user-plugin', 'overlay-plugin'] }));
    const second = applyOpenCodeEventPlugin(env, root, '2.0.18');
    expect(first).not.toBe(second);
    const config = JSON.parse(env.OPENCODE_CONFIG_CONTENT!);
    expect(config.mcp).toEqual({ servers: {} });
    expect(config.plugins.slice(0, 2)).toEqual(['user-plugin', 'overlay-plugin']);
    expect(config.plugins).toHaveLength(3);
    const file = path.join(config.plugins[2], 'index.mjs');
    expect(file.startsWith(root + path.sep)).toBe(true);
    expect(await readFile(file, 'utf8')).toBe(OPEN_CODE_EVENT_PLUGIN_SOURCE);
    expect(await readdir(path.dirname(file))).toEqual(['index.mjs']);
    expect((await stat(first!)).mode & 0o777).toBe(0o600);
    expect(env.OD_OPENCODE_PREVIEW_FILE).toBe(second);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test.each(['1.18.30', '1.17.18', 'unknown', undefined])('unsupported version %s leaves config and disk untouched', version => {
  const env = { OPENCODE_CONFIG_CONTENT: '{"plugins":["user"]}' };
  expect(applyOpenCodeEventPlugin(env, '/not-a-staging-directory', version)).toBeNull();
  expect(env.OPENCODE_CONFIG_CONTENT).toBe('{"plugins":["user"]}');
});

test('rejects malformed plugin lists without mutating the config', () => {
  expect(supportsOpenCodeEventPlugin('2.0.18')).toBe(true);
  expect(supportsOpenCodeEventPlugin('1.18.30')).toBe(false);
  const env = { OPENCODE_CONFIG_CONTENT: '{"plugins":42}' };
  expect(applyOpenCodeEventPlugin(env, '/not-a-staging-directory', '2.0.18')).toBeNull();
  expect(env.OPENCODE_CONFIG_CONTENT).toBe('{"plugins":42}');
});

test('reuses intact generated code, repairs corruption, and drains on close', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'od-opencode-repair-'));
  const env: NodeJS.ProcessEnv = {};
  try {
    const first = applyOpenCodeEventPlugin(env, root, '2.0.18')!;
    const file = path.join(JSON.parse(env.OPENCODE_CONFIG_CONTENT!).plugins[0], 'index.mjs');
    const before = await stat(file);
    const second = applyOpenCodeEventPlugin(env, root, '2.0.18')!;
    expect((await stat(file)).ino).toBe(before.ino);
    await writeFile(file, 'truncated');
    applyOpenCodeEventPlugin(env, root, '2.0.18');
    expect(await readFile(file, 'utf8')).toBe(OPEN_CODE_EVENT_PLUGIN_SOURCE);
    const lines: string[] = [];
    const close = watchOpenCodeToolPreviews(second, line => lines.push(line));
    appendFileSync(second, '{"type":"od_opencode_tool","version":1}\n');
    close();
    expect(lines).toEqual(['{"type":"od_opencode_tool","version":1}\n']);
    await expect(stat(second)).rejects.toThrow();
    await rm(first);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test.each(['completed', 'error'])('pending row merges into exactly one native %s pair with full arguments', status => {
  const { events, handler, feed, preview } = parser();
  preview();
  preview();
  expect(events.filter(e => e.type === 'tool_in_flight')).toHaveLength(1);
  expect(events.filter(e => e.type === 'tool_use')).toHaveLength(0);
  preview({ path: '/work/large.txt' });
  const previews = events.filter(e => e.type === 'tool_in_flight');
  expect(previews[0]!.input).toEqual({});
  expect(previews[1]!.startedAt).toBe(previews[0]!.startedAt);
  const input = { filePath: '/work/large.txt', content: 'x'.repeat(200_000) };
  const native = { type: 'tool_use', sessionID: 'root', part: { tool: 'write', callID: 'call', state: { status, input, output: 'wrote file', ...(status === 'error' ? { error: 'denied' } : {}) } } };
  feed(native);
  feed(native);
  preview();
  handler.flush();
  expect(events.filter(e => e.type === 'tool_in_flight')).toHaveLength(2);
  const uses = events.filter(e => e.type === 'tool_use');
  expect(uses).toHaveLength(1);
  expect(uses[0]).toMatchObject({ id: previews[0]!.id, input });
  const results = events.filter(e => e.type === 'tool_result');
  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({ toolUseId: 'call', isError: status === 'error' });
});

test('preview filtering rejects other sessions and versions; truncated streams settle once', () => {
  const { events, handler, preview } = parser();
  preview({ sessionID: 'child' });
  preview({ version: 2 });
  preview({ tool: null });
  expect(events).toHaveLength(1);
  preview();
  handler.flush();
  handler.flush();
  preview({ callID: 'late' });
  expect(events.filter(e => e.type === 'tool_in_flight')).toHaveLength(1);
  expect(events.filter(e => e.type === 'tool_use')).toHaveLength(1);
  expect(events.filter(e => e.type === 'tool_result')).toEqual([
    { type: 'tool_result', toolUseId: 'call', content: 'Tool stream ended before completion was reported.', isError: true },
  ]);
});

test('JSON lines can split across stdout chunks without exposing a raw plugin frame', () => {
  const { events, handler } = parser();
  const line = JSON.stringify({ type: 'od_opencode_tool', version: 1, sessionID: 'root', callID: 'call', tool: 'bash' }) + '\n';
  handler.feed(line.slice(0, 40));
  expect(events).toHaveLength(1);
  handler.feed(line.slice(40));
  expect(events[1]).toMatchObject({ type: 'tool_in_flight', name: 'bash' });
  expect(events.some(e => e.type === 'raw')).toBe(false);
});

test('pending can precede native step_start; only matching root previews are released', () => {
  const events: Frame[] = [];
  const handler = createJsonEventStreamHandler('opencode', event => events.push(event));
  for (const sessionID of ['child', 'root']) handler.feed(JSON.stringify({ type: 'od_opencode_tool', version: 1, sessionID, callID: sessionID, tool: 'write' }) + '\n');
  expect(events).toEqual([]);
  handler.feed('{"type":"step_start","sessionID":"root"}\n');
  expect(events.filter(e => e.type === 'tool_in_flight')).toEqual([
    { type: 'tool_in_flight', id: 'root', name: 'write', input: {}, startedAt: expect.any(Number) },
  ]);
});
