import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import childProcess from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import {
  DESIGN_WORKFLOW_LIMITS, type DesignWorkflowContext, type PrepareDesignContextRequest,
  type ProjectSourceContextResponse, type GetDesignAssetRequest,
} from '@open-design/contracts';
import {
  createDesignWorkflowService, readDesignWorkflowFile, DESIGN_WORKFLOW_STORAGE_LIMITS,
  type PreparedDesignGuidance, type DesignWorkflowServiceDependencies,
} from '../../src/services/design-workflow.js';
import { RESOURCE_SCAN_LIMITS } from '../../src/services/design-workflow/resources.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6xkAAAAASUVORK5CYII=', 'base64');
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const cleanup: Array<() => void> = [];
afterEach(() => { vi.restoreAllMocks(); cleanup.splice(0).reverse().forEach((close) => close()); });

function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'od-design-workflow-')));
  const sourceRoot = path.join(root, 'source');
  const assets = path.join(root, 'assets');
  fs.mkdirSync(sourceRoot); fs.mkdirSync(assets);
  fs.writeFileSync(path.join(sourceRoot, 'AGENTS.md'), 'Follow native repository rules.');
  fs.writeFileSync(path.join(assets, 'hero.png'), png);
  fs.writeFileSync(path.join(assets, 'USAGE.md'), 'Use the original hero image.');
  const databasePath = path.join(root, 'local.sqlite');
  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON');
  db.exec("CREATE TABLE projects (id TEXT PRIMARY KEY); INSERT INTO projects VALUES ('project-a'), ('project-b')");
  cleanup.push(() => { if (db.open) db.close(); fs.rmSync(root, { recursive: true, force: true }); });
  let source: ProjectSourceContextResponse = {
    status: 'ready', projectId: 'project-a', bindingRevision: 1,
    binding: { schemaVersion: 1, revision: 1, sourceRoot, appRelativePath: '.', updatedAt: 1 },
    reason: null, message: null, evidence: [{ path: 'AGENTS.md', kind: 'instruction', content: 'Follow native repository rules.' }],
    truncated: false, limits: { maxFiles: 32, maxFileBytes: 1024, maxTotalBytes: 4096 },
  };
  const guidance: PreparedDesignGuidance = {
    sections: [{ id: 'host', title: 'Execution ownership', authority: 'host_contract', content: 'The current host owns edits and tests.' }],
    resourceRoots: [{ root: assets, prefix: 'design/example', role: 'design_system', provenance: 'design-system:example' }],
    preflight: ['Read USAGE.md before implementation.'], critique: ['Inspect the result at narrow and wide sizes.'],
    adaptations: [{ original: 'OpenDesign Run', host: 'Current coding session' }], warnings: [],
  };
  const deps: DesignWorkflowServiceDependencies = {
    db,
    readSourceContext: vi.fn(async (projectId) => ({ ...source, projectId })),
    prepareGuidance: vi.fn(async () => guidance),
    readManagedArtifact: vi.fn(async () => ({ bytes: Buffer.from('<h1>Preview</h1>'), mimeType: 'text/html' })),
  };
  const request: PrepareDesignContextRequest = { projectId: 'project-a', sourceRoot, appRelativePath: '.', expectedBindingRevision: 1,
    hostSessionId: 'host-a', requestId: 'prepare-1', prompt: 'Polish the native application.', capabilities: { imageContent: true, embeddedResources: true } };
  return { root, sourceRoot, assets, databasePath, db, deps, guidance, request,
    service: createDesignWorkflowService(deps),
    changeBinding: (changes: Partial<NonNullable<ProjectSourceContextResponse['binding']>>) => {
      source = { ...source, binding: { ...source.binding!, ...changes }, bindingRevision: changes.revision ?? source.bindingRevision };
    },
    unavailable: () => { source = { ...source, status: 'unavailable', reason: 'missing_source' }; },
  };
}

