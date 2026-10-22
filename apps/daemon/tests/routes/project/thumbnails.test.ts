import express, { type Response } from 'express';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerProjectThumbnailRoutes, type RegisterProjectThumbnailRoutesDeps } from '../../../src/routes/project/thumbnails.js';

const roots: string[] = [];
const servers: Server[] = [];
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))));
  await Promise.all(roots.splice(0).map(root => rm(root, { force: true, recursive: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'od-thumbnail-http-')); roots.push(root);
  const projects = join(root, 'projects');
  await mkdir(join(projects, 'one'), { recursive: true });
  await writeFile(join(projects, 'one', 'index.html'), '<link rel="stylesheet" href="style.css"><h1>One</h1>');
  await writeFile(join(projects, 'one', 'style.css'), 'h1{color:red}');
  const render = vi.fn(async () => png);
  const authorize = vi.fn(async (_req, _res, _id, _options) => true);
  const project = { id: 'one', metadata: {} as Record<string, unknown> };
  const getProject = vi.fn((_db: unknown, id: string) => id === 'one' ? project : null);
  const app = express();
  registerProjectThumbnailRoutes(app, {
    db: {}, paths: { RUNTIME_DATA_DIR: root, PROJECTS_DIR: projects },
    http: { sendApiError: (res: Response, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } }) },
    projectStore: { getProject },
    liveArtifacts: {}, authorizeProjectRequest: authorize, renderProjectThumbnail: render,
  } as unknown as RegisterProjectThumbnailRoutesDeps);
  const server = await new Promise<Server>(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no test address');
  return { url: `http://127.0.0.1:${address.port}/api/projects/one/thumbnail?fileName=index.html`, render, authorize, project, projects, getProject };
}

describe('project thumbnail HTTP boundary', () => {
  it('shares captured bytes with GET/HEAD, validates ETags and refreshes after CSS edits', async () => {
    const { url, render, projects } = await fixture();
    const first = await fetch(url);
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toBe('private, no-cache');
    expect(first.headers.get('content-type')).toContain('image/png');
    const etag = first.headers.get('etag')!;
    await first.arrayBuffer();
    const unchanged = await fetch(url, { method: 'HEAD', headers: { 'if-none-match': etag } });
    expect(unchanged.status).toBe(304);
    expect(render).toHaveBeenCalledTimes(1);
    await writeFile(join(projects, 'one', 'style.css'), 'h1{color:blue}');
    const changed = await fetch(url, { headers: { 'if-none-match': etag } });
    expect(changed.status).toBe(200);
    expect(changed.headers.get('etag')).not.toBe(etag);
    expect(render).toHaveBeenCalledTimes(2);
    await changed.arrayBuffer();
  });

  it('checks project authority even for an already cached thumbnail', async () => {
    const { url, render, authorize, project } = await fixture();
    await (await fetch(url)).arrayBuffer();
    authorize.mockImplementation(async (_req, res) => { res.status(403).end(); return false; });
    expect((await fetch(url)).status).toBe(403);
    expect(render).toHaveBeenCalledTimes(1);
    authorize.mockResolvedValue(true);
    project.metadata.teamMirrorRevokedAt = Date.now();
    expect((await fetch(url)).status).toBe(404);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('rejects escaped/ambiguous source selection without rendering', async () => {
    const { url, render } = await fixture();
    expect((await fetch(url.replace('index.html', '..%2Fsecret.html'))).status).toBe(400);
    expect((await fetch(url + '&liveArtifactId=other')).status).toBe(400);
    expect(render).not.toHaveBeenCalled();
  });

  it('rechecks authority after capture instead of serving a revoked cached response', async () => {
    const { url, render, project } = await fixture();
    render.mockImplementationOnce(async () => { project.metadata.teamMirrorRevokedAt = Date.now(); return png; });
    expect((await fetch(url)).status).toBe(404);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('refuses a cover captured before a working-directory rebind', async () => {
    const { url, project, getProject } = await fixture();
    getProject.mockReturnValueOnce(project).mockReturnValue({ ...project, metadata: { baseDir: 'new-binding' } });
    expect((await fetch(url)).status).toBe(409);
  });
});
