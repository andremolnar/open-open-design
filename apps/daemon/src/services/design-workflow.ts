import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  DESIGN_WORKFLOW_LIMITS, DESIGN_WORKFLOW_VERSION,
  prepareDesignContextRequestSchema, getDesignWorkflowRequestSchema, getDesignAssetRequestSchema,
  checkpointDesignWorkflowRequestSchema, registerDesignArtifactRequestSchema, archiveDesignWorkflowRequestSchema,
  type PrepareDesignContextRequest, type GetDesignWorkflowRequest, type GetDesignAssetRequest,
  type CheckpointDesignWorkflowRequest, type RegisterDesignArtifactRequest, type ArchiveDesignWorkflowRequest, type DesignWorkflowContext,
  type DesignAssetResponse, type DesignGuidanceSection, type ProjectSourceContextResponse,
} from '@open-design/contracts';
import { captureResources, sha256, type DesignResourceRoot, type FrozenResource } from './design-workflow/resources.js';

export class DesignWorkflowError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 409) {
    super(message);
    this.name = 'DesignWorkflowError';
  }
}

export interface PreparedDesignGuidance {
  sections: Array<Omit<DesignGuidanceSection, 'sha256'>>;
  resourceRoots: DesignResourceRoot[];
  preflight: string[];
  critique: string[];
  adaptations: Array<{ original: string; host: string }>;
  warnings: string[];
}

export interface DesignWorkflowServiceDependencies {
  db: Database.Database;
  /** Must check the actual saved association, including its filesystem identity. */
  readSourceContext: (projectId: string) => Promise<ProjectSourceContextResponse>;
  prepareGuidance: (projectId: string, prompt: string) => Promise<PreparedDesignGuidance>;
  /** Only existing daemon-managed files; the service never reads a requested source path. */
  readManagedArtifact: (projectId: string, name: string) => Promise<{ bytes: Buffer; mimeType: string }>;
}

export interface DesignWorkflowService {
  prepare(request: PrepareDesignContextRequest): Promise<DesignWorkflowContext>;
  get(request: GetDesignWorkflowRequest): Promise<DesignWorkflowContext>;
  getAsset(request: GetDesignAssetRequest): Promise<DesignAssetResponse>;
  checkpoint(request: CheckpointDesignWorkflowRequest): Promise<DesignWorkflowContext>;
  registerArtifact(request: RegisterDesignArtifactRequest): Promise<DesignWorkflowContext>;
  archive(request: ArchiveDesignWorkflowRequest): Promise<DesignWorkflowContext>;
}

/** No eviction: silently forgetting replay keys would permit an old request to act again. */
export const DESIGN_WORKFLOW_STORAGE_LIMITS = {
  maxWorkflows: 32,
  maxReplayEntries: 32768,
  maxTombstones: 2048,
  maxReplayBytes: 64 * 1024 * 1024,
  maxContextBytes: 4 * 1024 * 1024,
  maxArtifacts: 128,
} as const;

type Identity = GetDesignWorkflowRequest;
type BindingIdentity = Pick<DesignWorkflowContext, 'projectId' | 'sourceRoot' | 'appRelativePath' | 'bindingRevision'>;
interface StoredWorkflow {
  context: DesignWorkflowContext;
  capabilities: PrepareDesignContextRequest['capabilities'];
  resources: FrozenResource[];
}
interface WorkflowRow { context_json: string; capabilities_json: string; resources_json?: string }
interface ReplayRow { payload_hash: string; response_json: string }
type ReplayAction = 'prepare' | 'checkpoint' | 'registerArtifact' | 'archive';

function fail(code: string, message: string, statusCode = 409): never {
  throw new DesignWorkflowError(code, message, statusCode);
}

