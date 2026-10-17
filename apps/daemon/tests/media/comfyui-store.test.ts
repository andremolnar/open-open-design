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
});
