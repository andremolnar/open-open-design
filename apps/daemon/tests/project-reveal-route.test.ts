import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, symlink, realpath, rm } from 'node:fs/promises';
import type http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import type { RevealProjectPathResponse } from '@open-design/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerHostToolsRoutes, resolveProjectRevealLaunchPlan, type RegisterHostToolsRoutesDeps } from '../src/routes/host-tools.js';

const state = vi.hoisted(() => ({ fail: false, authorized: true, available: true }));
vi.mock('node:child_process', async (original) => ({
  ...await original<typeof import('node:child_process')>(),
  spawn: vi.fn(() => {
    const child = Object.assign(new EventEmitter(), { unref() {} });
    queueMicrotask(() => state.fail ? child.emit('error', new Error('launch refused')) : child.emit('spawn'));
    return child;
  }),
}));
vi.mock('node:fs/promises', async (original) => ({
  ...await original<typeof import('node:fs/promises')>(),
  access: vi.fn(async () => { if (!state.available) throw new Error('not installed'); }),
}));

let server: http.Server;
let base: string;
let root: string;
let projectDir: string;
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'od-reveal-'));
  projectDir = path.join(root, 'project');
  await mkdir(path.join(projectDir, 'nested folder'), { recursive: true });
  await writeFile(path.join(projectDir, 'nested folder', 'image & notes.png'), 'fixture');
  await writeFile(path.join(root, 'outside.txt'), 'outside');
  await symlink(path.join(root, 'outside.txt'), path.join(projectDir, 'escape.txt'));
  const app = express();
  app.use(express.json());
  registerHostToolsRoutes(app, {
    db: {},
    http: { sendApiError: (res: express.Response, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } }) },
    paths: { PROJECTS_DIR: root },
    projectStore: { getProject: (_db: unknown, id: string) => id === 'project' ? { id, metadata: { baseDir: projectDir } }
      : id === 'managed' ? { id, metadata: {} } : null },
    projectFiles: { resolveProjectDir: () => projectDir },
    authorizeProjectRequest: async (_req: express.Request, res: express.Response) => {
      if (state.authorized) return true;
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'not authorized' } });
      return false;
    },
  } as unknown as RegisterHostToolsRoutesDeps);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
beforeEach(() => { vi.clearAllMocks(); state.fail = false; state.authorized = true; state.available = true; });
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
});
function reveal(body: unknown = {}, project = 'project') {
  return fetch(`${base}/api/projects/${project}/reveal`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}

describe('project and item reveal', () => {
  it('reveals the project directory without launching an editor', async () => {
    const response = await reveal();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, platform: process.platform });
    expect(spawn).toHaveBeenCalledOnce();
    const [, args, options] = vi.mocked(spawn).mock.calls[0]!;
    expect(args).toContain(await realpath(projectDir));
    expect(options).not.toHaveProperty('shell', true);
  });
  it('reveals a nested item with spaces and shell metacharacters as one path argument', async () => {
    const response = await reveal({ path: 'nested folder/image & notes.png' });
    expect(response.status).toBe(200);
    const body = await response.json() as RevealProjectPathResponse;
    expect(body.path).toMatch(/nested folder[/\\]image & notes\.png$/);
    const [, args, options] = vi.mocked(spawn).mock.calls[0]!;
    expect((args as string[]).join(' ')).toContain(process.platform === 'linux' ? 'nested folder' : 'image & notes.png');
    expect(options).not.toHaveProperty('shell', true);
  });
  it('reveals an empty folder', async () => {
    expect((await reveal({ path: 'nested folder' })).status).toBe(200);
  });
  it('uses the managed project resolver when there is no imported base directory', async () => {
    expect((await reveal({}, 'managed')).status).toBe(200);
  });
  it('reports a missing file browser without claiming success', async () => {
    state.available = false;
    expect((await reveal()).status).toBe(409);
    expect(spawn).not.toHaveBeenCalled();
  });
  it.each(['../outside.txt', '/etc/passwd', 'C:\\Windows\\system.ini', 'nested folder/../../outside.txt', 'a\\..\\outside.txt', 'file\u0000.txt'])('rejects invalid relative paths: %s', async (value) => {
    expect((await reveal({ path: value })).status).toBe(400);
    expect(spawn).not.toHaveBeenCalled();
  });
  it('does not follow a symlink out of the project', async () => {
    expect((await reveal({ path: 'escape.txt' })).status).toBe(403);
    expect(spawn).not.toHaveBeenCalled();
  });
  it('reports missing files and missing projects without launching anything', async () => {
    expect((await reveal({ path: 'missing.png' })).status).toBe(404);
    expect((await reveal({}, 'unknown')).status).toBe(404);
    expect(spawn).not.toHaveBeenCalled();
  });
  it('requires project authorization before resolving or launching a path', async () => {
    state.authorized = false;
    expect((await reveal()).status).toBe(403);
    expect(spawn).not.toHaveBeenCalled();
  });
  it('reports native launch failures rather than claiming success', async () => {
    state.fail = true;
    const response = await reveal();
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: { code: 'EDITOR_LAUNCH_FAILED' } });
  });
  it.each([{ path: 42 }, { path: null }, { path: ['file.png'] }, []])('rejects malformed request values: %j', async (body) => {
    expect((await reveal(body)).status).toBe(400);
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe('native reveal launch plans', () => {
  it('selects an item in Finder without opening it', async () => {
    expect((await resolveProjectRevealLaunchPlan('darwin', '/project/item.app', false)).args).toEqual(['-R', '/project/item.app']);
  });
  it('opens the project folder in Explorer and uses selection for individual items', async () => {
    const item = 'C:\\project folder\\image & notes.png';
    expect((await resolveProjectRevealLaunchPlan('win32', item, false)).args).toEqual(['/select,', item]);
    expect((await resolveProjectRevealLaunchPlan('win32', 'C:\\project folder', true)).args).toEqual(['C:\\project folder']);
  });
  it('opens the containing folder on Linux, never the selected file association', async () => {
    expect((await resolveProjectRevealLaunchPlan('linux', '/project/item.pdf', false)).args).toEqual(['/project']);
    expect((await resolveProjectRevealLaunchPlan('linux', '/project', true)).args).toEqual(['/project']);
  });
  it('fails closed on unsupported hosts', async () => {
    expect(await resolveProjectRevealLaunchPlan('unknown', '/project', true)).toEqual({ available: false });
  });
});
