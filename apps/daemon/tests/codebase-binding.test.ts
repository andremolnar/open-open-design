import childProcess from 'node:child_process';
import { once } from 'node:events';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiErrorCode } from '@open-design/contracts';
import {
  closeDatabase, deleteProject, ensureWorkspaceProject, getProject, getWorkspaceProject,
  getWorkspaceProjectByProjectId, insertProject, openDatabase, updateProject,
} from '../src/db.js';
import { createAuthorizeProjectRequest } from '../src/collab/project-request-authority.js';
import type { WorkspaceResourceAccessInput } from '../src/collab/workspace-resource-mutation.js';
import {
  consumedImportNonces, getDesktopAuthSecret, isDesktopAuthGateActive, pruneExpiredImportNonces,
  resetDesktopAuthForTests, setDesktopAuthSecret, signDesktopImportToken, verifyDesktopImportToken,
} from '../src/desktop-auth.js';
import { sendApiError } from '../src/http/api-errors.js';
import { resolveProjectDir, writeProjectFile, buildProjectArchive } from '../src/projects.js';
import { registerProjectCodebaseBindingRoutes, type RegisterProjectCodebaseBindingRoutesDeps } from '../src/routes/project/codebase-binding.js';
import { getCodebaseBinding } from '../src/storage/codebase-binding.js';

let root: string;
let source: string;
let dataRoot: string;
let projectsRoot: string;
let db: ReturnType<typeof openDatabase>;
let server: Server | undefined;
let baseUrl: string;
const id = 'project-a';

async function snapshot(directory: string): Promise<Record<string, unknown>> {
  const output: Record<string, unknown> = {};
  async function walk(current: string, relative: string): Promise<void> {
    const info = await lstat(current, { bigint: true });
    output[relative] = {
      mode: String(info.mode), mtime: String(info.mtimeNs),
      bytes: info.isFile() ? (await readFile(current)).toString('base64') : undefined,
      link: info.isSymbolicLink() ? await readlink(current) : undefined,
    };
    if (info.isDirectory()) {
      for (const entry of (await readdir(current)).sort()) await walk(path.join(current, entry), `${relative}/${entry}`);
    }
  }
  await walk(directory, '.');
  return output;
}

async function stop(): Promise<void> {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
    server = undefined;
  }
  closeDatabase();
}

async function start(): Promise<void> {
  db = openDatabase(root, { dataDir: dataRoot });
  const app = express();
  app.use(express.json());
  const authorizeProjectRequest = createAuthorizeProjectRequest({
    db,
    getWorkspaceProject: (_db, workspaceId, projectId) => getWorkspaceProject(db, workspaceId, projectId) as WorkspaceResourceAccessInput | undefined,
    getWorkspaceProjectByProjectId: (_db, projectId) => getWorkspaceProjectByProjectId(db, projectId) as WorkspaceResourceAccessInput | undefined,
    sendApiError: (res, status, code, message, details) => sendApiError(res, status, code as ApiErrorCode, message, details),
    isProjectUnmaterializedPlaceholder: (_db, projectId) => Boolean(getProject(db, projectId)?.metadata?.sharedProjectPlaceholderAt),
  });
  registerProjectCodebaseBindingRoutes(app, {
    db, http: { sendApiError },
    paths: { PROJECTS_DIR: projectsRoot, RUNTIME_DATA_DIR_CANONICAL: await realpath(dataRoot) },
    projectStore: { getProject, getWorkspaceProject, getWorkspaceProjectByProjectId },
    auth: {
      consumedImportNonces, desktopAuthSecret: getDesktopAuthSecret, isDesktopAuthGateActive,
      pruneExpiredImportNonces, verifyDesktopImportToken,
    },
    authorizeProjectRequest,
  } as RegisterProjectCodebaseBindingRoutesDeps);
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

async function request(method = 'GET', body?: unknown, options: {
  projectId?: string; suffix?: string; headers?: Record<string, string>;
} = {}) {
  const response = await fetch(`${baseUrl}/api/projects/${options.projectId ?? id}/codebase-binding${options.suffix ?? ''}`, {
    method, headers: { 'content-type': 'application/json', ...options.headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() as Record<string, any> };
}

function bind(sourceRoot = source, expectedRevision: number | null = null, appRelativePath = '.') {
  return request('PUT', { sourceRoot, expectedRevision, appRelativePath });
}

function newProject(projectId = id, metadata: Record<string, unknown> = { kind: 'prototype', linkedDirs: ['existing-reference'] }) {
  return insertProject(db, { id: projectId, name: 'Same name', metadata, createdAt: 1, updatedAt: 1 });
}

beforeEach(async () => {
  vi.stubEnv('OD_REQUIRE_DESKTOP_AUTH', '0');
  vi.stubEnv('OD_SANDBOX_MODE', '0');
  resetDesktopAuthForTests();
  root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'od-codebase-binding-')));
  source = path.join(root, 'source');
  dataRoot = path.join(root, 'runtime');
  projectsRoot = path.join(dataRoot, 'projects');
  await mkdir(path.join(source, 'apps', 'web'), { recursive: true });
  await mkdir(projectsRoot, { recursive: true });
  await writeFile(path.join(source, 'tracked.ts'), 'initial tracked bytes');
  await writeFile(path.join(source, '.gitignore'), 'ignored.txt\n');
  childProcess.execFileSync('git', ['init', '--quiet', source]);
  childProcess.execFileSync('git', ['-C', source, 'add', 'tracked.ts', '.gitignore']);
  await writeFile(path.join(source, 'tracked.ts'), 'dirty tracked bytes');
  await writeFile(path.join(source, 'untracked.txt'), 'untracked bytes');
  await writeFile(path.join(source, 'ignored.txt'), 'ignored bytes');
  await writeFile(path.join(source, '.hidden'), 'hidden bytes');
  await writeFile(path.join(source, 'apps/web/package.json'), '{"name":"fixture"}');
  await start();
  newProject();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await stop();
  resetDesktopAuthForTests();
  vi.unstubAllEnvs();
  if (root) await rm(root, { recursive: true, force: true });
});