function identity(context: DesignWorkflowContext) {
  return { projectId: context.projectId, workflowId: context.workflowId, hostSessionId: context.hostSessionId };
}
function assetRequest(context: DesignWorkflowContext, name: string, extra: Partial<GetDesignAssetRequest> = {}): GetDesignAssetRequest {
  const resource = context.resources.find((item) => item.name.endsWith(name));
  expect(resource).toBeDefined();
  return { ...identity(context), contextRevision: context.contextRevision, assetId: resource!.id, representation: 'original', offset: 0, maxBytes: 32768, ...extra };
}
function checkpointRequest(context: DesignWorkflowContext, requestId = 'checkpoint-1') {
  return { ...identity(context), contextRevision: context.contextRevision, expectedRevision: context.revision,
    requestId, phase: 'planning' as const, summary: 'Plan the native edits.', checks: [] };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

describe('host-owned design workflow persistence and bytes', () => {
  it('freezes actual PNG bytes and structured metadata, guidance and original resource handles', async () => {
    const f = fixture();
    const context = await f.service.prepare(f.request);
    expect(context).toMatchObject({ version: 1, executionOwner: 'host', revision: 1, bindingRevision: 1,
      sourceRoot: f.sourceRoot, appRelativePath: '.', phase: 'prepared', truncated: false, missingCapabilities: [] });
    expect(context.guidance[0]?.sha256).toBe(hash(f.guidance.sections[0]!.content));
    expect(context.guidance.find((section) => section.id === 'frozen-source-context')?.content).toContain('AGENTS.md');
    expect(context.preflight).toEqual(f.guidance.preflight);
    const usage = context.resources.find((resource) => resource.name.endsWith('USAGE.md'));
    expect(usage).toMatchObject({ required: true, mimeType: 'text/markdown', transformed: false });
    const image = await f.service.getAsset(assetRequest(context, 'hero.png', { representation: 'image' }));
    expect(Buffer.from(image.base64, 'base64')).toEqual(png);
    expect(image).toMatchObject({ representation: 'image', offset: 0, totalBytes: png.length, nextOffset: null, chunkSha256: hash(png),
      resource: { mimeType: 'image/png', sha256: hash(png), bytes: png.length, transformed: false, role: 'design_system', provenance: 'design-system:example' } });
    fs.writeFileSync(path.join(f.assets, 'hero.png'), 'changed after capture');
    expect(await f.service.getAsset(assetRequest(context, 'hero.png', { representation: 'image' }))).toEqual(image);
  });

  it('returns bounded original chunks that reconstruct identical image bytes', async () => {
    const f = fixture();
    const original = Buffer.concat([png, Buffer.alloc(90_000, 77)]);
    fs.writeFileSync(path.join(f.assets, 'large.png'), original);
    const context = await f.service.prepare(f.request);
    const parts: Buffer[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const response = await f.service.getAsset(assetRequest(context, 'large.png', { offset }));
      const part = Buffer.from(response.base64, 'base64');
      expect(part.length).toBeLessThanOrEqual(32768);
      expect(response.chunkSha256).toBe(hash(part));
      expect(response.resource.sha256).toBe(hash(original));
      expect(response.totalBytes).toBe(original.length);
      parts.push(part); offset = response.nextOffset;
    }
    expect(Buffer.concat(parts)).toEqual(original);
    expect(Buffer.from((await f.service.getAsset(assetRequest(context, 'large.png', { representation: 'image' }))).base64, 'base64')).toEqual(original);
    await expect(f.service.getAsset(assetRequest(context, 'large.png', { offset: original.length + 1 }))).rejects.toMatchObject({ code: 'invalid_asset_offset' });
    await expect(f.service.getAsset(assetRequest(context, 'large.png', { representation: 'image', offset: 1 }))).rejects.toMatchObject({ statusCode: 400 });
  });

  it('survives database reopen with byte handles, replay history and checkpoints intact', async () => {
    const f = fixture();
    const prepared = await f.service.prepare(f.request);
    const checkpoint = checkpointRequest(prepared);
    const updated = await f.service.checkpoint(checkpoint);
    f.db.close();
    const reopened = new Database(f.databasePath);
    cleanup.push(() => reopened.close());
    const service = createDesignWorkflowService({ ...f.deps, db: reopened });
    expect(await service.get(identity(prepared))).toEqual(updated);
    expect(await service.prepare(f.request)).toEqual(prepared);
    expect(await service.checkpoint(checkpoint)).toEqual(updated);
    expect(Buffer.from((await service.getAsset(assetRequest(prepared, 'hero.png'))).base64, 'base64')).toEqual(png);
  });

  it('replays exact session requests and conflicts on changed payloads', async () => {
    const f = fixture();
    const first = await f.service.prepare(f.request);
    expect(await f.service.prepare({ ...f.request, capabilities: { embeddedResources: true, imageContent: true } })).toEqual(first);
    expect(f.deps.prepareGuidance).toHaveBeenCalledTimes(1);
    await expect(f.service.prepare({ ...f.request, prompt: 'Changed intent' })).rejects.toMatchObject({ code: 'idempotency_conflict' });
    const next = await f.service.checkpoint(checkpointRequest(first));
    expect(await f.service.checkpoint(checkpointRequest(first))).toEqual(next);
    await expect(f.service.checkpoint({ ...checkpointRequest(first), summary: 'Changed summary' })).rejects.toMatchObject({ code: 'idempotency_conflict' });
    const otherSession = await f.service.prepare({ ...f.request, hostSessionId: 'host-b' });
    expect(otherSession.workflowId).not.toBe(first.workflowId);
  });

  it('isolates projects and host sessions without active-project fallback', async () => {
    const f = fixture();
    const context = await f.service.prepare(f.request);
    for (const mismatch of [{ projectId: 'project-b' }, { hostSessionId: 'host-b' }]) {
      await expect(f.service.get({ ...identity(context), ...mismatch })).rejects.toMatchObject({ code: 'workflow_not_found' });
      await expect(f.service.getAsset({ ...assetRequest(context, 'hero.png'), ...mismatch })).rejects.toMatchObject({ code: 'workflow_not_found' });
      await expect(f.service.checkpoint({ ...checkpointRequest(context), ...mismatch })).rejects.toMatchObject({ code: 'workflow_not_found' });
    }
  });
});

describe('binding and concurrency fences', () => {
  it('requires every exact source binding field and rechecks every operation', async () => {
    const f = fixture();
    for (const mismatch of [{ sourceRoot: `${f.sourceRoot}/..` }, { appRelativePath: 'other' }, { expectedBindingRevision: 2 }]) {
      await expect(f.service.prepare({ ...f.request, ...mismatch })).rejects.toMatchObject({ code: 'binding_changed' });
    }
    const context = await f.service.prepare(f.request);
    f.changeBinding({ revision: 2 });
    await expect(f.service.get(identity(context))).rejects.toMatchObject({ code: 'binding_changed' });
    await expect(f.service.getAsset(assetRequest(context, 'hero.png'))).rejects.toMatchObject({ code: 'binding_changed' });
    await expect(f.service.checkpoint(checkpointRequest(context))).rejects.toMatchObject({ code: 'binding_changed' });
    await expect(f.service.registerArtifact({ ...identity(context), contextRevision: context.contextRevision, expectedRevision: context.revision, requestId: 'artifact', name: 'preview.html', sha256: hash('preview') })).rejects.toMatchObject({ code: 'binding_changed' });
    await expect(f.service.prepare(f.request)).rejects.toMatchObject({ code: 'binding_changed' });
  });

  it('rejects rebinding during asynchronous context capture without persisting a workflow', async () => {
    const f = fixture();
    const entered = deferred<void>(); const release = deferred<PreparedDesignGuidance>();
    f.deps.prepareGuidance = async () => { entered.resolve(); return release.promise; };
    const service = createDesignWorkflowService(f.deps);
    const pending = service.prepare(f.request);
    await entered.promise;
    f.changeBinding({ revision: 2 }); release.resolve(f.guidance);
    await expect(pending).rejects.toMatchObject({ code: 'binding_changed' });
    expect(f.db.prepare('SELECT COUNT(*) AS count FROM local_design_workflows').get()).toEqual({ count: 0 });
  });

  it('refreshes the same workflow, invalidates old handles and fences stale mutation revisions', async () => {
    const f = fixture();
    const first = await f.service.prepare(f.request);
    const updated = await f.service.checkpoint(checkpointRequest(first));
    await expect(f.service.checkpoint({ ...checkpointRequest(first), requestId: 'stale' })).rejects.toMatchObject({ code: 'revision_conflict' });
    const refresh = { ...f.request, requestId: 'refresh', workflowId: first.workflowId, expectedRevision: updated.revision };
    const fresh = await f.service.prepare(refresh);
    expect(fresh.workflowId).toBe(first.workflowId);
    expect(fresh.revision).toBe(updated.revision + 1);
    expect(fresh.contextRevision).not.toBe(first.contextRevision);
    expect(fresh.checkpoints).toEqual(updated.checkpoints);
    expect(fresh.checkpoints[0]?.contextRevision).toBe(first.contextRevision);
    expect(fresh.resources.map((resource) => resource.id)).toEqual(first.resources.map((resource) => resource.id));
    expect(await f.service.prepare(refresh)).toEqual(fresh);
    await expect(f.service.getAsset(assetRequest(first, 'hero.png'))).rejects.toMatchObject({ code: 'stale_context' });
    await expect(f.service.checkpoint({ ...checkpointRequest(first), requestId: 'old-context' })).rejects.toMatchObject({ code: 'stale_context' });
    await expect(f.service.prepare(f.request)).rejects.toMatchObject({ code: 'stale_context' });
  });

  it('serializes simultaneous CAS mutations and deduplicates simultaneous prepares', async () => {
    const f = fixture();
    const [first, same] = await Promise.all([f.service.prepare(f.request), f.service.prepare(f.request)]);
    expect(same).toEqual(first);
    const results = await Promise.allSettled([
      f.service.checkpoint(checkpointRequest(first, 'concurrent-a')),
      f.service.checkpoint(checkpointRequest(first, 'concurrent-b')),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({ reason: { code: 'revision_conflict' } });
    expect((await f.service.get(identity(first))).checkpoints).toHaveLength(1);
  });

  it('validates managed artifact digest, replays registration, and catches rebinding during reads', async () => {
    const f = fixture(); const context = await f.service.prepare(f.request);
    const request = { ...identity(context), contextRevision: context.contextRevision, expectedRevision: context.revision,
      requestId: 'artifact-1', name: 'preview.html', sha256: hash('<h1>Preview</h1>') };
    await expect(f.service.registerArtifact({ ...request, sha256: '0'.repeat(64) })).rejects.toMatchObject({ code: 'artifact_digest_mismatch' });
    const registered = await f.service.registerArtifact(request);
    expect(registered.artifacts).toEqual([{ name: 'preview.html', sha256: request.sha256, bytes: 16, contextRevision: context.contextRevision }]);
    expect(await f.service.registerArtifact(request)).toEqual(registered);
    const beforeCalls = vi.mocked(f.deps.readManagedArtifact).mock.calls.length;
    await expect(f.service.registerArtifact({ ...request, requestId: 'traversal', name: '../private.txt' })).rejects.toMatchObject({ code: 'invalid_artifact_name' });
    expect(f.deps.readManagedArtifact).toHaveBeenCalledTimes(beforeCalls);
    const entered = deferred<void>(); const release = deferred<{ bytes: Buffer; mimeType: string }>();
    f.deps.readManagedArtifact = async () => { entered.resolve(); return release.promise; };
    const service = createDesignWorkflowService(f.deps);
    const pending = service.registerArtifact({ ...request, requestId: 'artifact-race', expectedRevision: registered.revision });
    await entered.promise; f.changeBinding({ revision: 2 }); release.resolve({ bytes: Buffer.from('<h1>Preview</h1>'), mimeType: 'text/html' });
    await expect(pending).rejects.toMatchObject({ code: 'binding_changed' });
    expect((JSON.parse((f.db.prepare('SELECT context_json FROM local_design_workflows').get() as { context_json: string }).context_json) as DesignWorkflowContext).revision).toBe(registered.revision);
  });
});

describe('explicit local cache archive', () => {
  it('discards only cached data, preserves replay hashes, and rejects old handles after restart', async () => {
    const f = fixture();
    const context = await f.service.prepare(f.request);
    const checkpoint = checkpointRequest(context);
    const updated = await f.service.checkpoint(checkpoint);
    const archive = { ...identity(updated), contextRevision: updated.contextRevision, expectedRevision: updated.revision, requestId: 'archive-1', confirm: true as const };
    const bytesBefore = (f.db.prepare('SELECT SUM(response_bytes) AS bytes FROM local_design_workflow_replays').get() as { bytes: number }).bytes;
    const archived = await f.service.archive(archive);
    expect(archived).toMatchObject({ phase: 'archived', revision: 3, guidance: [], resources: [], checkpoints: [], artifacts: [], prompt: '' });
    expect(await f.service.archive(archive)).toEqual(archived);
    expect(await f.service.get(identity(context))).toEqual(archived);
    expect(f.db.prepare('SELECT resources_json FROM local_design_workflows').get()).toEqual({ resources_json: '[]' });
    expect(f.db.prepare('SELECT COUNT(*) AS count FROM local_design_workflow_replays').get()).toEqual({ count: 3 });
    expect((f.db.prepare('SELECT SUM(response_bytes) AS bytes FROM local_design_workflow_replays').get() as { bytes: number }).bytes).toBeLessThan(bytesBefore);
    await expect(f.service.prepare(f.request)).rejects.toMatchObject({ code: 'workflow_archived' });
    await expect(f.service.prepare({ ...f.request, requestId: 'refresh-archived', workflowId: context.workflowId, expectedRevision: archived.revision })).rejects.toMatchObject({ code: 'workflow_archived' });
    await expect(f.service.checkpoint(checkpoint)).rejects.toMatchObject({ code: 'workflow_archived' });
    await expect(f.service.getAsset(assetRequest(context, 'hero.png'))).rejects.toMatchObject({ code: 'workflow_archived' });
    await expect(f.service.registerArtifact({ ...identity(context), contextRevision: context.contextRevision, expectedRevision: archived.revision, requestId: 'register-archived', name: 'preview.html', sha256: hash('preview') })).rejects.toMatchObject({ code: 'workflow_archived' });
    expect(fs.readFileSync(path.join(f.assets, 'hero.png'))).toEqual(png);
    expect(fs.readFileSync(path.join(f.sourceRoot, 'AGENTS.md'), 'utf8')).toBe('Follow native repository rules.');
    f.db.close(); const reopened = new Database(f.databasePath); cleanup.push(() => reopened.close());
    const service = createDesignWorkflowService({ ...f.deps, db: reopened });
    expect(await service.archive(archive)).toEqual(archived);
    await expect(service.prepare(f.request)).rejects.toMatchObject({ code: 'workflow_archived' });
  });

  it('requires explicit confirmation/CAS and archives stale bindings without reading source bytes', async () => {
    const f = fixture(); const context = await f.service.prepare(f.request);
    const request = { ...identity(context), contextRevision: context.contextRevision, expectedRevision: context.revision, requestId: 'archive', confirm: true as const };
    await expect(f.service.archive({ ...request, confirm: false } as never)).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(f.service.archive({ ...request, expectedRevision: 2 })).rejects.toMatchObject({ code: 'revision_conflict' });
    await expect(f.service.archive({ ...request, hostSessionId: 'host-b' })).rejects.toMatchObject({ code: 'workflow_not_found' });
    f.changeBinding({ revision: 2 }); f.unavailable();
    const calls = vi.mocked(f.deps.readSourceContext).mock.calls.length;
    expect((await f.service.archive(request)).phase).toBe('archived');
    expect((await f.service.get(identity(context))).phase).toBe('archived');
    expect(f.deps.readSourceContext).toHaveBeenCalledTimes(calls);
  });

  it('reclaims active capacity and cascades local cache/replay cleanup on project deletion', async () => {
    const f = fixture();
    for (let i = 0; i < DESIGN_WORKFLOW_STORAGE_LIMITS.maxWorkflows; i++) {
      const context = await f.service.prepare({ ...f.request, requestId: `archivable-${i}` });
      await f.service.archive({ ...identity(context), contextRevision: context.contextRevision, expectedRevision: context.revision, requestId: `archive-${i}`, confirm: true });
    }
    for (let i = 0; i < DESIGN_WORKFLOW_STORAGE_LIMITS.maxWorkflows; i++) await f.service.prepare({ ...f.request, requestId: `active-${i}` });
    await expect(f.service.prepare({ ...f.request, requestId: 'archivable-0' })).rejects.toMatchObject({ code: 'workflow_archived' });
    expect(f.db.prepare('SELECT COUNT(*) AS count FROM local_design_workflows').get()).toEqual({ count: DESIGN_WORKFLOW_STORAGE_LIMITS.maxWorkflows * 2 });
    f.db.prepare('DELETE FROM projects WHERE id = ?').run('project-a');
    expect(f.db.prepare('SELECT COUNT(*) AS count FROM local_design_workflows').get()).toEqual({ count: 0 });
    expect(f.db.prepare('SELECT COUNT(*) AS count FROM local_design_workflow_replays').get()).toEqual({ count: 0 });
  });
});

describe('resource safety, capabilities and bounded storage', () => {
  it('reports missing capabilities and checks actual image signatures rather than extensions', async () => {
    const f = fixture();
    fs.writeFileSync(path.join(f.assets, 'fake.png'), 'not an image');
    fs.writeFileSync(path.join(f.assets, 'real.txt'), png);
    fs.writeFileSync(path.join(f.assets, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const context = await f.service.prepare({ ...f.request, capabilities: { imageContent: false, embeddedResources: false } });
    expect(context.missingCapabilities).toEqual(['imageContent', 'embeddedResources']);
    expect(context.resources.some((resource) => resource.name.endsWith('fake.png'))).toBe(false);
    expect(context.resources.find((resource) => resource.name.endsWith('real.txt'))?.mimeType).toBe('image/png');
    expect(context.truncated).toBe(true);
    await expect(f.service.getAsset(assetRequest(context, 'hero.png', { representation: 'image' }))).rejects.toMatchObject({ code: 'capability_missing' });
    await expect(f.service.getAsset(assetRequest(context, 'hero.png'))).rejects.toMatchObject({ code: 'capability_missing' });
    const capable = await f.service.prepare({ ...f.request, requestId: 'capable' });
    await expect(f.service.getAsset(assetRequest(capable, 'logo.svg', { representation: 'image' }))).rejects.toMatchObject({ code: 'representation_unsupported' });
    expect(Buffer.from((await f.service.getAsset(assetRequest(capable, 'logo.svg'))).base64, 'base64').toString()).toContain('<svg');
  });

  it('rejects hidden, dependency, secret, symlink, hardlink and traversal resources visibly', async () => {
    const f = fixture();
    fs.writeFileSync(path.join(f.assets, '.env'), 'PRIVATE');
    fs.writeFileSync(path.join(f.assets, 'credentials.json'), 'PRIVATE');
    fs.mkdirSync(path.join(f.assets, 'node_modules')); fs.writeFileSync(path.join(f.assets, 'node_modules', 'README.md'), 'PRIVATE');
    fs.symlinkSync(f.sourceRoot, path.join(f.assets, 'linked-directory'));
    fs.symlinkSync(path.join(f.sourceRoot, 'AGENTS.md'), path.join(f.assets, 'linked.md'));
    fs.linkSync(path.join(f.sourceRoot, 'AGENTS.md'), path.join(f.assets, 'hardlink.md'));
    f.guidance.resourceRoots.push({ root: f.sourceRoot, prefix: '../escape', role: 'project_asset', provenance: 'bad' });
    const context = await f.service.prepare(f.request);
    expect(context.resources.map((resource) => resource.name)).toEqual(['design/example/USAGE.md', 'design/example/hero.png']);
    expect(context.truncated).toBe(true);
    expect(context.warnings.length).toBeGreaterThanOrEqual(6);
    await expect(readDesignWorkflowFile(f.assets, '../source/AGENTS.md')).rejects.toThrow();
    await expect(readDesignWorkflowFile(f.assets, 'linked.md')).rejects.toThrow();
    await expect(readDesignWorkflowFile(f.assets, 'hardlink.md')).rejects.toThrow();
    await expect(readDesignWorkflowFile(f.assets, 'credentials.json')).rejects.toThrow();
    expect(await readDesignWorkflowFile(f.assets, 'hero.png')).toEqual(png);
  });

  it('filters credential literals in benign filenames while preserving design-token files', async () => {
    const f = fixture();
    fs.writeFileSync(path.join(f.assets, 'config.json'), JSON.stringify({ api_key: 'an-actual-credential-value' }));
    fs.writeFileSync(path.join(f.assets, 'notes.md'), 'Authorization: Bearer abcdefghijklmnop');
    fs.writeFileSync(path.join(f.assets, 'certificate.txt'), '-----BEGIN PRIVATE KEY-----\nprivate');
    fs.writeFileSync(path.join(f.assets, 'tokens.css'), ':root { --color-primary: #123456; --space-1: 4px; }');
    const context = await f.service.prepare(f.request);
    expect(context.resources.some((resource) => /config.json|notes.md|certificate.txt/.test(resource.name))).toBe(false);
    expect(context.resources.some((resource) => resource.name.endsWith('tokens.css'))).toBe(true);
    expect(context.warnings.filter((warning) => warning.includes('credential-bearing'))).toHaveLength(3);
    expect(context.truncated).toBe(true);
  });

  it('allows hidden ancestors of a trusted root but excludes hidden children', async () => {
    const f = fixture();
    const root = path.join(f.root, '.managed', 'artifacts');
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'hero.png'), png);
    fs.writeFileSync(path.join(root, '.hidden.md'), 'private');
    f.guidance.resourceRoots = [{ ...f.guidance.resourceRoots[0]!, root }];
    const context = await f.service.prepare(f.request);
    expect(context.resources.map((resource) => resource.name)).toEqual(['design/example/hero.png']);
    expect(await readDesignWorkflowFile(root, 'hero.png')).toEqual(png);
    await expect(readDesignWorkflowFile(root, '.hidden.md')).rejects.toThrow();
  });

  it('rejects symlink components in trusted resource roots', async () => {
    const f = fixture();
    const alias = path.join(f.root, 'alias'); fs.symlinkSync(f.assets, alias);
    f.guidance.resourceRoots = [{ ...f.guidance.resourceRoots[0]!, root: alias }];
    const context = await f.service.prepare(f.request);
    expect(context.resources).toEqual([]); expect(context.truncated).toBe(true);
    await expect(readDesignWorkflowFile(alias, 'hero.png')).rejects.toThrow();
  });

  it('uses no-follow bounded reads and rejects a file changing during capture', async () => {
    const f = fixture();
    const open = vi.spyOn(fs, 'openSync');
    const originalRead = fs.readSync;
    let changed = false;
    vi.spyOn(fs, 'readSync').mockImplementation((...args: Parameters<typeof fs.readSync>) => {
      const count = originalRead(...args);
      if (!changed) { changed = true; fs.appendFileSync(path.join(f.assets, 'hero.png'), 'changed'); }
      return count;
    });
    await expect(readDesignWorkflowFile(f.assets, 'hero.png')).rejects.toThrow('changed');
    const flags = open.mock.calls.find(([name]) => name === path.join(f.assets, 'hero.png'))?.[1];
    expect(typeof flags).toBe('number');
    expect((flags as number) & fs.constants.O_NOFOLLOW).toBe(fs.constants.O_NOFOLLOW);
  });

  it('bounds directory entries even when every file is excluded', async () => {
    const f = fixture();
    fs.rmSync(f.assets, { recursive: true }); fs.mkdirSync(f.assets);
    for (let i = 0; i <= RESOURCE_SCAN_LIMITS.maxEntries; i++) fs.writeFileSync(path.join(f.assets, `.hidden-${i}.md`), 'private');
    const context = await f.service.prepare(f.request);
    expect(context.resources).toEqual([]);
    expect(context.truncated).toBe(true);
    expect(context.warnings).toHaveLength(RESOURCE_SCAN_LIMITS.maxWarnings);
    expect(context.warnings[0]).toContain('entry scan budget');
    expect(context.warnings.at(-1)).toContain('diagnostics were bounded');
  });

  it('reports production managed-file failures explicitly at the 2 MiB registration limit', async () => {
    const f = fixture(); const context = await f.service.prepare(f.request);
    const oversized = Buffer.alloc(DESIGN_WORKFLOW_LIMITS.maxResourceBytes + 1, 65);
    fs.writeFileSync(path.join(f.assets, 'oversized.html'), oversized);
    f.deps.readManagedArtifact = async (_projectId, name) => ({ bytes: await readDesignWorkflowFile(f.assets, name), mimeType: 'text/html' });
    const service = createDesignWorkflowService(f.deps);
    await expect(service.registerArtifact({ ...identity(context), contextRevision: context.contextRevision,
      expectedRevision: context.revision, requestId: 'oversized', name: 'oversized.html', sha256: hash(oversized) }))
      .rejects.toMatchObject({ code: 'artifact_unavailable', statusCode: 422, message: expect.stringContaining('2 MiB') });
    expect((await service.get(identity(context))).artifacts).toEqual([]);
  });

  it('bounds resource bytes, resource count and guidance without silent loss', async () => {
    const f = fixture();
    fs.writeFileSync(path.join(f.assets, 'too-large.txt'), Buffer.alloc(DESIGN_WORKFLOW_LIMITS.maxResourceBytes + 1, 65));
    for (let i = 0; i < DESIGN_WORKFLOW_LIMITS.maxResources; i++) fs.writeFileSync(path.join(f.assets, `file-${i}.txt`), 'a');
    const context = await f.service.prepare(f.request);
    expect(context.resources).toHaveLength(DESIGN_WORKFLOW_LIMITS.maxResources);
    expect(context.resources.some((resource) => resource.name.endsWith('too-large.txt'))).toBe(false);
    expect(context.truncated).toBe(true); expect(context.warnings.length).toBeGreaterThan(0);
    f.guidance.sections[0]!.content = 'A'.repeat(DESIGN_WORKFLOW_LIMITS.maxGuidanceBytes);
    await expect(f.service.prepare({ ...f.request, requestId: 'guidance-overflow' })).rejects.toMatchObject({ code: 'guidance_capacity' });
  });

  it('bounds aggregate package bytes and directory traversal work', async () => {
    const f = fixture();
    for (let i = 0; i < 9; i++) fs.writeFileSync(path.join(f.assets, `large-${i}.txt`), Buffer.alloc(DESIGN_WORKFLOW_LIMITS.maxResourceBytes, 65));
    let nested = f.assets;
    for (let i = 0; i <= RESOURCE_SCAN_LIMITS.maxDepth; i++) { nested = path.join(nested, 'nested'); fs.mkdirSync(nested); }
    fs.writeFileSync(path.join(nested, 'unreachable.md'), 'deep');
    const context = await f.service.prepare(f.request);
    expect(context.resources.reduce((total, resource) => total + resource.bytes, 0)).toBeLessThan(DESIGN_WORKFLOW_LIMITS.maxPackageBytes);
    expect(context.resources.some((resource) => resource.name.endsWith('unreachable.md'))).toBe(false);
    expect(context.truncated).toBe(true);
    expect(context.warnings.some((warning) => warning.includes('depth'))).toBe(true);
  });

  it('bounds persistent workflow count and rolls back mutations when replay storage is full', async () => {
    const f = fixture();
    const first = await f.service.prepare(f.request);
    for (let i = 1; i < DESIGN_WORKFLOW_STORAGE_LIMITS.maxWorkflows; i++) await f.service.prepare({ ...f.request, requestId: `prepare-${i + 1}` });
    await expect(f.service.prepare({ ...f.request, requestId: 'overflow' })).rejects.toMatchObject({ code: 'workflow_capacity' });
    f.db.prepare('UPDATE local_design_workflow_replays SET response_bytes = ? WHERE request_id = ?')
      .run(DESIGN_WORKFLOW_STORAGE_LIMITS.maxReplayBytes, f.request.requestId);
    await expect(f.service.checkpoint(checkpointRequest(first))).rejects.toMatchObject({ code: 'replay_capacity' });
    expect((await f.service.get(identity(first))).revision).toBe(1);
  });

  it('bounds checkpoints explicitly and does not mutate source or spawn processes', async () => {
    const f = fixture();
    const before = fs.readFileSync(path.join(f.sourceRoot, 'AGENTS.md'));
    const spawn = vi.spyOn(childProcess, 'spawn');
    const execFile = vi.spyOn(childProcess, 'execFile');
    let context = await f.service.prepare(f.request);
    for (let i = 0; i < DESIGN_WORKFLOW_LIMITS.maxCheckpoints; i++) context = await f.service.checkpoint(checkpointRequest(context, `checkpoint-${i}`));
    await expect(f.service.checkpoint(checkpointRequest(context, 'overflow'))).rejects.toMatchObject({ code: 'checkpoint_capacity' });
    expect(fs.readdirSync(f.sourceRoot)).toEqual(['AGENTS.md']);
    expect(fs.readFileSync(path.join(f.sourceRoot, 'AGENTS.md'))).toEqual(before);
    expect(spawn).not.toHaveBeenCalled(); expect(execFile).not.toHaveBeenCalled();
  });
});
