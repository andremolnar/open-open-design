import { once } from 'node:events';
import fs from 'node:fs/promises';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectContextDiscoveryResponse, WorkspaceDirectoryItem } from '@open-design/contracts';
import {
  closeDatabase, ensureWorkspaceProject, getProject, getWorkspaceProject,
  getWorkspaceProjectByProjectId, insertProject, openDatabase,
} from '../src/db.js';
import type { WorkspaceResourceAccessInput } from '../src/collab/workspace-resource-mutation.js';
import type { WorkspaceDirectoryFetchResult } from '../src/collab/vela-workspace-context.js';
import { sendApiError } from '../src/http/api-errors.js';
import { registerProjectContextDiscoveryRoutes, type RegisterProjectContextDiscoveryRoutesDeps } from '../src/routes/project/context-discovery.js';
import { validateCodebaseBinding } from '../src/services/codebase-binding.js';
import { createProjectContextDiscoveryAuthority } from '../src/services/project-context-discovery-authority.js';
import * as bindings from '../src/storage/codebase-binding.js';

let root: string;
let source: string;
let paths: { projectsRoot: string; runtimeDataRoot: string };
let db: ReturnType<typeof openDatabase>;
let server: Server | undefined;
let base: string;
let revoked: Set<string>;
let directory: WorkspaceDirectoryFetchResult;
let accountIdentity: string;
let fetchDirectory: ReturnType<typeof vi.fn<() => Promise<WorkspaceDirectoryFetchResult>>>;
let readProject: ReturnType<typeof vi.fn<(db: unknown, id: string) => ReturnType<typeof getProject>>>;
const personal: WorkspaceDirectoryItem = { workspaceId: 'personal', workspaceName: 'My Workspace',
  workspaceType: 'personal', workspaceMemberId: 'my-personal-member', role: 'owner', memberStatus: 'active', lifecycleState: 'active' };
const team: WorkspaceDirectoryItem = { workspaceId: 'team', workspaceName: 'Team Name',
  workspaceType: 'team', workspaceMemberId: 'my-team-member', role: 'member', memberStatus: 'active', lifecycleState: 'active' };

async function start(authoritative = true) {
  const authority = createProjectContextDiscoveryAuthority({
    db, getProject: readProject,
    getWorkspaceProject: (_db, workspaceId, id) => getWorkspaceProject(db, workspaceId, id) as WorkspaceResourceAccessInput | undefined,
    getWorkspaceProjectByProjectId: (_db, id) => getWorkspaceProjectByProjectId(db, id) as WorkspaceResourceAccessInput | undefined,
    isProjectRevoked: (id) => revoked.has(id),
    ...(authoritative ? { fetchWorkspaceDirectory: fetchDirectory, authorityIdentity: () => accountIdentity } : {}),
  });
  const app = express();
  app.use(express.json());
  registerProjectContextDiscoveryRoutes(app, {
    db, http: { sendApiError }, contextDiscovery: authority,
    paths: { PROJECTS_DIR: paths.projectsRoot, RUNTIME_DATA_DIR_CANONICAL: paths.runtimeDataRoot },
  } as unknown as RegisterProjectContextDiscoveryRoutesDeps);
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

async function addProject(id: string, workspace: WorkspaceDirectoryItem | null = personal,
  options: { creator?: string; state?: 'active' | 'deleted'; visibility?: 'personal' | 'team'; bind?: boolean } = {}) {
  insertProject(db, { id, name: `Label ${id}`, metadata: { kind: 'prototype' }, createdAt: 1, updatedAt: 2 });
  if (workspace) ensureWorkspaceProject(db, {
    workspaceId: workspace.workspaceId, projectId: id, visibility: options.visibility ?? workspace.workspaceType,
    resourceState: options.state ?? 'active', createdByWorkspaceMemberId: options.creator ?? workspace.workspaceMemberId,
  });
  const project = getProject(db, id)!;
  if (options.bind !== false) {
    bindings.saveCodebaseBinding(db, id, null,
      await validateCodebaseBinding(project, paths, { sourceRoot: source, appRelativePath: 'apps/web' }));
  }
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'od-discovery-routes-')));
  source = path.join(root, 'source');
  paths = { projectsRoot: path.join(root, 'runtime', 'projects'), runtimeDataRoot: path.join(root, 'runtime') };
  await mkdir(path.join(source, 'apps/web/components'), { recursive: true });
  await mkdir(paths.projectsRoot, { recursive: true });
  db = openDatabase(root, { dataDir: paths.runtimeDataRoot });
  revoked = new Set();
  directory = { ok: true, items: [personal, team] };
  accountIdentity = 'original-account';
  fetchDirectory = vi.fn(async () => directory);
  readProject = vi.fn((_db: unknown, id: string) => getProject(db, id));
});

afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
  }
  server = undefined;
  vi.restoreAllMocks();
  closeDatabase();
  await rm(root, { recursive: true, force: true });
});

async function discover(body: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  const response = await fetch(`${base}/api/projects/source-context/discover`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ cwd: path.join(source, 'apps/web/components'), ...body }),
  });
  return { status: response.status, body: await response.json() as ProjectContextDiscoveryResponse & { error?: { code: string; retryable?: boolean } } };
}

describe('authorized cwd discovery route', () => {
  it('finds Personal and Team matches using verified member IDs and labels, independent of UI focus', async () => {
    await addProject('personal-project');
    await addProject('team-project', team, { creator: 'someone-else' });
    await start();
    const result = await discover({}, { 'x-od-active-workspace-id': 'unrelated-ui-focus', 'x-od-workspace-type': 'personal' });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ status: 'needs_selection', reason: 'ambiguous', selected: null,
      coverage: { scope: 'authorized_projects', scanTruncated: false } });
    expect(result.body.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ projectId: 'personal-project', workspaceScope: { workspaceId: 'personal', workspaceMemberId: 'my-personal-member', workspaceName: 'My Workspace', workspaceType: 'personal' } }),
      expect.objectContaining({ projectId: 'team-project', workspaceScope: { workspaceId: 'team', workspaceMemberId: 'my-team-member', workspaceName: 'Team Name', workspaceType: 'team' } }),
    ]));
    expect(fetchDirectory).toHaveBeenCalledTimes(2);
  });

  it('excludes private creator mismatch, unknown/removed membership, revoked and deleted projects before metadata/source-binding reads', async () => {
    await addProject('allowed');
    await addProject('private-other', personal, { creator: 'someone-else' });
    await addProject('unknown', { ...team, workspaceId: 'unknown' });
    await addProject('removed', { ...team, workspaceId: 'removed' });
    await addProject('locked', { ...team, workspaceId: 'locked' });
    await addProject('revoked', team);
    await addProject('deleted', team, { state: 'deleted' });
    directory.items.push({ ...team, workspaceId: 'removed', memberStatus: 'removed' },
      { ...team, workspaceId: 'locked', lifecycleState: 'locked' });
    revoked.add('revoked');
    const readBinding = vi.spyOn(bindings, 'getCodebaseBinding');
    await start();
    const result = await discover();
    expect(result.body).toMatchObject({ status: 'ready', selected: { projectId: 'allowed' } });
    expect(new Set(readProject.mock.calls.map((call) => call[1]))).toEqual(new Set(['allowed']));
    expect(new Set(readBinding.mock.calls.map((call) => call[1]))).toEqual(new Set(['allowed']));
    expect(JSON.stringify(result.body)).not.toMatch(/private-other|unknown|removed|locked|revoked|deleted/);
  });

  it('verifies exact explicit scope and excludes unbound and other workspace projects', async () => {
    await addProject('personal-project');
    await addProject('team-project', team);
    await addProject('local', null);
    await start();
    const result = await discover({ workspaceId: 'team', workspaceMemberId: 'my-team-member' });
    expect(result.body).toMatchObject({ status: 'ready', selected: { projectId: 'team-project' }, coverage: { scope: 'explicit_workspace' } });
    expect(new Set(readProject.mock.calls.map((call) => call[1]))).toEqual(new Set(['team-project']));
    expect((await discover({ workspaceId: 'team', workspaceMemberId: 'wrong' })).status).toBe(403);
    directory.items = [{ ...team, memberStatus: 'removed' }];
    expect((await discover({ workspaceId: 'team', workspaceMemberId: 'my-team-member' })).status).toBe(403);
  });

  it('uses header scope only when complete and matching the body, without override or fallback', async () => {
    await addProject('team-project', team);
    await start();
    const headers = { 'x-od-workspace-id': 'team', 'x-od-workspace-member-id': 'my-team-member' };
    expect((await discover({}, headers)).body).toMatchObject({ selected: { projectId: 'team-project' }, coverage: { scope: 'explicit_workspace' } });
    expect((await discover({ workspaceId: 'team', workspaceMemberId: 'my-team-member' }, headers)).status).toBe(200);
    fetchDirectory.mockClear();
    expect((await discover({ workspaceId: 'personal', workspaceMemberId: 'my-personal-member' }, headers)).body.error?.code).toBe('WORKSPACE_CONTEXT_CONFLICT');
    expect((await discover({}, { 'x-od-workspace-id': 'team' })).status).toBe(400);
    expect(fetchDirectory).not.toHaveBeenCalled();
  });

  it('does not fall back on directory outage, unauthorized identity or thrown lookup', async () => {
    await addProject('team-project', team);
    await addProject('local', null);
    await start();
    directory = { ok: false, items: [] };
    expect((await discover()).body.error).toMatchObject({ code: 'WORKSPACE_AUTHORITY_UNAVAILABLE', retryable: true });
    directory = { ok: false, items: [], reason: 'unauthorized' };
    expect((await discover()).status).toBe(401);
    fetchDirectory.mockRejectedValueOnce(new Error('offline'));
    expect((await discover()).status).toBe(503);
    expect(readProject).not.toHaveBeenCalled();
  });

  it('limits local/dev discovery to truly unbound projects and rejects explicit scope without directory authority', async () => {
    await addProject('bound');
    await addProject('local', null);
    await start(false);
    const result = await discover();
    expect(result.body).toMatchObject({ status: 'ready', selected: { projectId: 'local', workspaceScope: null }, coverage: { scope: 'unbound_local' } });
    expect(new Set(readProject.mock.calls.map((call) => call[1]))).toEqual(new Set(['local']));
    expect((await discover({ workspaceId: 'personal', workspaceMemberId: 'my-personal-member' })).status).toBe(503);
    expect(fetchDirectory).not.toHaveBeenCalled();
  });

  it('hides denied explicit project IDs and does not use them to invent a scope', async () => {
    await addProject('private-other', personal, { creator: 'someone-else' });
    await start();
    const result = await discover({ projectId: 'private-other' });
    expect(result.body).toMatchObject({ status: 'needs_selection', reason: 'no_match', selected: null, candidates: [] });
    expect(readProject).not.toHaveBeenCalled();
  });

  it('marks bounded membership coverage incomplete and never selects a lone retained match', async () => {
    await addProject('allowed');
    directory.items.push(...Array.from({ length: 128 }, (_, index) => ({ ...team, workspaceId: `team-${index}` })));
    await start();
    expect((await discover()).body).toMatchObject({ status: 'needs_selection', reason: 'selection_incomplete', selected: null,
      truncated: true, candidates: [expect.objectContaining({ projectId: 'allowed' })], coverage: { scanTruncated: true } });
    expect((await discover({ workspaceId: 'personal', workspaceMemberId: 'my-personal-member' })).body.status).toBe('ready');
  });

  it('bounds catalog IDs at 2048 and requires selection when a retained single match is incomplete', async () => {
    await addProject('allowed');
    db.transaction(() => {
      for (let index = 0; index < 2_048; index += 1) insertProject(db, {
        id: `filler-${index}`, name: 'Filler', metadata: { kind: 'prototype' }, createdAt: 1, updatedAt: 1,
      });
    })();
    await start();
    const result = await discover();
    expect(result.body).toMatchObject({ status: 'needs_selection', reason: 'selection_incomplete', selected: null,
      truncated: true, coverage: { scanTruncated: true, scannedProjects: 2_048 } });
    expect(readProject).toHaveBeenCalledTimes(4_096);
    expect((await discover({ projectId: 'allowed' })).body.status).toBe('ready');
  });

  it.each([
    { ...personal, memberStatus: 'removed' as const },
    { ...personal, lifecycleState: 'locked' as const },
    { ...personal, workspaceMemberId: 'different-member' },
    { ...personal, workspaceType: 'team' as const },
  ])('rejects conflicting directory rows instead of selecting a favorable identity: %j', async (conflict) => {
    await addProject('allowed');
    directory.items.push(conflict);
    await start();
    expect((await discover()).status).toBe(503);
    expect((await discover({ workspaceId: 'personal', workspaceMemberId: 'my-personal-member' })).status).toBe(503);
    expect(readProject).not.toHaveBeenCalled();
  });

  it('fails closed on oversized raw directories rather than trusting a prefix that could hide conflicting rows', async () => {
    directory.items = Array.from({ length: 2_049 }, () => ({ ...personal }));
    await start();
    expect((await discover()).status).toBe(503);
    expect(readProject).not.toHaveBeenCalled();
  });

  it('deduplicates benign identical membership rows', async () => {
    await addProject('allowed');
    directory.items.push({ ...personal });
    await start();
    const result = await discover();
    expect(result.body.status).toBe('ready');
    expect(result.body.candidates).toHaveLength(1);
  });

  it('rechecks current local authority before any source binding is inspected after catalog collection yields', async () => {
    await addProject('a-first');
    await addProject('b-second');
    readProject.mockImplementation((_db, id) => {
      if (id === 'b-second') revoked.add('a-first');
      return getProject(db, id);
    });
    const readBinding = vi.spyOn(bindings, 'getCodebaseBinding');
    await start();
    const result = await discover();
    expect(result.status).toBe(503);
    expect(readBinding).not.toHaveBeenCalled();
    expect(JSON.stringify(result.body)).not.toContain('a-first');
  });

  it('does not disclose a candidate revoked during filesystem inspection', async () => {
    await addProject('allowed');
    const original = fs.lstat.bind(fs);
    vi.spyOn(fs, 'lstat').mockImplementationOnce((...args: Parameters<typeof fs.lstat>) => {
      revoked.add('allowed');
      return original(...args);
    });
    await start();
    const result = await discover();
    expect(result.status).toBe(503);
    expect(JSON.stringify(result.body)).not.toMatch(/Label allowed|apps.web|sourceRoot/);
  });

  it.each(['membership', 'rebind', 'delete', 'account', 'binding'] as const)(
    'fences %s changes during the final fresh membership lookup before releasing paths', async (change) => {
      await addProject('allowed');
      fetchDirectory.mockImplementation(async () => {
        if (fetchDirectory.mock.calls.length === 2) {
          if (change === 'membership') return { ok: true, items: [{ ...personal, memberStatus: 'removed' }, team] };
          if (change === 'rebind') db.prepare('UPDATE workspace_projects SET workspace_id = ? WHERE project_id = ?').run('unavailable-workspace', 'allowed');
          if (change === 'delete') db.prepare('UPDATE workspace_projects SET resource_state = ? WHERE project_id = ?').run('deleted', 'allowed');
          if (change === 'account') accountIdentity = 'other-account';
          if (change === 'binding') db.prepare('UPDATE project_codebase_bindings SET revision = revision + 1 WHERE project_id = ?').run('allowed');
        }
        return directory;
      });
      await start();
      const result = await discover();
      expect(result.status).toBe(503);
      expect(JSON.stringify(result.body)).not.toMatch(/Label allowed|apps.web|sourceRoot/);
    },
  );

  it('rejects an account switch while the initial membership fetch is pending', async () => {
    await addProject('allowed');
    fetchDirectory.mockImplementation(async () => {
      accountIdentity = 'different-account';
      return directory;
    });
    await start();
    expect((await discover()).status).toBe(503);
    expect(readProject).not.toHaveBeenCalled();
  });

  it.each([{ unexpected: true }, { workspaceId: 'team' }, { cwd: 3 }, { projectId: '' }])('strictly rejects malformed input before directory or project reads: %j', async (input) => {
    await start();
    expect((await discover(input)).status).toBe(400);
    expect(fetchDirectory).not.toHaveBeenCalled();
    expect(readProject).not.toHaveBeenCalled();
  });
});
