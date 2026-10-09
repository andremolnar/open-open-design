import { once } from 'node:events';
import { mkdir, mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiErrorCode, ProjectSourceContextResponse } from '@open-design/contracts';
import {
  closeDatabase, ensureWorkspaceProject, getProject, getWorkspaceProject,
  getWorkspaceProjectByProjectId, insertProject, listProjects, openDatabase,
} from '../src/db.js';
import { createAuthorizeProjectRequest, enforceLocalProjectDataPlaneRequest } from '../src/collab/project-request-authority.js';
import type { WorkspaceResourceAccessInput } from '../src/collab/workspace-resource-mutation.js';
import { sendApiError } from '../src/http/api-errors.js';
import { registerProjectSourceContextRoutes, type RegisterProjectSourceContextRoutesDeps } from '../src/routes/project/source-context.js';
import { validateCodebaseBinding } from '../src/services/codebase-binding.js';
import * as contextService from '../src/services/project-source-context.js';
import { saveCodebaseBinding } from '../src/storage/codebase-binding.js';

let root: string;
let source: string;
let paths: { projectsRoot: string; runtimeDataRoot: string };
let db: ReturnType<typeof openDatabase>;
let server: Server | undefined;
let base: string;
let revoked: Set<string>;
let listAuthorizedProjects: ReturnType<typeof vi.fn>;
const headers = { 'x-od-workspace-id': 'workspace-a', 'x-od-workspace-member-id': 'member-a' };

async function addProject(id: string, member = 'member-a', bind = true) {
  insertProject(db, { id, name: 'Same name', metadata: { kind: 'prototype' }, createdAt: 1, updatedAt: 1 });
  const project = getProject(db, id)!;
  ensureWorkspaceProject(db, { workspaceId: 'workspace-a', projectId: id, visibility: 'personal', resourceState: 'active', createdByWorkspaceMemberId: member });
  if (bind) {
    const selection = await validateCodebaseBinding(project, paths, { sourceRoot: source, appRelativePath: 'apps/web' });
    saveCodebaseBinding(db, id, null, selection);
  }
  return project;
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'od-source-routes-')));
  source = path.join(root, 'source');
  paths = { projectsRoot: path.join(root, 'runtime', 'projects'), runtimeDataRoot: path.join(root, 'runtime') };
  await mkdir(path.join(source, 'apps/web/components'), { recursive: true });
  await mkdir(paths.projectsRoot, { recursive: true });
  await writeFile(path.join(source, 'AGENTS.md'), 'Use the existing design tokens.');
  await writeFile(path.join(source, 'apps/web/components/Button.tsx'), 'export const Button = () => <button>Save</button>;');
  db = openDatabase(root, { dataDir: paths.runtimeDataRoot });
  revoked = new Set();
  const authority = {
    db,
    getWorkspaceProject: (_db: unknown, workspaceId: string, projectId: string) => getWorkspaceProject(db, workspaceId, projectId) as WorkspaceResourceAccessInput | undefined,
    getWorkspaceProjectByProjectId: (_db: unknown, projectId: string) => getWorkspaceProjectByProjectId(db, projectId) as WorkspaceResourceAccessInput | undefined,
  };
  const authorizeProjectRequest = createAuthorizeProjectRequest({
    ...authority, isProjectRevoked: (_db, id) => revoked.has(id),
    sendApiError: (res, status, code, message, details) => sendApiError(res, status, code as ApiErrorCode, message, details),
  });
  listAuthorizedProjects = vi.fn(async (req) => {
    const allowed = [];
    for (const project of listProjects(db)) {
      if (!revoked.has(project.id) && await enforceLocalProjectDataPlaneRequest({
        ...authority, req, projectId: project.id, options: { mode: 'read' },
      })) allowed.push(project);
    }
    return allowed;
  });
  const app = express();
  app.use(express.json());
  registerProjectSourceContextRoutes(app, {
    db, http: { sendApiError }, projectStore: { getProject },
    paths: { PROJECTS_DIR: paths.projectsRoot, RUNTIME_DATA_DIR_CANONICAL: paths.runtimeDataRoot },
    authorizeProjectRequest, sourceContext: { listAuthorizedProjects },
  } as unknown as RegisterProjectSourceContextRoutesDeps);
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
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