describe('project-local codebase binding HTTP / SQLite / filesystem boundary', () => {
  it('validates without saving, connects a package, remains idempotent, and survives database/server restart and rename', async () => {
    const before = getProject(db, id);
    expect((await request()).body).toMatchObject({ projectId: id, binding: null, status: 'unbound' });
    const selection = await request('POST', { sourceRoot: source, appRelativePath: 'apps/./web/', expectedRevision: null }, { suffix: '/validate' });
    expect(selection).toMatchObject({ status: 200, body: { sourceRoot: await realpath(source), appRelativePath: 'apps/web', appRoot: await realpath(path.join(source, 'apps/web')) } });
    expect(getCodebaseBinding(db, id)).toBeNull();
    const saved = await bind(source, null, 'apps/web');
    expect(saved).toMatchObject({ status: 200, body: { projectId: id, status: 'connected', binding: { revision: 1, appRelativePath: 'apps/web' } } });
    expect(getProject(db, id)).toEqual(before);
    expect((await bind(source, 1, 'apps/web')).body).toEqual(saved.body);
    updateProject(db, id, { name: 'Renamed', metadata: { kind: 'deck', linkedDirs: ['existing-reference'] } });
    await stop();
    await start();
    expect((await request()).body).toEqual(saved.body);
    expect(getProject(db, id)?.name).toBe('Renamed');
    expect(getProject(db, id)?.metadata).toEqual({ kind: 'deck', linkedDirs: ['existing-reference'] });
  });

  it('does not touch source bytes, names, modes or mtimes and never spawns a process', async () => {
    const before = await snapshot(source);
    const spies = ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']
      .map((name) => vi.spyOn(childProcess, name as 'spawn'));
    expect((await bind()).status).toBe(200);
    expect((await request()).body.status).toBe('connected');
    expect((await bind(source, 1, 'apps/web')).status).toBe(200);
    expect(await snapshot(source)).toEqual(before);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('leaves design storage, artifact writes and archives independent after restart and while source is missing', async () => {
    const before = await snapshot(source);
    await bind();
    const writeDesign = async (name: string) => {
      const project = getProject(db, id)!;
      expect(resolveProjectDir(projectsRoot, id, project.metadata)).toBe(path.join(projectsRoot, id));
      await writeProjectFile(projectsRoot, id, name, '<html><body>Design reference</body></html>', {}, project.metadata);
      expect(await readFile(path.join(projectsRoot, id, name), 'utf8')).toContain('Design reference');
      expect(project.metadata.linkedDirs).toEqual(['existing-reference']);
      expect(project.metadata.baseDir).toBeUndefined();
    };
    await writeDesign('reference.html');
    await stop(); await start();
    await writeDesign('mockup.html');
    expect(await snapshot(source)).toEqual(before);
    const exported = await buildProjectArchive(projectsRoot, id, undefined, getProject(db, id)!.metadata);
    const zip = (await import('jszip')).default;
    const archive = await zip.loadAsync(exported.buffer);
    expect(Object.keys(archive.files).sort()).toEqual(['DESIGN-HANDOFF.md', 'DESIGN-MANIFEST.json', 'mockup.html', 'reference.html']);
    for (const entry of Object.values(archive.files)) {
      if (!entry.dir) expect(await entry.async('string')).not.toContain(source);
    }
    await rename(source, `${source}-moved`);
    expect((await request()).body).toMatchObject({ status: 'unavailable', reason: 'missing_source' });
    await writeDesign('while-unavailable.html');
    await expect(lstat(source)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('isolates stable IDs, duplication and deletion without copying local binding or deleting source', async () => {
    await bind();
    const original = getProject(db, id)!;
    newProject('project-b', original.metadata);
    expect((await request('GET', undefined, { projectId: 'project-b' })).body.binding).toBeNull();
    expect(JSON.stringify(original)).not.toContain(source);
    deleteProject(db, id);
    expect(getCodebaseBinding(db, id)).toBeNull();
    expect((await lstat(source)).isDirectory()).toBe(true);
    expect((await request()).status).toBe(404);
  });

  it('uses a transactional revision guard for concurrent rebind and preserves old state on invalid or failed saves', async () => {
    await bind();
    const second = path.join(root, 'second');
    const third = path.join(root, 'third');
    await mkdir(second); await mkdir(third);
    const results = await Promise.all([bind(second, 1), bind(third, 1)]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    const previous = (await request()).body;
    expect(previous.binding.revision).toBe(2);
    expect((await bind(path.join(root, 'missing'), 2)).status).toBe(400);
    expect((await request()).body).toEqual(previous);
    db.exec("CREATE TRIGGER reject_binding_write BEFORE UPDATE ON project_codebase_bindings BEGIN SELECT RAISE(ABORT, 'fixture failure'); END");
    expect((await bind(source, 2)).status).toBe(500);
    expect((await request()).body).toEqual(previous);
  });

  it('detects a moved/replaced source and reconnects only through explicit rebind', async () => {
    await bind();
    await rename(source, `${source}-moved`);
    expect((await request()).body.reason).toBe('missing_source');
    await mkdir(source);
    expect((await request()).body.reason).toBe('identity_changed');
    expect((await bind(`${source}-moved`, 1)).body).toMatchObject({ status: 'connected', binding: { revision: 2, sourceRoot: `${source}-moved` } });
  });

  it('detects missing packages and symlink retargets without fallback', async () => {
    await bind(source, null, 'apps/web');
    await rename(path.join(source, 'apps/web'), path.join(source, 'apps/old'));
    expect((await request()).body.reason).toBe('missing_app');
    await mkdir(path.join(source, 'apps/other'));
    await symlink(path.join(source, 'apps/other'), path.join(source, 'apps/web'), 'dir');
    expect((await request()).body.reason).toBe('identity_changed');
    await rm(path.join(source, 'apps/web'));
    await symlink(root, path.join(source, 'apps/web'), 'dir');
    expect((await request()).body.reason).toBe('unsafe_path');
  });

  it.each(['../outside', 'apps/../../outside', '/absolute', 'C:\\outside', '\\\\server\\share', 'C:relative', 'apps\\..\\..\\outside'])
    ('rejects unsafe app paths without replacing a saved connection: %s', async (appRelativePath) => {
      const saved = await bind();
      expect((await bind(source, 1, appRelativePath)).status).toBe(400);
      expect((await request()).body).toEqual(saved.body);
    });

  it('rejects prefix siblings and symlink escapes; accepts a source alias canonically', async () => {
    const sibling = `${source}-other`;
    await mkdir(sibling);
    await symlink(sibling, path.join(source, 'escape'), 'dir');
    expect((await bind(source, null, 'escape')).status).toBe(400);
    const alias = path.join(root, 'alias');
    await symlink(source, alias, 'dir');
    expect((await bind(alias)).body.binding.sourceRoot).toBe(await realpath(source));
  });

  it('rejects system, credential and runtime-data roots, including source parents', async () => {
    for (const sourceRoot of [path.parse(root).root, os.homedir(), dataRoot, projectsRoot, root]) {
      expect((await bind(sourceRoot)).status).toBe(400);
    }
    const fakeHome = path.join(root, 'home');
    await mkdir(path.join(fakeHome, '.ssh'), { recursive: true });
    vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    expect((await bind(path.join(fakeHome, '.ssh'))).body.error.details.reason).toBe('unsafe_path');
    expect(getCodebaseBinding(db, id)).toBeNull();
  });

  it('preserves imported-baseDir storage, rejecting overlap in both directions and accepting a distinct source', async () => {
    const design = path.join(root, 'legacy-design');
    await mkdir(path.join(design, 'nested'), { recursive: true });
    updateProject(db, id, { metadata: { kind: 'prototype', baseDir: design, linkedDirs: ['existing-reference'] } });
    const before = getProject(db, id);
    expect((await request()).body.designStoragePath).toBe(design);
    for (const sourceRoot of [design, path.join(design, 'nested'), root]) {
      expect((await bind(sourceRoot)).body.error.details.reason).toBe('design_storage_overlap');
    }
    expect((await bind()).status).toBe(200);
    expect(getProject(db, id)).toEqual(before);
    await writeProjectFile(projectsRoot, id, 'legacy.html', 'legacy design', {}, before!.metadata);
    expect(await readFile(path.join(design, 'legacy.html'), 'utf8')).toBe('legacy design');
  });

  it('fails closed on unknown schema and retains the exact stored record', async () => {
    await bind();
    db.prepare('UPDATE project_codebase_bindings SET schema_version = 42 WHERE project_id = ?').run(id);
    const before = getCodebaseBinding(db, id);
    expect((await request()).body).toMatchObject({ status: 'unsupported', reason: 'unsupported_schema', binding: { schemaVersion: 42 }, capabilities: { canBind: false } });
    expect((await bind(source, 1)).status).toBe(409);
    expect(getCodebaseBinding(db, id)).toEqual(before);
  });

  it('fails closed when a missing design directory is a dangling symlink into source', async () => {
    const alias = path.join(root, 'design-link');
    await symlink(path.join(source, 'future-designs'), alias, 'dir');
    updateProject(db, id, { metadata: { kind: 'prototype', baseDir: alias } });
    expect((await bind()).body.error.details.reason).toBe('design_storage_unavailable');
    // The same rule must apply when a dangling ancestor precedes the final
    // design directory, not only when baseDir itself is the symlink.
    updateProject(db, id, { metadata: { kind: 'prototype', baseDir: path.join(alias, 'nested') } });
    expect((await bind()).body.error.details.reason).toBe('design_storage_unavailable');
    expect(getCodebaseBinding(db, id)).toBeNull();
    await expect(lstat(path.join(source, 'future-designs'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('enforces sandbox allowlists against canonical targets and recomputes availability', async () => {
    vi.stubEnv('OD_SANDBOX_MODE', '1');
    vi.stubEnv('OD_SANDBOX_IMPORT_ALLOWED_ROOTS', '');
    expect((await request()).body.capabilities.canBind).toBe(false);
    expect((await bind()).body.error.details.reason).toBe('sandbox_unavailable');
    vi.stubEnv('OD_SANDBOX_IMPORT_ALLOWED_ROOTS', source);
    expect((await bind()).status).toBe(200);
    vi.stubEnv('OD_SANDBOX_IMPORT_ALLOWED_ROOTS', `${source}-other`);
    expect((await request()).body).toMatchObject({ status: 'unavailable', reason: 'sandbox_unavailable' });
  });

  it('requires desktop picker trust for canonical selection and consumes tokens only on successful saves', async () => {
    const secret = Buffer.alloc(32, 7);
    setDesktopAuthSecret(secret);
    const headers = { 'x-od-desktop-import-token': signDesktopImportToken(secret, source, { nonce: 'selection', exp: new Date(Date.now() + 60_000).toISOString() }) };
    const input = { sourceRoot: source, expectedRevision: null };
    expect((await request()).body.capabilities.requiresTrustedPicker).toBe(true);
    expect((await request('PUT', input)).status).toBe(403);
    expect((await request('POST', input, { suffix: '/validate', headers })).status).toBe(200);
    expect(consumedImportNonces.size).toBe(0);
    expect((await request('PUT', input, { headers })).status).toBe(200);
    expect((await request('PUT', { ...input, expectedRevision: 1 }, { headers })).status).toBe(403);
    expect(getCodebaseBinding(db, id)?.revision).toBe(1);
    setDesktopAuthSecret(null);
    expect((await bind(source, 1)).status).toBe(503);
  });

  it('rejects token/path mismatch and canonicalized aliases into unsafe paths', async () => {
    const secret = Buffer.alloc(32, 8);
    setDesktopAuthSecret(secret);
    const alias = path.join(root, 'unsafe-alias');
    await symlink(dataRoot, alias, 'dir');
    const headers = { 'x-od-desktop-import-token': signDesktopImportToken(secret, alias, { nonce: 'alias', exp: new Date(Date.now() + 60_000).toISOString() }) };
    expect((await request('PUT', { sourceRoot: source, expectedRevision: null }, { headers })).status).toBe(403);
    expect((await request('PUT', { sourceRoot: alias, expectedRevision: null }, { headers })).status).toBe(400);
    expect(getCodebaseBinding(db, id)).toBeNull();
    expect(consumedImportNonces.size).toBe(0);
  });

  it('rejects a source alias retargeted after canonical preview', async () => {
    const alias = path.join(root, 'selection-alias');
    const other = path.join(root, 'other-source');
    await mkdir(other);
    await symlink(source, alias, 'dir');
    const input = { sourceRoot: alias, expectedRevision: null };
    const selection = await request('POST', input, { suffix: '/validate' });
    expect(selection.status).toBe(200);
    await rm(alias);
    await symlink(other, alias, 'dir');
    expect((await request('PUT', { ...input, expectedSelection: selection.body.selectionFingerprint })).status).toBe(409);
    expect(getCodebaseBinding(db, id)).toBeNull();
  });

  it('requires correct workspace ownership for both status and save, and refuses placeholders', async () => {
    ensureWorkspaceProject(db, { projectId: id, workspaceId: 'workspace-a', visibility: 'team', createdByWorkspaceMemberId: 'owner' });
    const otherWorkspace = { 'x-od-workspace-id': 'workspace-b', 'x-od-workspace-member-id': 'owner' };
    const otherMember = { 'x-od-workspace-id': 'workspace-a', 'x-od-workspace-member-id': 'reader' };
    const owner = { 'x-od-workspace-id': 'workspace-a', 'x-od-workspace-member-id': 'owner' };
    expect((await request('GET', undefined, { headers: otherWorkspace })).status).toBe(403);
    expect((await request('GET', undefined, { headers: otherMember })).body.capabilities.canBind).toBe(false);
    expect((await request('PUT', { sourceRoot: source, expectedRevision: null }, { headers: otherMember })).status).toBe(403);
    expect((await request('PUT', { sourceRoot: source, expectedRevision: null }, { headers: owner })).status).toBe(200);
    updateProject(db, id, { metadata: { kind: 'prototype', sharedProjectPlaceholderAt: 1 } });
    expect((await request('PUT', { sourceRoot: source, expectedRevision: 1 }, { headers: owner })).status).toBe(409);
    expect((await request('GET', undefined, { headers: owner })).body.capabilities.canBind).toBe(false);
  });

  it('supports readable read-only directories and reports denied access without recreating anything', async () => {
    if (process.platform === 'win32' || process.getuid?.() === 0) return;
    await chmod(source, 0o500);
    expect((await bind()).status).toBe(200);
    await chmod(source, 0);
    expect((await request()).body).toMatchObject({ status: 'unavailable', reason: 'inaccessible_target' });
    await chmod(source, 0o700);
    expect((await request()).body.status).toBe('connected');
  });

  it('rejects untrusted body fields without modifying metadata or connection', async () => {
    const before = getProject(db, id);
    for (const extra of [{ projectId: 'project-b' }, { schemaVersion: 2 }, { fromTrustedPicker: true }, { sourceIdentity: 'fake' }]) {
      expect((await request('PUT', { sourceRoot: source, expectedRevision: null, ...extra })).status).toBe(400);
    }
    expect(getProject(db, id)).toEqual(before);
    expect(getCodebaseBinding(db, id)).toBeNull();
  });
});
