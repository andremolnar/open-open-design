import { createHash, randomUUID } from 'node:crypto';
import { chmod, cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { register } from 'prom-client';
import type {
  DesignAssetResponse, DesignResourceManifestEntry, DesignWorkflowContext, ProjectCodebaseBindingResponse,
} from '@open-design/contracts';
import type { StartServerResult } from '../src/server.js';
import { renderSlimCoreCharter } from '../src/prompts/core-slim.js';

const imageBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
  'base64',
);
const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');

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

/** Real composer + authorized HTTP + SQLite, without replacing service dependencies. */
it('freezes selected guidance and original assets, survives restart, refreshes and archives without a coding Run or source writes', async () => {
  const fixture = await realpath(await mkdtemp(path.join(os.tmpdir(), 'od-work-here-runtime-')));
  const source = path.join(fixture, 'source');
  const dataRoot = path.join(fixture, 'managed');
  const skillId = 'work-here-runtime-skill';
  const skillRoot = path.join(dataRoot, 'skills', skillId);
  const skillBody = 'OD_SELECTED_SKILL: Use the existing native BotanicalCard. Read references/spacing.md before implementation.';
  const sidefile = 'OD_SELECTED_SIDEFILE: Keep the 24px rhythm and preserve keyboard focus.';
  await mkdir(path.join(source, 'apps/web/src/components'), { recursive: true });
  await mkdir(path.join(skillRoot, 'references'), { recursive: true });
  await writeFile(path.join(skillRoot, 'SKILL.md'), `---\nname: ${skillId}\ndescription: Runtime fixture design guidance\n---\n\n${skillBody}\n`);
  await writeFile(path.join(skillRoot, 'references/spacing.md'), sidefile);
  await writeFile(path.join(source, 'package.json'), '{"name":"untouched-source","private":true}');
  await writeFile(path.join(source, 'apps/web/package.json'), '{"name":"untouched-app","dependencies":{"react":"18.3.1"}}');
  await writeFile(path.join(source, 'AGENTS.md'), 'OD_SOURCE_ROOT: Preserve native components and existing permissions.');
  await writeFile(path.join(source, 'apps/AGENTS.md'), 'OD_SOURCE_ANCESTOR: Keep the 24px spacing rule.');
  await writeFile(path.join(source, 'apps/web/AGENTS.md'), 'OD_SOURCE_PACKAGE: Use BotanicalCard rather than a standalone HTML page.');
  await writeFile(path.join(source, 'apps/web/src/components/BotanicalCard.tsx'),
    'export const BotanicalCard = () => <article>OD_SOURCE_COMPONENT</article>;');
  await writeFile(path.join(source, 'apps/web/src/tokens.css'), ':root { --brand-leaf: #147d64; }');
  await chmod(path.join(source, 'apps/web/src/tokens.css'), 0o444);
  await writeFile(path.join(source, '.hidden'), 'unchanged hidden source bytes');
  const sourceBefore = await sourceSnapshot(source);

  vi.stubEnv('OD_DATA_DIR', dataRoot);
  vi.stubEnv('OD_API_TOKEN', 'work-here-runtime-fixture-token');
  vi.stubEnv('OD_WORKSPACE_CONTEXT_SOURCE', undefined);
  vi.stubEnv('OPEN_DESIGN_VELA_TELEMETRY', 'off');
  // Server-owned paths are import-time constants. Each case owns a fresh data
  // root; only the explicit restart below reuses this case's SQLite database.
  register.clear();
  vi.resetModules();
  const { startServer, resetDesktopAuthForTests } = await import('../src/server.js');
  const { closeDatabase } = await import('../src/db.js');
  resetDesktopAuthForTests();
  let started: StartServerResult | undefined;
  let baseUrl = '';
  const headers = { 'content-type': 'application/json', authorization: 'Bearer work-here-runtime-fixture-token' };
  const realFetch = globalThis.fetch;
  const unexpectedEgress: string[] = [];
  const open = async () => {
    started = await startServer({ port: 0, returnServer: true }) as StartServerResult;
    baseUrl = started.url;
  };
  const close = async () => {
    if (!started) return;
    const current = started;
    started = undefined;
    await current.shutdown();
    current.server.closeAllConnections();
    if (current.server.listening) {
      await new Promise<void>((resolve, reject) => current.server.close((error) => error ? reject(error) : resolve()));
    }
    closeDatabase();
  };
  const json = async <T>(route: string, body?: unknown, method = body === undefined ? 'GET' : 'POST', status = 200): Promise<T> => {
    const response = await fetch(`${baseUrl}${route}`, { method, headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    expect(response.status, await response.clone().text()).toBe(status);
    return await response.json() as T;
  };
  try {
    await open();
    // Work-here preparation must not invoke a model/provider. All HTTP in the
    // exercised lifecycle is restricted to this actual loopback listener.
    vi.stubGlobal('fetch', async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.startsWith(`${baseUrl}/`)) return realFetch(input, init);
      unexpectedEgress.push(url);
      throw new Error(`Unexpected work-here fixture egress: ${url}`);
    });
    const design = await json<{ designSystem: { id: string } }>('/api/design-systems', {
      title: 'Work here runtime brand', status: 'published', artifactMode: 'agent-managed',
      body: '# Runtime brand\n\nOD_REGISTRY_BRAND: Use botanical colors.',
    }, 'POST', 201);
    const designId = design.designSystem.id;
    const workspace = await json<{ project: { id: string } }>(`/api/design-systems/${encodeURIComponent(designId)}/workspace`, {}, 'POST', 201);
    const designStorage = await json<ProjectCodebaseBindingResponse>(`/api/projects/${workspace.project.id}/codebase-binding`);
    const workspaceBody = '# Runtime brand\n\nOD_UNSYNCED_BRAND: Use the real reference at references/workspace-reference.png.';
    await mkdir(path.join(designStorage.designStoragePath, 'references'), { recursive: true });
    await writeFile(path.join(designStorage.designStoragePath, 'DESIGN.md'), workspaceBody);
    await writeFile(path.join(designStorage.designStoragePath, 'references/workspace-reference.png'), imageBytes);
    // This reference exists only in the editable mirror, not the registry.
    await expect(lstat(path.join(dataRoot, 'design-systems', designId.slice('user:'.length), 'references/workspace-reference.png')))
      .rejects.toMatchObject({ code: 'ENOENT' });

    const projectId = `work-here-runtime-${randomUUID()}`;
    await json('/api/projects', { id: projectId, name: 'Work here runtime fixture',
      skillId, designSystemId: designId, conversationMode: 'chat',
      metadata: { kind: 'other', skipDiscoveryBrief: true }, customInstructions: 'OD_PROJECT_RULE: Keep implementation host-owned.' });
    const bindingPath = `/api/projects/${projectId}/codebase-binding`;
    await json(bindingPath, { sourceRoot: source, appRelativePath: 'apps/web', expectedRevision: null }, 'PUT');
    const binding = await json<ProjectCodebaseBindingResponse>(bindingPath);
    expect(binding.status).toBe('connected');
    const form = new FormData();
    form.append('files', new Blob([new Uint8Array(imageBytes)], { type: 'image/png' }), 'project-reference.png');
    const upload = await fetch(`${baseUrl}/api/projects/${projectId}/upload`, {
      method: 'POST', headers: { authorization: headers.authorization }, body: form,
    });
    expect(upload.status, await upload.clone().text()).toBe(200);
    expect(await readFile(path.join(binding.designStoragePath, 'project-reference.png'))).toEqual(imageBytes);
    const runsBefore = await json<{ runs: unknown[] }>('/api/runs');
    expect(runsBefore.runs).toEqual([]);
    const workflowPath = `/api/projects/${projectId}/design-workflow`;
    const prepareRequest = { projectId, sourceRoot: source, appRelativePath: 'apps/web', expectedBindingRevision: 1,
      hostSessionId: 'existing-native-coding-session', requestId: 'prepare-1',
      prompt: 'Implement BotanicalCard here using the selected skill and reference image.',
      capabilities: { imageContent: true, embeddedResources: true } };
    const prepared = await json<DesignWorkflowContext>(`${workflowPath}/prepare`, prepareRequest);
    expect(prepared).toMatchObject({ projectId, executionOwner: 'host', sourceRoot: source, appRelativePath: 'apps/web',
      bindingRevision: 1, revision: 1, phase: 'prepared', missingCapabilities: [] });
    const identity = { projectId, workflowId: prepared.workflowId, hostSessionId: prepared.hostSessionId };
    expect(await json(`${workflowPath}/prepare`, prepareRequest)).toEqual(prepared);
    const guidance = (id: string) => prepared.guidance.find((section) => section.id === id)?.content;
    expect(guidance('design-charter')).toBe(renderSlimCoreCharter('filesystem'));
    expect(guidance('design-system')).toBe(workspaceBody);
    expect(guidance('skill')?.trim().endsWith(skillBody)).toBe(true);
    expect(guidance('skill')).toContain('Known side files in this skill: `references/spacing.md`');
    expect(guidance('project-instructions')).toBe('OD_PROJECT_RULE: Keep implementation host-owned.');
    for (const marker of ['OD_SOURCE_ROOT', 'OD_SOURCE_ANCESTOR', 'OD_SOURCE_PACKAGE', 'OD_SOURCE_COMPONENT', '#147d64']) {
      expect(guidance('frozen-source-context')).toContain(marker);
    }
    for (const section of prepared.guidance) expect(section.sha256).toBe(sha256(section.content));
    expect(prepared.adaptations).toEqual(expect.arrayContaining([
      expect.objectContaining({ host: expect.stringContaining('No nested coding Run') }),
    ]));
    const resource = (name: string, role: DesignResourceManifestEntry['role']) => {
      const found = prepared.resources.find((entry) => entry.role === role && entry.name.endsWith(name));
      expect(found, `${role}: ${name}`).toBeDefined();
      return found!;
    };
    const projectImage = resource('/project-reference.png', 'project_asset');
    const designImage = resource('/references/workspace-reference.png', 'design_system');
    const skillSidefile = resource('/references/spacing.md', 'skill_sidefile');
    expect(skillSidefile).toMatchObject({ required: true, sha256: sha256(sidefile), bytes: Buffer.byteLength(sidefile) });
    expect(designImage.provenance).toContain(`design-system:${designId}:`);
    expect(projectImage.provenance).toBe(`project:${projectId}`);
    const assetRequest = (entry: DesignResourceManifestEntry) => ({ ...identity, contextRevision: prepared.contextRevision, assetId: entry.id });
    for (const entry of [projectImage, designImage]) {
      expect(entry).toMatchObject({ sha256: sha256(imageBytes), bytes: imageBytes.length, mimeType: 'image/png', transformed: false,
        representations: ['original', 'image'] });
      const image = await json<DesignAssetResponse>(`${workflowPath}/asset`, { ...assetRequest(entry), representation: 'image' });
      expect(Buffer.from(image.base64, 'base64')).toEqual(imageBytes);
      expect(image).toMatchObject({ resource: entry, representation: 'image', chunkSha256: sha256(imageBytes), nextOffset: null });
    }
    const chunks: Buffer[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const chunk: DesignAssetResponse = await json(`${workflowPath}/asset`, {
        ...assetRequest(projectImage), representation: 'original', offset, maxBytes: 17,
      });
      const bytes = Buffer.from(chunk.base64, 'base64');
      expect(chunk.offset).toBe(offset);
      expect(bytes.length).toBeLessThanOrEqual(17);
      expect(chunk.chunkSha256).toBe(sha256(bytes));
      expect(chunk.totalBytes).toBe(imageBytes.length);
      expect(chunk.nextOffset).toBe(offset + bytes.length === imageBytes.length ? null : offset + bytes.length);
      chunks.push(bytes);
      offset = chunk.nextOffset;
    }
    expect(chunks.length).toBeGreaterThan(1);
    expect(Buffer.concat(chunks)).toEqual(imageBytes);
    expect(sha256(Buffer.concat(chunks))).toBe(projectImage.sha256);
    const sidefileAsset = await json<DesignAssetResponse>(`${workflowPath}/asset`, { ...assetRequest(skillSidefile), representation: 'original' });
    expect(Buffer.from(sidefileAsset.base64, 'base64').toString('utf8')).toBe(sidefile);
    const checkpointRequest = { ...identity, contextRevision: prepared.contextRevision, expectedRevision: 1, requestId: 'checkpoint-1',
      phase: 'planning', summary: 'Read repository rules and fetched the original references.',
      checks: [{ name: 'source identity', status: 'passed' }, { name: 'visual critique', status: 'not_run' }] };
    const checkpoint = await json<DesignWorkflowContext>(`${workflowPath}/checkpoint`, checkpointRequest);
    expect(checkpoint).toMatchObject({ revision: 2, phase: 'planning', checkpoints: [{ revision: 2,
      contextRevision: prepared.contextRevision, phase: 'planning', checks: checkpointRequest.checks }] });
    await json('/api/active', { projectId: workspace.project.id });
    expect(await json(`${workflowPath}/get`, identity)).toEqual(checkpoint);
    expect(await json('/api/runs')).toEqual(runsBefore);
    expect(await sourceSnapshot(source)).toEqual(sourceBefore);

    await close();
    await open();
    expect(await json(`${workflowPath}/get`, identity)).toEqual(checkpoint);
    const restarted = await json<DesignAssetResponse>(`${workflowPath}/asset`, { ...assetRequest(designImage), representation: 'image' });
    expect(Buffer.from(restarted.base64, 'base64')).toEqual(imageBytes);
    expect(await json(`${workflowPath}/checkpoint`, checkpointRequest)).toEqual(checkpoint);
    const updatedSidefile = `${sidefile}\nOD_REFRESHED_SIDEFILE: Add an explicit empty state.`;
    await writeFile(path.join(skillRoot, 'references/spacing.md'), updatedSidefile);
    // Existing context still serves its frozen original before explicit refresh.
    const frozen = await json<DesignAssetResponse>(`${workflowPath}/asset`, assetRequest(skillSidefile));
    expect(Buffer.from(frozen.base64, 'base64').toString('utf8')).toBe(sidefile);
    const refreshed = await json<DesignWorkflowContext>(`${workflowPath}/prepare`, {
      ...prepareRequest, workflowId: prepared.workflowId, expectedRevision: checkpoint.revision, requestId: 'prepare-refresh-1',
    });
    expect(refreshed).toMatchObject({ workflowId: prepared.workflowId, revision: 3, phase: 'prepared', checkpoints: checkpoint.checkpoints });
    expect(refreshed.contextRevision).not.toBe(prepared.contextRevision);
    const stale = await json<{ error: { details: { reason: string } } }>(`${workflowPath}/asset`, assetRequest(skillSidefile), 'POST', 409);
    expect(stale.error.details.reason).toBe('stale_context');
    const updatedResource = refreshed.resources.find((entry) => entry.name === skillSidefile.name)!;
    expect(updatedResource.sha256).toBe(sha256(updatedSidefile));
    const refreshedAsset = await json<DesignAssetResponse>(`${workflowPath}/asset`, {
      ...identity, contextRevision: refreshed.contextRevision, assetId: updatedResource.id,
    });
    expect(Buffer.from(refreshedAsset.base64, 'base64').toString('utf8')).toBe(updatedSidefile);
    const archiveRequest = { ...identity, contextRevision: refreshed.contextRevision, expectedRevision: refreshed.revision,
      requestId: 'archive-1', confirm: true };
    const archived = await json<DesignWorkflowContext>(`${workflowPath}/archive`, archiveRequest);
    expect(archived).toMatchObject({ phase: 'archived', revision: 4, resources: [] });
    expect(await json(`${workflowPath}/archive`, archiveRequest)).toEqual(archived);
    expect(await json(`${workflowPath}/get`, identity)).toEqual(archived);
    const discarded = await json<{ error: { details: { reason: string } } }>(`${workflowPath}/asset`, {
      ...identity, contextRevision: refreshed.contextRevision, assetId: updatedResource.id,
    }, 'POST', 409);
    expect(discarded.error.details.reason).toBe('workflow_archived');
    expect(await json('/api/runs')).toEqual(runsBefore);
    expect(unexpectedEgress).toEqual([]);
    expect(await sourceSnapshot(source)).toEqual(sourceBefore);
    expect(await readFile(path.join(binding.designStoragePath, 'project-reference.png'))).toEqual(imageBytes);
    expect(await readFile(path.join(designStorage.designStoragePath, 'references/workspace-reference.png'))).toEqual(imageBytes);
  } finally {
    await close();
    resetDesktopAuthForTests();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
    await rm(fixture, { recursive: true, force: true });
  }
}, 60_000);