async function resolveContext(extra: Record<string, unknown> = {}) {
  const response = await fetch(`${base}/api/projects/source-context/resolve`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ sourceRoot: source, appRelativePath: 'apps/web', ...extra }),
  });
  return { status: response.status, body: await response.json() as ProjectSourceContextResponse };
}

describe('authorized source context routes', () => {
  it('rejects direct and explicit reverse lookup before source reads or candidate discovery', async () => {
    await addProject('private-id', 'member-b');
    const read = vi.spyOn(contextService, 'readProjectSourceContext');
    const resolve = vi.spyOn(contextService, 'resolveProjectSourceContext');
    const response = await fetch(`${base}/api/projects/private-id/source-context`, { headers });
    expect(response.status).toBe(403);
    const reverse = await resolveContext({ projectId: 'private-id' });
    expect(reverse.status).toBe(403);
    expect(read).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
    expect(listAuthorizedProjects).not.toHaveBeenCalled();
  });

  it('reads source evidence through an explicitly authorized stable ID', async () => {
    await addProject('project-a');
    const response = await fetch(`${base}/api/projects/project-a/source-context?query=Button`, { headers });
    expect(response.status).toBe(200);
    const body = await response.json() as ProjectSourceContextResponse;
    expect(body).toMatchObject({ status: 'ready', projectId: 'project-a', bindingRevision: 1 });
    expect(body.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'AGENTS.md', content: 'Use the existing design tokens.' }),
      expect.objectContaining({ path: 'apps/web/components/Button.tsx' }),
    ]));
  });

  it('resolves uniquely among authorized projects without leaking denied or revoked matching siblings', async () => {
    await addProject('project-a');
    await addProject('hidden-id', 'member-b');
    await addProject('revoked-id');
    revoked.add('revoked-id');
    const resolve = vi.spyOn(contextService, 'resolveProjectSourceContext');
    const result = await resolveContext();
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ status: 'ready', projectId: 'project-a' });
    expect(resolve.mock.calls[0]![1].map((project) => project.id)).toEqual(['project-a']);
    expect(JSON.stringify(result.body)).not.toMatch(/hidden-id|revoked-id/);
  });

  it('requires selection for ambiguity and permits only an explicit matching ID to disambiguate', async () => {
    await addProject('project-a');
    await addProject('project-b');
    expect((await resolveContext()).body).toMatchObject({ status: 'needs_selection', reason: 'ambiguous', projectId: null, evidence: [] });
    expect((await resolveContext({ projectId: 'project-b' })).body).toMatchObject({ status: 'ready', projectId: 'project-b' });
  });

  it('returns missing and stale states without selecting an unrelated project', async () => {
    await addProject('project-a');
    expect((await resolveContext({ sourceRoot: path.join(root, 'unknown') })).body).toMatchObject({ status: 'needs_selection', reason: 'no_match', projectId: null });
    await rename(source, `${source}-moved`);
    const result = await resolveContext();
    expect(result.body.status).toBe('unavailable');
    expect(result.body.evidence).toEqual([]);
  });

  it.each([['array', 'query=a&query=b'], ['object', 'query%5Bkey%5D=value'], ['oversized', `query=${'x'.repeat(2001)}`]])('rejects %s relevance query before source reads', async (_kind, query) => {
    await addProject('project-a');
    const read = vi.spyOn(contextService, 'readProjectSourceContext');
    const response = await fetch(`${base}/api/projects/project-a/source-context?${query}`, { headers });
    expect(response.status).toBe(400);
    expect(read).not.toHaveBeenCalled();
  });
});
