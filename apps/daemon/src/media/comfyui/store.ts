import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  ComfyConnectionInput,
  ComfyConnectionSummary,
  ComfyWorkflowDraft,
  ComfyWorkflowSummary,
  ComfyExecutionPhase,
  ComfyExecutionSummary,
  ComfyWorkflowInputs,
  ComfyLiteral,
  ComfyDiscovery,
} from '@open-design/contracts';
import { validateComfyWorkflowDraft } from './workflow.js';
import { comfyWorkflowModelId } from '@open-design/contracts';

type ConnectionRow = {
  id: string;
  name: string;
  baseUrl: string;
  trustedNetwork: number;
  hasToken: number;
};
type WorkflowRow = {
  configId: string;
  version: number;
  name: string;
  connectionId: string | null;
  graphJson: string;
  graphSha256: string;
  bindingsJson: string;
  parametersJson: string;
  outputJson: string;
  enabled: number;
  schemaCheckedAt: number | null;
};

export function migrateComfyWorkflows(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS comfy_connections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      trusted_network INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS comfy_connection_credentials (
      connection_id TEXT PRIMARY KEY REFERENCES comfy_connections(id) ON DELETE CASCADE,
      bearer_token TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS comfy_workflow_versions (
      config_id TEXT NOT NULL,
      version INTEGER NOT NULL CHECK(version > 0),
      name TEXT NOT NULL,
      connection_id TEXT REFERENCES comfy_connections(id) ON DELETE RESTRICT,
      graph_json TEXT NOT NULL,
      graph_sha256 TEXT NOT NULL,
      bindings_json TEXT NOT NULL,
      output_json TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0,
      schema_checked_at INTEGER,
      created_at INTEGER NOT NULL,
      PRIMARY KEY(config_id, version)
    );
    CREATE INDEX IF NOT EXISTS idx_comfy_workflows_connection
      ON comfy_workflow_versions(connection_id, config_id);
    CREATE TABLE IF NOT EXISTS comfy_media_executions (
      task_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      connection_id TEXT NOT NULL REFERENCES comfy_connections(id),
      model TEXT NOT NULL,
      phase TEXT NOT NULL,
      prompt_id TEXT,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS comfy_media_requests (
      request_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      task_id TEXT NOT NULL
    );
  `);
  const columns = db.prepare('PRAGMA table_info(comfy_workflow_versions)').all() as Array<{ name: string; notnull: number }>;
  if (!columns.some((column) => column.name === 'schema_fingerprint')) {
    db.exec('ALTER TABLE comfy_workflow_versions ADD COLUMN schema_fingerprint TEXT');
  }
  if (!columns.some((column) => column.name === 'parameters_json')) {
    db.exec("ALTER TABLE comfy_workflow_versions ADD COLUMN parameters_json TEXT NOT NULL DEFAULT '[]'");
  }
  // Retain every immutable graph/version and the old server as its preference.
  // Only the NOT NULL constraint changes; executions retain their original server.
  if (columns.find((column) => column.name === 'connection_id')?.notnull) {
    db.transaction(() => db.exec(`
      CREATE TABLE comfy_workflow_versions_reusable (
        config_id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version > 0), name TEXT NOT NULL,
        connection_id TEXT REFERENCES comfy_connections(id) ON DELETE RESTRICT,
        graph_json TEXT NOT NULL, graph_sha256 TEXT NOT NULL, bindings_json TEXT NOT NULL,
        output_json TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0, schema_checked_at INTEGER,
        created_at INTEGER NOT NULL, schema_fingerprint TEXT, parameters_json TEXT NOT NULL DEFAULT '[]',
        PRIMARY KEY(config_id, version)
      );
      INSERT INTO comfy_workflow_versions_reusable SELECT config_id, version, name, connection_id,
        graph_json, graph_sha256, bindings_json, output_json, enabled, schema_checked_at,
        created_at, schema_fingerprint, parameters_json FROM comfy_workflow_versions;
      DROP TABLE comfy_workflow_versions;
      ALTER TABLE comfy_workflow_versions_reusable RENAME TO comfy_workflow_versions;
      CREATE INDEX idx_comfy_workflows_connection ON comfy_workflow_versions(connection_id, config_id);
    `))();
  }
  const executionColumns = db.prepare('PRAGMA table_info(comfy_media_executions)').all() as Array<{ name: string }>;
  if (!executionColumns.some((column) => column.name === 'released_at')) {
    db.exec('ALTER TABLE comfy_media_executions ADD COLUMN released_at INTEGER');
  }
}

/** A browser/transport retry reuses a task, never makes a second /prompt attempt. */
export function claimComfyRequest(
  db: Database.Database, input: { requestId: string; projectId: string; model: string; prompt: string; taskId: string; runId?: string | undefined; workflowInputs?: ComfyWorkflowInputs; comfyServerId?: string },
): string {
  const payload: unknown[] = [input.projectId, input.model, input.prompt, input.runId ?? null];
  const values = Object.entries(input.workflowInputs ?? {}).sort(([a], [b]) => a.localeCompare(b));
  if (values.length) payload.push(values);
  if (input.comfyServerId !== undefined) payload.push({ comfyServerId: input.comfyServerId });
  const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return db.transaction(() => {
    const existing = db.prepare('SELECT project_id AS projectId, payload_hash AS hash, task_id AS taskId FROM comfy_media_requests WHERE request_id = ?')
      .get(input.requestId) as { projectId: string; hash: string; taskId: string } | undefined;
    if (existing) {
      if (existing.projectId !== input.projectId || existing.hash !== hash) throw new Error('ComfyUI request ID was already used for a different request');
      return existing.taskId;
    }
    db.prepare('INSERT INTO comfy_media_requests (request_id, project_id, payload_hash, task_id) VALUES (?, ?, ?, ?)')
      .run(input.requestId, input.projectId, hash, input.taskId);
    return input.taskId;
  })();
}

export function getComfyConnection(db: Database.Database, id: string): ComfyConnectionSummary | null {
  return listComfyConnections(db).find((connection) => connection.id === id) ?? null;
}

export function getComfyWorkflowSummary(db: Database.Database, id: string, version: number): ComfyWorkflowSummary | null {
  return listComfyWorkflows(db).find((workflow) => workflow.id === id && workflow.version === version) ?? null;
}

export function setComfyWorkflowValidation(
  db: Database.Database, id: string, version: number, fingerprint: string | null,
): void {
  db.prepare(`UPDATE comfy_workflow_versions SET schema_fingerprint = ?, schema_checked_at = ?
    WHERE config_id = ? AND version = ?`)
    .run(fingerprint, fingerprint ? Date.now() : null, id, version);
}

export function comfyWorkflowFingerprint(db: Database.Database, id: string, version: number): string | null {
  return (db.prepare(`SELECT schema_fingerprint AS fingerprint FROM comfy_workflow_versions
    WHERE config_id = ? AND version = ?`).get(id, version) as { fingerprint: string | null } | undefined)?.fingerprint ?? null;
}

export function setComfyWorkflowEnabled(db: Database.Database, id: string, version: number, enabled: boolean): void {
  db.transaction(() => {
    if (enabled) db.prepare('UPDATE comfy_workflow_versions SET enabled = 0 WHERE config_id = ?').run(id);
    db.prepare('UPDATE comfy_workflow_versions SET enabled = ? WHERE config_id = ? AND version = ?')
      .run(Number(enabled), id, version);
  })();
}

/** The record is saved before /prompt. Unresolved submissions continue occupying the connection. */
export function beginComfyExecution(
  db: Database.Database, input: { taskId: string; projectId: string; connectionId: string; model: string },
): void {
  db.transaction(() => {
    const occupied = db.prepare(`SELECT task_id FROM comfy_media_executions WHERE connection_id = ?
      AND phase NOT IN ('completed', 'failed') AND released_at IS NULL LIMIT 1`).get(input.connectionId);
    if (occupied) throw new Error('This server has an unfinished OpenDesign job. Check its recorded task before starting another.');
    db.prepare(`INSERT INTO comfy_media_executions (task_id, project_id, connection_id, model, phase, updated_at)
      VALUES (?, ?, ?, ?, 'validating', ?)`).run(input.taskId, input.projectId, input.connectionId, input.model, Date.now());
  })();
}

export function updateComfyExecution(db: Database.Database, taskId: string, phase: ComfyExecutionPhase, promptId?: string): void {
  db.prepare(`UPDATE comfy_media_executions SET phase = ?, prompt_id = COALESCE(?, prompt_id), updated_at = ? WHERE task_id = ?`)
    .run(phase, promptId ?? null, Date.now(), taskId);
}

export function getComfyExecution(db: Database.Database, taskId: string, projectId: string): ComfyExecutionSummary | null {
  const row = db.prepare(`SELECT task_id AS taskId, project_id AS projectId, connection_id AS connectionId, model, phase, prompt_id AS promptId, released_at AS releasedAt
    FROM comfy_media_executions WHERE task_id = ? AND project_id = ?`).get(taskId, projectId) as
    (ComfyExecutionSummary & { promptId: string | null }) | undefined;
  return row ? { taskId: row.taskId, projectId: row.projectId, model: row.model, connectionId: row.connectionId, phase: row.phase,
    ...(row.promptId ? { promptId: row.promptId } : {}), ...(row.releasedAt ? { releasedAt: row.releasedAt } : {}) } : null;
}

export function unresolvedComfyExecutions(db: Database.Database): ComfyExecutionSummary[] {
  const rows = db.prepare(`SELECT task_id AS taskId, project_id AS projectId FROM comfy_media_executions
    WHERE phase NOT IN ('completed', 'failed') AND released_at IS NULL ORDER BY updated_at DESC LIMIT 50`)
    .all() as Array<{ taskId: string; projectId: string }>;
  return rows.map(({ taskId, projectId }) => getComfyExecution(db, taskId, projectId)!);
}

/** Record an informed operator override without fabricating terminal remote evidence. */
export function releaseComfyOccupancy(db: Database.Database, taskId: string): void {
  const result = db.prepare('UPDATE comfy_media_executions SET released_at = ? WHERE task_id = ?').run(Date.now(), taskId);
  if (!result.changes) throw new Error('Recorded ComfyUI execution not found');
}

/**
 * Syntax policy, not a network trust proof. Before every outbound request the
 * client must resolve and pin DNS, apply the trusted-network policy to every
 * resolved address, and disable cross-origin redirects. No HTTP call exists in
 * this persistence layer.
 */
export function validateComfyConnection(input: ComfyConnectionInput): Omit<ComfyConnectionInput, 'token'> {
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 120) {
    throw new Error('Server name must be between 1 and 120 characters');
  }
  if (typeof input.baseUrl !== 'string' || input.baseUrl.length > 2048) {
    throw new Error('Enter a valid ComfyUI server URL');
  }
  let url: URL;
  try {
    url = new URL(input.baseUrl);
  } catch {
    throw new Error('Enter a valid ComfyUI server URL');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || url.search || url.hash || url.pathname !== '/' || !url.hostname) {
    throw new Error('ComfyUI URL must be an http(s) server origin without credentials, path or query');
  }
  if (typeof input.trustedNetwork !== 'boolean') {
    throw new Error('Choose whether to trust this server network');
  }
  if (url.protocol === 'http:' && !input.trustedNetwork) {
    throw new Error('Plain HTTP requires explicit trusted-network approval');
  }
  // These destinations are not ComfyUI hosts even on an approved LAN. Full
  // resolved-address enforcement belongs at the transport boundary as well.
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (hostname.startsWith('169.254.') || hostname.startsWith('fe80:')
    || hostname === 'metadata.google.internal' || hostname === '0.0.0.0') {
    throw new Error('Link-local and metadata endpoints are not permitted');
  }
  return { name: input.name.trim(), baseUrl: url.origin, trustedNetwork: input.trustedNetwork };
}

function connectionSummary(row: ConnectionRow): ComfyConnectionSummary {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.baseUrl,
    trustedNetwork: row.trustedNetwork === 1,
    hasToken: row.hasToken === 1,
  };
}

const CONNECTION_COLS = `c.id, c.name, c.base_url AS baseUrl,
  c.trusted_network AS trustedNetwork,
  EXISTS(SELECT 1 FROM comfy_connection_credentials s WHERE s.connection_id = c.id) AS hasToken`;

/** A read or list response cannot accidentally contain a stored bearer token. */
export function listComfyConnections(db: Database.Database): ComfyConnectionSummary[] {
  return (db.prepare(`SELECT ${CONNECTION_COLS} FROM comfy_connections c ORDER BY c.created_at, c.id`)
    .all() as ConnectionRow[]).map(connectionSummary);
}

export function addComfyConnection(db: Database.Database, input: ComfyConnectionInput): ComfyConnectionSummary {
  const validated = validateComfyConnection(input);
  if (input.token !== undefined && (typeof input.token !== 'string' || !input.token.trim()
    || input.token.length > 8192 || /[\r\n]/.test(input.token))) {
    throw new Error('Bearer token must be a nonempty string when supplied');
  }
  const id = randomUUID();
  db.transaction(() => {
    db.prepare(`INSERT INTO comfy_connections (id, name, base_url, trusted_network, created_at)
      VALUES (?, ?, ?, ?, ?)`).run(id, validated.name, validated.baseUrl, Number(validated.trustedNetwork), Date.now());
    if (input.token) {
      db.prepare(`INSERT INTO comfy_connection_credentials (connection_id, bearer_token) VALUES (?, ?)`)
        .run(id, input.token.trim());
    }
  })();
  return listComfyConnections(db).find((connection) => connection.id === id)!;
}

/** Used only by the daemon transport, never by a settings response. */
export function getComfyConnectionToken(db: Database.Database, id: string): string | null {
  const row = db.prepare(`SELECT bearer_token AS token FROM comfy_connection_credentials WHERE connection_id = ?`)
    .get(id) as { token: string } | undefined;
  return row?.token ?? null;
}

const WORKFLOW_COLS = `config_id AS configId, version, name, connection_id AS connectionId,
  graph_json AS graphJson, graph_sha256 AS graphSha256, bindings_json AS bindingsJson,
  parameters_json AS parametersJson, output_json AS outputJson, enabled, schema_checked_at AS schemaCheckedAt`;

function workflowSummary(row: WorkflowRow): ComfyWorkflowSummary {
  const draft = { graph: JSON.parse(row.graphJson), parameters: JSON.parse(row.parametersJson) } as ComfyWorkflowDraft;
  return {
    id: row.configId,
    version: row.version,
    name: row.name,
    ...(row.connectionId ? { connectionId: row.connectionId } : {}),
    graphSha256: row.graphSha256,
    enabled: row.enabled === 1,
    output: JSON.parse(row.outputJson),
    parameters: (draft.parameters ?? []).map((binding) => {
      const defaultValue = draft.graph[binding.nodeId]!.inputs[binding.input] as ComfyLiteral;
      return { name: binding.name, type: typeof defaultValue as 'string' | 'number' | 'boolean', defaultValue };
    }),
    ...(row.schemaCheckedAt !== null ? { schemaCheckedAt: row.schemaCheckedAt } : {}),
  };
}

export function listComfyWorkflows(db: Database.Database): ComfyWorkflowSummary[] {
  return (db.prepare(`SELECT ${WORKFLOW_COLS} FROM comfy_workflow_versions ORDER BY name, config_id, version`)
    .all() as WorkflowRow[]).map(workflowSummary);
}

/** Discovery is public capability metadata, not access to operator configuration. */
export function discoverComfy(db: Database.Database): ComfyDiscovery {
  return {
    servers: listComfyConnections(db).map(({ id, name }) => ({ id, name })),
    workflows: listComfyWorkflows(db).filter((workflow) => workflow.enabled).map((workflow) => ({
      id: workflow.id, version: workflow.version, name: workflow.name,
      model: comfyWorkflowModelId(workflow.id, workflow.version),
      ...(workflow.connectionId ? { preferredServerId: workflow.connectionId } : {}),
      inputs: (workflow.parameters ?? []).map(({ name, type }) => ({ name, type, required: true as const })),
    })),
  };
}

/** Each import creates an immutable, disabled version; server schemas are checked before submission. */
export function addComfyWorkflowDraft(db: Database.Database, input: unknown): ComfyWorkflowSummary {
  const draft = validateComfyWorkflowDraft(input);
  const graphJson = JSON.stringify(draft.graph);
  const graphSha256 = createHash('sha256').update(graphJson).digest('hex');
  const configId = randomUUID();
  insertWorkflowVersion(db, configId, 1, draft, graphJson, graphSha256);
  return listComfyWorkflows(db).find((workflow) => workflow.id === configId)!;
}

function insertWorkflowVersion(
  db: Database.Database, configId: string, version: number, draft: ComfyWorkflowDraft,
  graphJson: string, graphSha256: string,
): void {
  if (draft.connectionId && !getComfyConnection(db, draft.connectionId)) throw new Error('Preferred ComfyUI server was not found. Choose a saved server or leave the preference empty.');
  db.prepare(`INSERT INTO comfy_workflow_versions
    (config_id, version, name, connection_id, graph_json, graph_sha256,
      bindings_json, output_json, parameters_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(configId, version, draft.name, draft.connectionId ?? null, graphJson, graphSha256,
      JSON.stringify(draft.promptTargets), JSON.stringify(draft.output), JSON.stringify(draft.parameters ?? []), Date.now());
}

/** A changed graph never rewrites a published or in-flight version. */
export function reviseComfyWorkflowDraft(
  db: Database.Database, configId: string, input: unknown,
): ComfyWorkflowSummary {
  const draft = validateComfyWorkflowDraft(input);
  const graphJson = JSON.stringify(draft.graph);
  const graphSha256 = createHash('sha256').update(graphJson).digest('hex');
  return db.transaction(() => {
    const previous = db.prepare(`SELECT version
      FROM comfy_workflow_versions WHERE config_id = ? ORDER BY version DESC LIMIT 1`)
      .get(configId) as { version: number } | undefined;
    if (!previous) throw new Error('Workflow not found');
    const version = previous.version + 1;
    insertWorkflowVersion(db, configId, version, draft, graphJson, graphSha256);
    return getComfyWorkflowSummary(db, configId, version)!;
  })();
}

/** Daemon/operator-only read; graph content may contain private prompts and server paths. */
export function getComfyWorkflowDraft(db: Database.Database, id: string, version: number): ComfyWorkflowDraft | null {
  const row = db.prepare(`SELECT ${WORKFLOW_COLS} FROM comfy_workflow_versions WHERE config_id = ? AND version = ?`)
    .get(id, version) as WorkflowRow | undefined;
  return row ? {
    name: row.name,
    ...(row.connectionId ? { connectionId: row.connectionId } : {}),
    graph: JSON.parse(row.graphJson),
    promptTargets: JSON.parse(row.bindingsJson),
    parameters: JSON.parse(row.parametersJson),
    output: JSON.parse(row.outputJson),
  } : null;
}