it('reads the actual pinned bundled OD Next recipe and fails closed on package or required-atom drift', async () => {
  // Packaged resource roots must live below the repository/app resources boundary.
  const tempRoot = path.resolve(import.meta.dirname, '../../../.tmp');
  await mkdir(tempRoot, { recursive: true });
  const fixture = await realpath(await mkdtemp(path.join(tempRoot, 'od-work-here-strategy-runtime-')));
  const dataRoot = path.join(fixture, 'managed');
  const source = path.join(fixture, 'source');
  const resourceRoot = path.join(fixture, 'resources');
  const bundledRoot = path.join(resourceRoot, 'plugins/_official');
  const repositoryBundledRoot = path.resolve(import.meta.dirname, '../../../plugins/_official');
  const strategyFolder = path.join(bundledRoot, 'scenarios/od-next-strategy');
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, 'AGENTS.md'), 'OD_STRATEGY_SOURCE: Use the current host and native components.');
  await writeFile(path.join(source, 'package.json'), '{"name":"strategy-source","private":true}');
  const sourceBefore = await sourceSnapshot(source);
  // Copy canonical shipped content, never substitute a hand-authored recipe.
  // Package/atom mutations below affect only this disposable packaged root.
  await cp(path.join(repositoryBundledRoot, 'scenarios/od-next-strategy'), strategyFolder, { recursive: true });
  for (const atom of ['discovery-question-form', 'direction-picker', 'todo-write']) {
    await cp(path.join(repositoryBundledRoot, 'atoms', atom), path.join(bundledRoot, 'atoms', atom), { recursive: true });
  }
  vi.stubEnv('OD_DATA_DIR', dataRoot);
  vi.stubEnv('OD_RESOURCE_ROOT', resourceRoot);
  vi.stubEnv('OD_API_TOKEN', 'work-here-strategy-fixture-token');
  vi.stubEnv('OD_WORKSPACE_CONTEXT_SOURCE', undefined);
  vi.stubEnv('OPEN_DESIGN_VELA_TELEMETRY', 'off');
  register.clear();
  vi.resetModules();
  const { startServer, resetDesktopAuthForTests } = await import('../src/server.js');
  const { openDatabase, closeDatabase } = await import('../src/db.js');
  const { resolvePluginFolder } = await import('../src/plugins/registry.js');
  const { resolvePluginSnapshot } = await import('../src/plugins/resolve-snapshot.js');
  const { linkSnapshotToProject } = await import('../src/plugins/snapshots.js');
  resetDesktopAuthForTests();
  let started: StartServerResult | undefined;
  const realFetch = globalThis.fetch;
  const unexpectedEgress: string[] = [];
  const headers = { 'content-type': 'application/json', authorization: 'Bearer work-here-strategy-fixture-token' };
  try {
    started = await startServer({ port: 0, returnServer: true }) as StartServerResult;
    const baseUrl = started.url;
    vi.stubGlobal('fetch', async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.startsWith(`${baseUrl}/`)) return realFetch(input, init);
      unexpectedEgress.push(url);
      throw new Error(`Unexpected strategy work-here fixture egress: ${url}`);
    });
    const json = async <T>(route: string, body?: unknown, method = body === undefined ? 'GET' : 'POST', status = 200): Promise<T> => {
      const response = await fetch(`${baseUrl}${route}`, { method, headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      expect(response.status, await response.clone().text()).toBe(status);
      return await response.json() as T;
    };
    const projectId = `work-here-strategy-${randomUUID()}`;
    await json('/api/projects', { id: projectId, name: 'Pinned strategy fixture', conversationMode: 'chat',
      metadata: { kind: 'other', skipDiscoveryBrief: true } });
    await json(`/api/projects/${projectId}/codebase-binding`, { sourceRoot: source, appRelativePath: '.', expectedRevision: null }, 'PUT');
    const runsBefore = await json<{ runs: unknown[] }>('/api/runs');
    expect(runsBefore.runs).toEqual([]);
    const resolved = await resolvePluginFolder({ folder: strategyFolder, folderId: 'od-next-strategy',
      sourceKind: 'bundled', source: strategyFolder, trust: 'bundled' });
    if (!resolved.ok) throw new Error(resolved.errors.join('; '));
    // Seed a genuine previously selected snapshot through the production
    // resolver and persistence boundary, not a mocked composer/service.
    const db = openDatabase(path.resolve(import.meta.dirname, '../../..'), { dataDir: dataRoot });
    const pinned = resolvePluginSnapshot({ db, projectId, body: { pluginId: 'od-next-strategy' },
      registry: { skills: [], designSystems: [], craft: [], atoms: [], scenarios: [] },
      internalStrategyActivation: { taskType: 'prototype', plugin: resolved.record } });
    if (!pinned?.ok) throw new Error(`Could not pin real strategy: ${JSON.stringify(pinned)}`);
    expect(pinned.snapshot.strategy).toBeDefined();
    // Ordinary automatic strategy activation is Run-scoped. This fixture
    // specifically witnesses consumption of an already project-pinned snapshot.
    linkSnapshotToProject(db, pinned.snapshotId, projectId);
    const workflowPath = `/api/projects/${projectId}/design-workflow`;
    const prepareRequest = { projectId, sourceRoot: source, appRelativePath: '.', expectedBindingRevision: 1,
      hostSessionId: 'native-strategy-session', requestId: 'strategy-prepare-1', prompt: 'Implement in this current repository.',
      capabilities: { imageContent: true, embeddedResources: true } };
    const prepared = await json<DesignWorkflowContext>(`${workflowPath}/prepare`, prepareRequest);
    expect(prepared.executionOwner).toBe('host');
    expect(prepared.guidance.some((section) => section.id === 'design-charter')).toBe(false);
    const section = (id: string) => prepared.guidance.find((item) => item.id === id);
    expect(JSON.parse(section('strategy-identity')!.content)).toMatchObject({
      strategyId: 'od-next-strategy', snapshotId: pinned.snapshotId,
      packageHash: pinned.snapshot.strategy!.packageHash, taskType: 'prototype',
      taskProfileDigest: pinned.snapshot.strategy!.selectedTaskProfile.sha256,
    });
    for (const [id, relative] of [
      ['strategy-core', 'assets/core-system-prompt.md'],
      ['strategy-orchestration', 'assets/general-orchestration.md'],
      ['strategy-task', 'assets/task-profiles/prototype.md'],
    ]) {
      expect(section(id!)?.content).toBe(await readFile(path.join(strategyFolder, relative!), 'utf8'));
    }
    const withoutFrontmatter = (body: string) => body.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim();
    const discoveryBody = withoutFrontmatter(await readFile(path.join(bundledRoot, 'atoms/discovery-question-form/SKILL.md'), 'utf8'));
    expect(section('strategy-stage-discovery')?.content).toBe(discoveryBody);
    for (const atom of ['direction-picker', 'todo-write']) {
      expect(section('strategy-stage-plan')?.content).toContain(withoutFrontmatter(await readFile(path.join(bundledRoot, 'atoms', atom, 'SKILL.md'), 'utf8')));
    }
    const layout = prepared.guidance.find((item) => item.title.endsWith('/prototype/layout.css'));
    expect(layout?.content).toBe(await readFile(path.join(strategyFolder, 'assets/task-profiles/prototype/layout.css'), 'utf8'));
    expect(section('frozen-source-context')?.content).toContain('OD_STRATEGY_SOURCE');
    for (const item of prepared.guidance) {
      expect(item.sha256).toBe(sha256(item.content));
      if (item.id.startsWith('strategy-')) expect(item.authority).toBe('design_reference');
    }
    const identity = { projectId, workflowId: prepared.workflowId, hostSessionId: prepared.hostSessionId };
    const refresh = { ...prepareRequest, workflowId: prepared.workflowId, expectedRevision: prepared.revision };
    const corePath = path.join(strategyFolder, 'assets/core-system-prompt.md');
    const canonicalCore = await readFile(corePath, 'utf8');
    await writeFile(corePath, `${canonicalCore}\nChanged after snapshot selection.\n`);
    const packageDrift = await json<{ error: { code: string } }>(`${workflowPath}/prepare`, { ...refresh, requestId: 'package-drift-1' }, 'POST', 500);
    expect(packageDrift.error.code).toBe('INTERNAL_ERROR');
    expect(await json(`${workflowPath}/get`, identity)).toEqual(prepared);
    await writeFile(corePath, canonicalCore);
    await rm(path.join(bundledRoot, 'atoms/direction-picker/SKILL.md'));
    const atomDrift = await json<{ error: { code: string } }>(`${workflowPath}/prepare`, { ...refresh, requestId: 'atom-drift-1' }, 'POST', 500);
    expect(atomDrift.error.code).toBe('INTERNAL_ERROR');
    expect(await json(`${workflowPath}/get`, identity)).toEqual(prepared);
    expect(await json('/api/runs')).toEqual(runsBefore);
    expect(unexpectedEgress).toEqual([]);
    expect(await sourceSnapshot(source)).toEqual(sourceBefore);
  } finally {
    if (started) {
      await started.shutdown();
      started.server.closeAllConnections();
      if (started.server.listening) await new Promise<void>((resolve, reject) => started!.server.close((error) => error ? reject(error) : resolve()));
    }
    closeDatabase();
    resetDesktopAuthForTests();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
    await rm(fixture, { recursive: true, force: true });
  }
}, 60_000);
