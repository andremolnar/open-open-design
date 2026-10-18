import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  addComfyConnection,
  addComfyWorkflowDraft,
  getComfyConnectionToken,
  getComfyWorkflowDraft,
  listComfyConnections,
  listComfyWorkflows,
  migrateComfyWorkflows,
  reviseComfyWorkflowDraft,
  validateComfyConnection,
  setComfyWorkflowEnabled,
  discoverComfy, beginComfyExecution, getComfyExecution,
} from '../../src/media/comfyui/store.js';

const databases: Database.Database[] = [];
function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateComfyWorkflows(db);
  databases.push(db);
  return db;
}
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

const graph = {
  '6': { class_type: 'CLIPTextEncode', inputs: { text: 'original' } },
  '9': { class_type: 'SaveImage', inputs: { images: ['6', 0] } },
};

describe('ComfyUI connection and workflow storage', () => {
  it('migrates legacy server-bound versions without changing graphs, credentials or in-flight server identity', () => {
    const db = freshDb();
    const { sql } = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'comfy_workflow_versions'").get() as { sql: string };
    db.exec('DROP TABLE comfy_workflow_versions');
    db.exec(sql.replace('connection_id TEXT REFERENCES', 'connection_id TEXT NOT NULL REFERENCES'));
    const server = addComfyConnection(db, { name: 'Existing', baseUrl: 'http://127.0.0.1:8188', trustedNetwork: true, token: 'old-secret' });
    const workflow = addComfyWorkflowDraft(db, { name: 'Existing workflow', connectionId: server.id, graph,
      promptTargets: [{ nodeId: '6', input: 'text' }], output: { nodeId: '9', index: 0 } });
    setComfyWorkflowEnabled(db, workflow.id, 1, true);
    beginComfyExecution(db, { taskId: 'in-flight', projectId: 'A', model: `comfyui/${workflow.id}@1`, connectionId: server.id });
    const before = db.prepare('SELECT * FROM comfy_workflow_versions').all();
    migrateComfyWorkflows(db);
    migrateComfyWorkflows(db);
    expect(db.prepare('SELECT * FROM comfy_workflow_versions').all()).toEqual(before);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(getComfyConnectionToken(db, server.id)).toBe('old-secret');
    expect(getComfyExecution(db, 'in-flight', 'A')?.connectionId).toBe(server.id);
    expect(() => addComfyWorkflowDraft(db, { name: 'Unbound', graph,
      promptTargets: [{ nodeId: '6', input: 'text' }], output: { nodeId: '9', index: 0 } })).not.toThrow();
  });

  it('discovers enabled workflows, server identities and argument types without private configuration', () => {
    const db = freshDb();
    const server = addComfyConnection(db, { name: 'Studio', baseUrl: 'http://127.0.0.1:8188', trustedNetwork: true, token: 'private-token' });
    const workflow = addComfyWorkflowDraft(db, { name: 'Krea fixture', connectionId: server.id, graph,
      promptTargets: [{ nodeId: '6', input: 'text' }], output: { nodeId: '9', index: 0 } });
    expect(discoverComfy(db).workflows).toEqual([]);
    setComfyWorkflowEnabled(db, workflow.id, 1, true);
    const result = discoverComfy(db);
    expect(result).toMatchObject({ servers: [{ id: server.id, name: 'Studio' }],
      workflows: [{ model: `comfyui/${workflow.id}@1`, name: 'Krea fixture', preferredServerId: server.id, inputs: [] }] });
    for (const secret of ['private-token', '127.0.0.1', 'original', 'graph', 'defaultValue']) expect(JSON.stringify(result)).not.toContain(secret);
  });
  it('saves and enables a reusable workflow before any server is configured', () => {
    const db = freshDb();
    const workflow = addComfyWorkflowDraft(db, { name: 'Reusable', graph,
      promptTargets: [{ nodeId: '6', input: 'text' }], output: { nodeId: '9', index: 0 } });
    expect(workflow.connectionId).toBeUndefined();
    setComfyWorkflowEnabled(db, workflow.id, 1, true);
    expect(listComfyWorkflows(db)[0]?.enabled).toBe(true);
    migrateComfyWorkflows(db);
    expect(getComfyWorkflowDraft(db, workflow.id, 1)?.connectionId).toBeUndefined();
  });

  it('treats the saved server as an optional preference, not a version lock', () => {
    const db = freshDb();
    const first = addComfyConnection(db, { name: 'First', baseUrl: 'http://127.0.0.1:8188', trustedNetwork: true });
    const second = addComfyConnection(db, { name: 'Second', baseUrl: 'http://127.0.0.1:8189', trustedNetwork: true });
    const draft = { name: 'Reusable', connectionId: first.id, graph,
      promptTargets: [{ nodeId: '6', input: 'text' }], output: { nodeId: '9', index: 0 } };
    const workflow = addComfyWorkflowDraft(db, draft);
    const revised = reviseComfyWorkflowDraft(db, workflow.id, { ...draft, connectionId: second.id });
    expect(revised.connectionId).toBe(second.id);
    expect(getComfyWorkflowDraft(db, workflow.id, 1)?.connectionId).toBe(first.id);
  });
  it('starts without any bundled connection, credentials or workflow configuration', () => {
    const db = freshDb();
    migrateComfyWorkflows(db);
    expect(listComfyConnections(db)).toEqual([]);
    expect(listComfyWorkflows(db)).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS count FROM comfy_connection_credentials').get()).toEqual({ count: 0 });
  });
  it('stores multiple drafts for one server without returning its token', () => {
    const db = freshDb();
    const connection = addComfyConnection(db, {
      name: 'Studio', baseUrl: 'http://127.0.0.1:8188/',
      trustedNetwork: true, token: 'top-secret',
    });
    expect(connection).toEqual({
      id: expect.any(String), name: 'Studio', baseUrl: 'http://127.0.0.1:8188',
      trustedNetwork: true, hasToken: true,
    });
    expect(JSON.stringify(listComfyConnections(db))).not.toContain('top-secret');
    expect(getComfyConnectionToken(db, connection.id)).toBe('top-secret');
    for (const name of ['Portrait', 'Product render']) {
      const workflow = addComfyWorkflowDraft(db, {
        name, connectionId: connection.id, graph,
        promptTargets: [{ nodeId: '6', input: 'text' }],
        output: { nodeId: '9', index: 0 },
      });
      expect(workflow.enabled).toBe(false);
      expect(workflow.schemaCheckedAt).toBeUndefined();
      expect(getComfyWorkflowDraft(db, workflow.id, workflow.version)?.graph).toEqual(graph);
    }
    expect(listComfyWorkflows(db)).toHaveLength(2);
    // The migration is safe for existing installations, including restart.
    migrateComfyWorkflows(db);
    expect(listComfyConnections(db)).toHaveLength(1);
    expect(listComfyWorkflows(db)).toHaveLength(2);
  });

  it('refuses invalid server origins and refuses a workflow with no saved server', () => {
    const db = freshDb();
    const input = { name: 'Studio', trustedNetwork: true };
    for (const baseUrl of [
      'file:///private/workflow.json', 'http://user:pass@127.0.0.1:8188',
      'http://127.0.0.1:8188/prompt', 'http://169.254.169.254',
      'http://127.0.0.1:8188/?token=secret',
    ]) {
      expect(() => validateComfyConnection({ ...input, baseUrl })).toThrow();
    }
    expect(() => validateComfyConnection({ ...input, baseUrl: 'http://127.0.0.1:8188', trustedNetwork: false }))
      .toThrow('explicit trusted-network');
    expect(() => addComfyWorkflowDraft(db, {
      name: 'Missing server', connectionId: 'nonexistent', graph,
      promptTargets: [{ nodeId: '6', input: 'text' }], output: { nodeId: '9', index: 0 },
    })).toThrow();
  });

  it('creates an immutable disabled version rather than editing a prior graph', () => {
    const db = freshDb();
    const server = addComfyConnection(db, {
      name: 'Studio', baseUrl: 'http://127.0.0.1:8188', trustedNetwork: true,
    });
    const base = {
      name: 'Portrait', connectionId: server.id, graph,
      promptTargets: [{ nodeId: '6', input: 'text' }],
      output: { nodeId: '9', index: 0 },
    };
    const first = addComfyWorkflowDraft(db, base);
    const next = reviseComfyWorkflowDraft(db, first.id, {
      ...base, graph: {
        ...graph, '6': { ...graph['6'], inputs: { text: 'different literal' } },
      },
    });
    expect(next.version).toBe(2);
    expect(next.enabled).toBe(false);
    expect(next.graphSha256).not.toBe(first.graphSha256);
    expect(getComfyWorkflowDraft(db, first.id, 1)?.graph['6']?.inputs.text).toBe('original');
    expect(getComfyWorkflowDraft(db, first.id, 2)?.graph['6']?.inputs.text).toBe('different literal');
  });

  it('persists public input definitions and output selection across migration without exposing other graph literals', () => {
    const db = freshDb();
    const server = addComfyConnection(db, { name: 'GPU', baseUrl: 'http://127.0.0.1:8188', trustedNetwork: true });
    const workflow = addComfyWorkflowDraft(db, { name: 'Mapped', connectionId: server.id,
      graph: { ...graph, '9': { ...graph['9'], inputs: { ...graph['9'].inputs, filename_prefix: 'example' } } },
      promptTargets: [{ nodeId: '6', input: 'text' }], parameters: [{ name: 'prefix', nodeId: '9', input: 'filename_prefix' }],
      output: { nodeId: '9', index: 0 },
    });
    migrateComfyWorkflows(db);
    expect(getComfyWorkflowDraft(db, workflow.id, 1)?.parameters).toEqual([{ name: 'prefix', nodeId: '9', input: 'filename_prefix' }]);
    expect(listComfyWorkflows(db)[0]).toMatchObject({ parameters: [{ name: 'prefix', type: 'string', defaultValue: 'example' }], output: { nodeId: '9', index: 0 } });
    expect(JSON.stringify(listComfyWorkflows(db))).not.toContain('original');
  });
});