/** Canonical serialization prevents object-key order from changing replay identity. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

function requireBinding(source: ProjectSourceContextResponse, expected: BindingIdentity): void {
  if (source.status !== 'ready' || !source.binding || source.projectId !== expected.projectId
    || source.bindingRevision !== expected.bindingRevision || source.binding.revision !== expected.bindingRevision
    || source.binding.sourceRoot !== expected.sourceRoot || source.binding.appRelativePath !== expected.appRelativePath) {
    fail('binding_changed', 'The exact source/package association is unavailable or changed. Reconnect and prepare a fresh context.');
  }
}

function requireActive(context: DesignWorkflowContext): void {
  if (context.phase === 'archived') fail('workflow_archived', 'This workflow was archived and its cached context was discarded. Start a new workflow with a new request ID.');
}

function requireContext(context: DesignWorkflowContext, contextRevision: string, expectedRevision?: number): void {
  if (context.contextRevision !== contextRevision) fail('stale_context', 'This context handle is stale. Get the current workflow context.');
  if (expectedRevision !== undefined && context.revision !== expectedRevision) fail('revision_conflict', 'The workflow revision changed. Get it again before updating.');
}

function nextRevision(context: DesignWorkflowContext): number {
  if (!Number.isSafeInteger(context.revision + 1)) fail('revision_capacity', 'The workflow revision limit was reached.', 413);
  return context.revision + 1;
}

function parse<T>(schema: { safeParse(input: unknown): { success: true; data: T } | { success: false } }, input: T): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) fail('invalid_request', 'The design workflow request does not match its contract.', 400);
  return parsed.data;
}

/** Local-only persistence. Deliberately not registered with project export or sync. */
export function createDesignWorkflowService(deps: DesignWorkflowServiceDependencies): DesignWorkflowService {
  const { db } = deps;
  db.exec(`
    CREATE TABLE IF NOT EXISTS local_design_workflows (
      workflow_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      host_session_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      context_json TEXT NOT NULL,
      capabilities_json TEXT NOT NULL,
      resources_json TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS local_design_workflows_scope ON local_design_workflows(project_id, host_session_id);
    CREATE TABLE IF NOT EXISTS local_design_workflow_replays (
      project_id TEXT NOT NULL,
      host_session_id TEXT NOT NULL,
      action TEXT NOT NULL,
      request_id TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      response_json TEXT NOT NULL,
      response_bytes INTEGER NOT NULL,
      PRIMARY KEY(project_id, host_session_id, action, request_id),
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
  `);

  // Fixed SQL templates only; retaining statements avoids repeated native prepare
  // work on chunk reads/checkpoints and keeps the cache bounded by this module.
  const statements = new Map<string, Database.Statement>();
  function statement(sql: string): Database.Statement {
    let result = statements.get(sql);
    if (!result) { result = db.prepare(sql); statements.set(sql, result); }
    return result;
  }

  function load(identity: Identity, includeResources = false): StoredWorkflow {
    const row = statement(`SELECT context_json, capabilities_json${includeResources ? ', resources_json' : ''} FROM local_design_workflows
      WHERE workflow_id = ? AND project_id = ? AND host_session_id = ?`)
      .get(identity.workflowId, identity.projectId, identity.hostSessionId) as WorkflowRow | undefined;
    if (!row) fail('workflow_not_found', 'No workflow exists for this exact project and host session.', 404);
    return { context: JSON.parse(row.context_json) as DesignWorkflowContext,
      capabilities: JSON.parse(row.capabilities_json) as StoredWorkflow['capabilities'],
      resources: JSON.parse(row.resources_json ?? '[]') as FrozenResource[] };
  }

  function replay(request: { projectId: string; hostSessionId: string; requestId: string }, action: ReplayAction,
    payload: string, source?: ProjectSourceContextResponse): DesignWorkflowContext | undefined {
    const row = statement(`SELECT payload_hash, response_json FROM local_design_workflow_replays
      WHERE project_id = ? AND host_session_id = ? AND action = ? AND request_id = ?`)
      .get(request.projectId, request.hostSessionId, action, request.requestId) as ReplayRow | undefined;
    if (!row) return undefined;
    if (row.payload_hash !== payload) fail('idempotency_conflict', 'This request ID was already used with a different payload.');
    const response = JSON.parse(row.response_json) as DesignWorkflowContext;
    const current = load(response).context;
    if (current.phase === 'archived') {
      if (action === 'archive') return current;
      requireActive(current);
    }
    if (source) requireBinding(source, current);
    requireContext(current, response.contextRevision);
    return response;
  }

  function persistReplay(request: { projectId: string; hostSessionId: string; requestId: string }, action: ReplayAction,
    payload: string, context: DesignWorkflowContext): void {
    const response = JSON.stringify(context);
    const bytes = Buffer.byteLength(response);
    const usage = statement('SELECT COUNT(*) AS count, COALESCE(SUM(response_bytes), 0) AS bytes FROM local_design_workflow_replays')
      .get() as { count: number; bytes: number };
    if (usage.count >= DESIGN_WORKFLOW_STORAGE_LIMITS.maxReplayEntries - (action === 'archive' ? 0 : DESIGN_WORKFLOW_STORAGE_LIMITS.maxWorkflows)
      || usage.bytes + bytes > DESIGN_WORKFLOW_STORAGE_LIMITS.maxReplayBytes - (action === 'archive' ? 0 : 1024 * 1024)) {
      fail('replay_capacity', 'Local workflow replay storage is full. No mutation was applied.', 413);
    }
    statement(`INSERT INTO local_design_workflow_replays
      (project_id, host_session_id, action, request_id, payload_hash, response_json, response_bytes) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(request.projectId, request.hostSessionId, action, request.requestId, payload, response, bytes);
  }

  function save(stored: StoredWorkflow, expectedRevision?: number, refreshResources = true): void {
    const context = JSON.stringify(stored.context);
    if (Buffer.byteLength(context) > DESIGN_WORKFLOW_STORAGE_LIMITS.maxContextBytes) fail('context_capacity', 'The workflow metadata budget was reached.', 413);
    if (expectedRevision === undefined) {
      const usage = statement("SELECT COUNT(*) AS count FROM local_design_workflows WHERE json_extract(context_json, '$.phase') <> 'archived'").get() as { count: number };
      if (usage.count >= DESIGN_WORKFLOW_STORAGE_LIMITS.maxWorkflows) fail('workflow_capacity', 'The local workflow capacity was reached.', 413);
      statement(`INSERT INTO local_design_workflows (workflow_id, project_id, host_session_id, revision, context_json, capabilities_json, resources_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(stored.context.workflowId, stored.context.projectId, stored.context.hostSessionId,
        stored.context.revision, context, JSON.stringify(stored.capabilities), JSON.stringify(stored.resources));
    } else if (!refreshResources) {
      const result = statement(`UPDATE local_design_workflows SET revision = ?, context_json = ?
        WHERE workflow_id = ? AND project_id = ? AND host_session_id = ? AND revision = ?`).run(stored.context.revision, context,
        stored.context.workflowId, stored.context.projectId, stored.context.hostSessionId, expectedRevision);
      if (result.changes !== 1) fail('revision_conflict', 'The workflow changed concurrently. Get it again before updating.');
    } else {
      const result = statement(`UPDATE local_design_workflows SET revision = ?, context_json = ?, capabilities_json = ?, resources_json = ?
        WHERE workflow_id = ? AND project_id = ? AND host_session_id = ? AND revision = ?`).run(stored.context.revision, context,
        JSON.stringify(stored.capabilities), JSON.stringify(stored.resources), stored.context.workflowId,
        stored.context.projectId, stored.context.hostSessionId, expectedRevision);
      if (result.changes !== 1) fail('revision_conflict', 'The workflow changed concurrently. Get it again before updating.');
    }
  }

  async function checkedLoad(identity: Identity, includeResources = false): Promise<StoredWorkflow> {
    const initial = load(identity);
    if (initial.context.phase === 'archived') return initial;
    const source = await deps.readSourceContext(identity.projectId);
    const stored = load(identity, includeResources);
    if (stored.context.phase !== 'archived') requireBinding(source, stored.context);
    return stored;
  }

  return {
    async prepare(input) {
      const request = parse<PrepareDesignContextRequest>(prepareDesignContextRequestSchema, input);
      const payload = sha256(canonical(request));
      const expected: BindingIdentity = { projectId: request.projectId, sourceRoot: request.sourceRoot,
        appRelativePath: request.appRelativePath, bindingRevision: request.expectedBindingRevision };
      const source = await deps.readSourceContext(request.projectId);
      requireBinding(source, expected);
      const previous = replay(request, 'prepare', payload, source);
      if (previous) return previous;
      if (request.workflowId) {
        const current = load({ ...request, workflowId: request.workflowId }).context;
        requireActive(current);
        requireBinding(source, current);
        if (current.revision !== request.expectedRevision) fail('revision_conflict', 'The workflow changed before refresh.');
      }
      const guidance = await deps.prepareGuidance(request.projectId, request.prompt);
      const sections = [...guidance.sections];
      if (source.evidence.length) sections.push({ id: 'frozen-source-context', title: 'Frozen source evidence (host repository rules remain authoritative)',
        authority: 'design_reference', content: source.evidence.map((item) => `${item.kind}: ${item.path}\n${item.content}`).join('\n\n') });
      const frozenGuidance = {
        guidance: sections.map((section) => ({ ...section, sha256: sha256(section.content) })),
        preflight: [...guidance.preflight], critique: [...guidance.critique],
        adaptations: guidance.adaptations.map((adaptation) => ({ ...adaptation })), warnings: [...guidance.warnings],
      };
      const guidanceBytes = Buffer.byteLength(JSON.stringify(frozenGuidance));
      if (guidanceBytes > DESIGN_WORKFLOW_LIMITS.maxGuidanceBytes) fail('guidance_capacity', 'Resolved guidance exceeds the bounded context budget.', 413);
      // Reserve a bounded diagnostic allowance so omitted resources never silently
      // consume bytes beyond the overall package budget.
      const diagnosticReserve = 128 * 1024;
      const captured = captureResources(guidance.resourceRoots, DESIGN_WORKFLOW_LIMITS.maxPackageBytes - guidanceBytes - diagnosticReserve);
      const after = await deps.readSourceContext(request.projectId);
      requireBinding(after, expected);
      return db.transaction(() => {
        const racedReplay = replay(request, 'prepare', payload, after);
        if (racedReplay) return racedReplay;
        const current = request.workflowId ? load({ ...request, workflowId: request.workflowId }).context : undefined;
        if (current) {
          requireActive(current);
          requireBinding(after, current);
          if (current.revision !== request.expectedRevision) fail('revision_conflict', 'The workflow changed during refresh.');
        }
        const resources = captured.resources.map((resource) => resource.manifest);
        const missingCapabilities: string[] = [];
        if (!request.capabilities.imageContent && resources.some((resource) => resource.representations.includes('image'))) missingCapabilities.push('imageContent');
        if (!request.capabilities.embeddedResources && resources.length) missingCapabilities.push('embeddedResources');
        const context: DesignWorkflowContext = {
          version: DESIGN_WORKFLOW_VERSION, executionOwner: 'host', projectId: request.projectId,
          workflowId: current?.workflowId ?? randomUUID(), hostSessionId: request.hostSessionId,
          revision: current ? nextRevision(current) : 1, contextRevision: '', bindingRevision: expected.bindingRevision,
          sourceRoot: expected.sourceRoot, appRelativePath: expected.appRelativePath, prompt: request.prompt,
          ...frozenGuidance, resources, missingCapabilities,
          warnings: [...frozenGuidance.warnings, ...captured.warnings, ...(source.truncated ? ['Source evidence was truncated by its read budget.'] : [])],
          truncated: captured.truncated || source.truncated,
          limits: { ...DESIGN_WORKFLOW_LIMITS }, phase: 'prepared', checkpoints: current?.checkpoints ?? [], artifacts: current?.artifacts ?? [],
        };
        if (Buffer.byteLength(JSON.stringify({ guidance: context.guidance, preflight: context.preflight, critique: context.critique,
          adaptations: context.adaptations, warnings: context.warnings })) > DESIGN_WORKFLOW_LIMITS.maxGuidanceBytes) {
          fail('guidance_capacity', 'Guidance and resource diagnostics exceed the bounded context budget.', 413);
        }
        context.contextRevision = sha256(canonical({ ...context, capabilities: request.capabilities }));
        const stored: StoredWorkflow = { context, capabilities: request.capabilities, resources: captured.resources };
        save(stored, current?.revision);
        persistReplay(request, 'prepare', payload, context);
        return context;
      }).immediate();
    },

    async get(input) {
      const request = parse<GetDesignWorkflowRequest>(getDesignWorkflowRequestSchema, input);
      return (await checkedLoad(request)).context;
    },

    async getAsset(input) {
      const request = parse<GetDesignAssetRequest>(getDesignAssetRequestSchema, input);
      const stored = await checkedLoad(request, true);
      requireActive(stored.context);
      requireContext(stored.context, request.contextRevision);
      const resource = stored.resources.find((item) => item.manifest.id === request.assetId);
      if (!resource) fail('asset_not_found', 'This asset does not belong to the frozen context.', 404);
      if (request.representation === 'image' && !stored.capabilities.imageContent) fail('capability_missing', 'The host must support imageContent to request image bytes.', 422);
      if (request.representation === 'original' && !stored.capabilities.embeddedResources) fail('capability_missing', 'The host must support embeddedResources to request original bytes.', 422);
      if (!resource.manifest.representations.includes(request.representation)) fail('representation_unsupported', 'This resource has no supported image representation; request its original bytes.', 422);
      const original = Buffer.from(resource.base64, 'base64');
      if (request.offset > original.length || (request.representation === 'image' && request.offset !== 0)) fail('invalid_asset_offset', 'The requested offset is outside this resource or is not supported for images.', 400);
      const bytes = request.representation === 'image' ? original : original.subarray(request.offset, request.offset + request.maxBytes);
      const nextOffset = request.offset + bytes.length < original.length ? request.offset + bytes.length : null;
      return { version: DESIGN_WORKFLOW_VERSION, projectId: request.projectId, workflowId: request.workflowId,
        contextRevision: request.contextRevision, resource: resource.manifest, representation: request.representation, base64: bytes.toString('base64'),
        offset: request.offset, totalBytes: original.length, nextOffset, chunkSha256: sha256(bytes) };
    },

    async checkpoint(input) {
      const request = parse<CheckpointDesignWorkflowRequest>(checkpointDesignWorkflowRequestSchema, input);
      const payload = sha256(canonical(request));
      const source = await deps.readSourceContext(request.projectId);
      return db.transaction(() => {
        const previous = replay(request, 'checkpoint', payload, source);
        if (previous) return previous;
        const stored = load(request);
        requireActive(stored.context);
        requireBinding(source, stored.context);
        requireContext(stored.context, request.contextRevision, request.expectedRevision);
        if (stored.context.checkpoints.length >= DESIGN_WORKFLOW_LIMITS.maxCheckpoints) fail('checkpoint_capacity', 'The workflow checkpoint budget was reached; existing history was retained.', 413);
        stored.context.revision = nextRevision(stored.context);
        stored.context.phase = request.phase;
        stored.context.checkpoints.push({ revision: stored.context.revision, contextRevision: stored.context.contextRevision, phase: request.phase, summary: request.summary, checks: request.checks });
        save(stored, request.expectedRevision, false);
        persistReplay(request, 'checkpoint', payload, stored.context);
        return stored.context;
      }).immediate();
    },

    async registerArtifact(input) {
      const request = parse<RegisterDesignArtifactRequest>(registerDesignArtifactRequestSchema, input);
      if (request.name.includes('\\') || request.name.startsWith('/') || request.name.split('/').some((part) => !part || part.startsWith('.') || /[\0-\x1f\x7f:]/.test(part))) {
        fail('invalid_artifact_name', 'Use the name of an existing daemon-managed artifact.', 400);
      }
      const payload = sha256(canonical(request));
      const source = await deps.readSourceContext(request.projectId);
      const previous = replay(request, 'registerArtifact', payload, source);
      if (previous) return previous;
      const before = load(request);
      requireActive(before.context);
      requireBinding(source, before.context);
      requireContext(before.context, request.contextRevision, request.expectedRevision);
      let artifact: Awaited<ReturnType<DesignWorkflowServiceDependencies['readManagedArtifact']>>;
      try {
        artifact = await deps.readManagedArtifact(request.projectId, request.name);
      } catch {
        fail('artifact_unavailable', 'Select an existing, safe, readable daemon-managed file of at most 2 MiB.', 422);
      }
      if (artifact.bytes.length > DESIGN_WORKFLOW_LIMITS.maxResourceBytes) fail('artifact_capacity', 'The managed artifact exceeds the 2 MiB verification budget.', 413);
      if (sha256(artifact.bytes) !== request.sha256) fail('artifact_digest_mismatch', 'The managed artifact bytes do not match the supplied SHA-256 digest.');
      const after = await deps.readSourceContext(request.projectId);
      requireBinding(after, before.context);
      return db.transaction(() => {
        const racedReplay = replay(request, 'registerArtifact', payload, after);
        if (racedReplay) return racedReplay;
        const stored = load(request);
        requireActive(stored.context);
        requireBinding(after, stored.context);
        requireContext(stored.context, request.contextRevision, request.expectedRevision);
        const existing = stored.context.artifacts.findIndex((item) => item.name === request.name);
        if (existing < 0 && stored.context.artifacts.length >= DESIGN_WORKFLOW_STORAGE_LIMITS.maxArtifacts) fail('artifact_capacity', 'The workflow artifact count budget was reached.', 413);
        const entry = { name: request.name, sha256: request.sha256, bytes: artifact.bytes.length, contextRevision: stored.context.contextRevision };
        if (existing < 0) stored.context.artifacts.push(entry);
        else stored.context.artifacts[existing] = entry;
        stored.context.revision = nextRevision(stored.context);
        save(stored, request.expectedRevision, false);
        persistReplay(request, 'registerArtifact', payload, stored.context);
        return stored.context;
      }).immediate();
    },

    async archive(input) {
      const request = parse<ArchiveDesignWorkflowRequest>(archiveDesignWorkflowRequestSchema, input);
      const payload = sha256(canonical(request));
      return db.transaction(() => {
        const previous = replay(request, 'archive', payload);
        if (previous) return previous;
        const stored = load(request);
        requireActive(stored.context);
        requireContext(stored.context, request.contextRevision, request.expectedRevision);
        const usage = statement("SELECT COUNT(*) AS count FROM local_design_workflows WHERE json_extract(context_json, '$.phase') = 'archived'").get() as { count: number };
        if (usage.count >= DESIGN_WORKFLOW_STORAGE_LIMITS.maxTombstones) fail('tombstone_capacity', 'Local archived workflow history is full; no cache was discarded.', 413);
        const old = stored.context;
        stored.context = { ...old, revision: nextRevision(old), phase: 'archived', prompt: '', guidance: [], resources: [],
          preflight: [], critique: [], adaptations: [], missingCapabilities: [], truncated: false, checkpoints: [], artifacts: [],
          warnings: [`Archived: cached guidance/resources, ${old.checkpoints.length} checkpoints and ${old.artifacts.length} artifact registrations were discarded. Source files and managed artifacts were not changed.`] };
        stored.resources = [];
        stored.capabilities = { imageContent: false, embeddedResources: false };
        save(stored, request.expectedRevision);
        // Preserve every payload hash and scope key. Only response bodies are
        // compacted; a retry of a pre-archive mutation can never recreate state.
        const tombstone = JSON.stringify({ projectId: old.projectId, workflowId: old.workflowId, hostSessionId: old.hostSessionId,
          contextRevision: old.contextRevision, phase: 'archived' });
        statement(`UPDATE local_design_workflow_replays SET response_json = ?, response_bytes = ?
          WHERE project_id = ? AND host_session_id = ? AND json_extract(response_json, '$.workflowId') = ?`)
          .run(tombstone, Buffer.byteLength(tombstone), old.projectId, old.hostSessionId, old.workflowId);
        persistReplay(request, 'archive', payload, stored.context);
        return stored.context;
      }).immediate();
    },
  };
}

export { readDesignWorkflowFile } from './design-workflow/resources.js';
