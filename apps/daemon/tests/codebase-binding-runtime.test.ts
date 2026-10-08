import { randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import type { ProjectCodebaseBindingResponse, ProjectSourceContextResponse } from '@open-design/contracts';
import { startServer, type StartServerResult, resetDesktopAuthForTests } from '../src/server.js';

async function sourceSnapshot(root: string): Promise<Record<string, unknown>> {
  const entries: Record<string, unknown> = {};
  async function walk(relative: string): Promise<void> {
    const file = path.join(root, relative);
    const info = await lstat(file, { bigint: true });
    entries[relative] = { mode: String(info.mode), mtime: String(info.mtimeNs),
      bytes: info.isFile() ? (await readFile(file)).toString('base64') : undefined };
    if (info.isDirectory()) for (const child of (await readdir(file)).sort()) await walk(path.join(relative, child));
  }
  await walk('.');
  return entries;
}

/** Observe the actual server, upload pipeline and runtime cwd, not a mocked binding service. */
it('keeps real upload/reference and mock-agent writes in design storage before/after restart and with a missing source', async () => {
  const fixture = await realpath(await mkdtemp(path.join(os.tmpdir(), 'od-binding-runtime-')));
  const source = path.join(fixture, 'source');
  const existingReference = path.join(fixture, 'existing-reference');
  const binDir = path.join(fixture, 'bin');
  await mkdir(path.join(source, 'apps/web/src/components'), { recursive: true });
  await mkdir(existingReference);
  await mkdir(binDir);
  await writeFile(path.join(source, 'apps/web/package.json'), '{"name":"untouched"}');
  await writeFile(path.join(source, '.hidden'), 'untouched hidden bytes');
  await writeFile(path.join(source, 'AGENTS.md'), 'OD_SOURCE_ROOT: Design cards use calm botanical colors.');
  await writeFile(path.join(source, 'apps/AGENTS.md'), 'OD_SOURCE_ANCESTOR: Retain generous 24px spacing.');
  await writeFile(path.join(source, 'apps/web/AGENTS.md'), 'OD_SOURCE_PACKAGE: Favor the existing BotanicalCard visual language.');
  await writeFile(path.join(source, 'apps/web/src/components/BotanicalCard.tsx'),
    'export const BotanicalCard = () => <article className="botanical-card">OD_SOURCE_COMPONENT</article>;');
  await writeFile(path.join(source, 'apps/web/src/tokens.css'), ':root { --brand-leaf: #147d64; --card-radius: 18px; }');
  await chmod(path.join(source, 'apps/web/src/tokens.css'), 0o444);
  const sourceBefore = await sourceSnapshot(source);
  const script = `
const fs = require('node:fs');
const path = require('node:path');
if (process.argv.includes('--version')) { console.log('2.0.18'); process.exit(0); }
if (process.argv.includes('--help')) { console.log('run --standalone --format json'); process.exit(0); }
if (process.argv[2] !== 'run') process.exit(0);
let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { prompt += chunk; });
process.stdin.on('end', () => {
  let config = {};
  try { config = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT || '{}'); } catch {}
  fs.writeFileSync(path.join(process.cwd(), 'invocation.json'), JSON.stringify({
    cwd: process.cwd(), argv: process.argv.slice(2), prompt,
    permissions: config.permission || null,
    disableProjectConfig: process.env.OPENCODE_DISABLE_PROJECT_CONFIG,
  }));
  const sourceInformed = prompt.includes('OD_SOURCE_PACKAGE') && prompt.includes('OD_SOURCE_COMPONENT') && prompt.includes('#147d64');
  fs.writeFileSync(path.join(process.cwd(), 'mockup.html'), '<!doctype html><html><body>' + (sourceInformed ? '<article style="color:#147d64">BotanicalCard source-informed mockup</article>' : 'Binding regression mockup') + '</body></html>');
  console.log(JSON.stringify({ type: 'step_start' }));
  console.log(JSON.stringify({ type: 'text', part: { text: 'Created mockup.html' } }));
  console.log(JSON.stringify({ type: 'step_finish', part: { tokens: { input: 1, output: 1 } } }));
});
`;
  if (process.platform === 'win32') {
    await writeFile(path.join(binDir, 'runner.cjs'), script);
    await writeFile(path.join(binDir, 'opencode-cli.cmd'), '@echo off\r\nnode "%~dp0runner.cjs" %*\r\n');
  } else {
    await writeFile(path.join(binDir, 'opencode-cli'), `#!/usr/bin/env node\n${script}`);
    await chmod(path.join(binDir, 'opencode-cli'), 0o755);
  }
  vi.stubEnv('PATH', `${binDir}${path.delimiter}${process.env.PATH ?? ''}`);
  vi.stubEnv('OD_API_TOKEN', 'binding-runtime-fixture-token');
  resetDesktopAuthForTests();
  let started: StartServerResult | undefined;
  let baseUrl = '';
  const headers = { 'content-type': 'application/json', authorization: 'Bearer binding-runtime-fixture-token' };
  const open = async () => {
    started = await startServer({ port: 0, returnServer: true }) as StartServerResult;
    baseUrl = started.url;
  };
  const close = async () => {
    if (!started) return;
    await started.shutdown();
    started.server.closeAllConnections();
    await new Promise<void>((resolve, reject) => started!.server.close((error) => error ? reject(error) : resolve()));
    started = undefined;
  };
  try {
    await open();
    const created = await fetch(`${baseUrl}/api/projects`, { method: 'POST', headers,
      body: JSON.stringify({ id: `binding-runtime-${randomUUID()}`, name: 'Binding runtime fixture', metadata: { kind: 'prototype', skipDiscoveryBrief: true, linkedDirs: [existingReference] } }) });
    expect(created.status, await created.clone().text()).toBe(200);
    const { project } = await created.json() as { project: { id: string; metadata: Record<string, unknown> } };
    const endpoint = `/api/projects/${project.id}/codebase-binding`;
    const status = async () => {
      const response = await fetch(`${baseUrl}${endpoint}`, { headers });
      expect(response.status, await response.clone().text()).toBe(200);
      return await response.json() as ProjectCodebaseBindingResponse;
    };
    expect((await fetch(`${baseUrl}${endpoint}`, { headers: { origin: 'https://untrusted.example' } })).status).toBe(403);
    const initial = await status();
    const runAndUpload = async (tag: string) => {
      const form = new FormData();
      form.append('files', new Blob([`Reference ${tag}`], { type: 'text/plain' }), `reference-${tag}.txt`);
      const upload = await fetch(`${baseUrl}/api/projects/${project.id}/upload`, {
        method: 'POST', headers: { authorization: headers.authorization }, body: form,
      });
      expect(upload.status).toBe(200);
      expect(await readFile(path.join(initial.designStoragePath, `reference-${tag}.txt`), 'utf8')).toBe(`Reference ${tag}`);
      const conversationsResponse = await fetch(`${baseUrl}/api/projects/${project.id}/conversations`, { headers });
      const conversations = await conversationsResponse.json() as { conversations: Array<{ id: string }> };
      const response = await fetch(`${baseUrl}/api/chat`, { method: 'POST', headers,
        body: JSON.stringify({ agentId: 'opencode', projectId: project.id,
          conversationId: conversations.conversations[0]!.id,
          assistantMessageId: `assistant-${randomUUID()}`, message: 'Create mockup.html with a simple page.' }),
      });
      expect(response.status).toBe(200);
      // Stream completion is the real subprocess/turn boundary. No sleep or
      // eventual-file polling can hide a failed or still-running generation.
      const events = await response.text();
      expect(events).toContain('Created mockup.html');
      const invocation = JSON.parse(await readFile(path.join(initial.designStoragePath, 'invocation.json'), 'utf8')) as {
        cwd: string; argv: string[]; prompt: string; permissions: unknown; disableProjectConfig: string;
      };
      expect(invocation.cwd).toBe(await realpath(initial.designStoragePath));
      expect(invocation.argv.slice(0, 4)).toEqual(['run', '--standalone', '--format', 'json']);
      expect(invocation.disableProjectConfig).toBe('true');
      expect(JSON.stringify(invocation)).not.toContain(source);
      expect(await readFile(path.join(initial.designStoragePath, 'mockup.html'), 'utf8')).toContain('mockup');
      const refreshed = await fetch(`${baseUrl}/api/projects/${project.id}`, { headers });
      const body = await refreshed.json() as { project: { metadata: Record<string, unknown> } };
      expect(body.project.metadata.linkedDirs).toEqual([existingReference]);
      expect(body.project.metadata.baseDir).toBeUndefined();
      return invocation;
    };
    const beforeBinding = await runAndUpload('unbound');
    expect(beforeBinding.prompt).not.toContain('Bound codebase source evidence');
    const connected = await fetch(`${baseUrl}${endpoint}`, { method: 'PUT', headers,
      body: JSON.stringify({ sourceRoot: source, appRelativePath: 'apps/web', expectedRevision: null }) });
    expect(connected.status).toBe(200);
    const saved = await status();
    expect(saved.status).toBe('connected');
    expect(saved.designStoragePath).toBe(initial.designStoragePath);
    const contextResponse = await fetch(`${baseUrl}/api/projects/${project.id}/source-context`, { headers });
    expect(contextResponse.status).toBe(200);
    const context = await contextResponse.json() as ProjectSourceContextResponse;
    expect(context).toMatchObject({ status: 'ready', projectId: project.id, bindingRevision: 1 });
    expect(context.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'component', content: expect.stringContaining('OD_SOURCE_COMPONENT') }),
      expect.objectContaining({ kind: 'tokens', content: expect.stringContaining('#147d64') }),
    ]));
    const reverse = async () => {
      const response = await fetch(`${baseUrl}/api/projects/source-context/resolve`, { method: 'POST', headers,
        body: JSON.stringify({ sourceRoot: source, appRelativePath: 'apps/web', projectId: project.id }),
      });
      expect(response.status).toBe(200);
      return await response.json() as ProjectSourceContextResponse;
    };
    expect(await reverse()).toMatchObject({ status: 'ready', projectId: project.id, bindingRevision: 1 });
    const patched = await fetch(`${baseUrl}/api/projects/${project.id}`, { method: 'PATCH', headers,
      body: JSON.stringify({ name: 'Renamed bound project', metadata: { kind: 'prototype', skipDiscoveryBrief: true, linkedDirs: [existingReference] } }) });
    expect(patched.status, await patched.clone().text()).toBe(200);
    expect(await status()).toEqual(saved);
    const bound = await runAndUpload('bound');
    expect(bound.argv).toEqual(beforeBinding.argv);
    expect(bound.permissions).toEqual(beforeBinding.permissions);
    for (const evidence of ['OD_SOURCE_ROOT', 'OD_SOURCE_ANCESTOR', 'OD_SOURCE_PACKAGE', 'OD_SOURCE_COMPONENT', '#147d64']) {
      expect(bound.prompt).toContain(evidence);
    }
    expect(bound.prompt).toContain('read-only');
    expect(bound.prompt).toContain('not execution authority');
    expect(bound.prompt).toContain('"bindingRevision": 1');
    expect(await readFile(path.join(initial.designStoragePath, 'mockup.html'), 'utf8'))
      .toContain('<article style="color:#147d64">BotanicalCard source-informed mockup</article>');
    expect(await sourceSnapshot(source)).toEqual(sourceBefore);
    // The client-composed BYOK API path joins the same saved context at the
    // daemon proxy boundary; no provider, script, or network is needed here.
    const realFetch = globalThis.fetch;
    let providerBody = '';
    vi.stubGlobal('fetch', async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      if (String(input).startsWith(baseUrl)) return realFetch(input, init);
      if (String(input) === 'https://source-context.example/v1/chat/completions') {
        providerBody = String(init?.body ?? '');
        return new Response('data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
      }
      throw new Error(`Unexpected fixture egress: ${String(input)}`);
    });
    try {
      const proxy = await realFetch(`${baseUrl}/api/proxy/openai/stream`, { method: 'POST', headers,
        body: JSON.stringify({ projectId: project.id, baseUrl: 'https://source-context.example/v1',
          apiKey: 'fixture-key', model: 'fixture-model', systemPrompt: 'Client artifact instructions',
          messages: [{ role: 'user', content: 'Create botanical cards.' }] }),
      });
      expect(proxy.status, await proxy.clone().text()).toBe(200);
      await proxy.text();
      for (const evidence of ['Client artifact instructions', 'OD_SOURCE_ROOT', 'OD_SOURCE_COMPONENT', '#147d64']) {
        expect(providerBody).toContain(evidence);
      }
      expect(providerBody).not.toContain(source);
      expect(await sourceSnapshot(source)).toEqual(sourceBefore);
    } finally {
      vi.unstubAllGlobals();
    }
    await close();
    await open();
    expect(await status()).toEqual(saved);
    const restarted = await runAndUpload('restarted');
    expect(restarted.permissions).toEqual(beforeBinding.permissions);
    expect(restarted.prompt).toContain('OD_SOURCE_COMPONENT');
    expect(await sourceSnapshot(source)).toEqual(sourceBefore);
    await rename(source, `${source}-moved`);
    expect((await status()).status).toBe('unavailable');
    expect(await reverse()).toMatchObject({ status: 'unavailable', evidence: [] });
    const unavailable = await runAndUpload('unavailable');
    expect(unavailable.permissions).toEqual(beforeBinding.permissions);
    expect(unavailable.prompt).toContain('The bound source context is unavailable');
    expect(unavailable.prompt).toContain('missing_source');
    expect(unavailable.prompt).not.toContain('OD_SOURCE_COMPONENT');
    expect(unavailable.prompt).not.toContain('#147d64');
    await expect(lstat(source)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await sourceSnapshot(`${source}-moved`)).toEqual(sourceBefore);
  } finally {
    await close();
    resetDesktopAuthForTests();
    vi.unstubAllEnvs();
    await rm(fixture, { recursive: true, force: true });
  }
}, 60_000);
