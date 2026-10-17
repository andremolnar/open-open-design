import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  ComfyConnectionInput,
  ComfyConnectionSummary,
  ComfyWorkflowDraft,
  ComfyWorkflowSummary,
} from '@open-design/contracts';
import { validateComfyWorkflowDraft } from './workflow.js';

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
  connectionId: string;
  graphJson: string;
  graphSha256: string;
  bindingsJson: string;
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
      connection_id TEXT NOT NULL REFERENCES comfy_connections(id) ON DELETE RESTRICT,
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
  `);
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
  if (input.token !== undefined && (typeof input.token !== 'string' || !input.token.trim())) {
    throw new Error('Bearer token must be a nonempty string when supplied');
  }
  const id = randomUUID();
  db.transaction(() => {
    db.prepare(`INSERT INTO comfy_connections (id, name, base_url, trusted_network, created_at)
      VALUES (?, ?, ?, ?, ?)`).run(id, validated.name, validated.baseUrl, Number(validated.trustedNetwork), Date.now());
    if (input.token) {
      db.prepare(`INSERT INTO comfy_connection_credentials (connection_id, bearer_token) VALUES (?, ?)`)
        .run(id, input.token);
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
  output_json AS outputJson, enabled, schema_checked_at AS schemaCheckedAt`;

function workflowSummary(row: WorkflowRow): ComfyWorkflowSummary {
  return {
    id: row.configId,
    version: row.version,
    name: row.name,
    connectionId: row.connectionId,
    graphSha256: row.graphSha256,
    enabled: row.enabled === 1,
    ...(row.schemaCheckedAt !== null ? { schemaCheckedAt: row.schemaCheckedAt } : {}),
  };
}

export function listComfyWorkflows(db: Database.Database): ComfyWorkflowSummary[] {
  return (db.prepare(`SELECT ${WORKFLOW_COLS} FROM comfy_workflow_versions ORDER BY name, config_id, version`)
    .all() as WorkflowRow[]).map(workflowSummary);
}

/** Each import creates an immutable, disabled version; schema validation is a later gate. */
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
  db.prepare(`INSERT INTO comfy_workflow_versions
    (config_id, version, name, connection_id, graph_json, graph_sha256,
      bindings_json, output_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(configId, version, draft.name, draft.connectionId, graphJson, graphSha256,
      JSON.stringify(draft.promptTargets), JSON.stringify(draft.output), Date.now());
}

/** A changed graph never rewrites a published or in-flight version. */
export function reviseComfyWorkflowDraft(
  db: Database.Database, configId: string, input: unknown,
): ComfyWorkflowSummary {
  const draft = validateComfyWorkflowDraft(input);
  const graphJson = JSON.stringify(draft.graph);
  const graphSha256 = createHash('sha256').update(graphJson).digest('hex');
  return db.transaction(() => {
    const previous = db.prepare(`SELECT version, connection_id AS connectionId
      FROM comfy_workflow_versions WHERE config_id = ? ORDER BY version DESC LIMIT 1`)
      .get(configId) as { version: number; connectionId: string } | undefined;
    if (!previous) throw new Error('Workflow not found');
    if (previous.connectionId !== draft.connectionId) {
      throw new Error('A workflow version cannot silently move to another server');
    }
    const version = previous.version + 1;
    insertWorkflowVersion(db, configId, version, draft, graphJson, graphSha256);
    return { id: configId, version, name: draft.name, connectionId: draft.connectionId,
      graphSha256, enabled: false };
  })();
}

/** Internal-only read; graph content may contain private prompts and server paths. */
export function getComfyWorkflowDraft(db: Database.Database, id: string, version: number): ComfyWorkflowDraft | null {
  const row = db.prepare(`SELECT ${WORKFLOW_COLS} FROM comfy_workflow_versions WHERE config_id = ? AND version = ?`)
    .get(id, version) as WorkflowRow | undefined;
  return row ? {
    name: row.name,
    connectionId: row.connectionId,
    graph: JSON.parse(row.graphJson),
    promptTargets: JSON.parse(row.bindingsJson),
    output: JSON.parse(row.outputJson),
  } : null;
}
