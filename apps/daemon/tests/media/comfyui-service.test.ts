import Database from 'better-sqlite3';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { comfyWorkflowModelId } from '@open-design/contracts';
import { generateMedia } from '../../src/media/index.js';
import { checkComfyConnection, renderComfyWorkflow, checkComfyWorkflow, validateComfyPng, resolveComfyServer } from '../../src/media/comfyui/service.js';
import { addComfyConnection, addComfyWorkflowDraft, getComfyExecution, migrateComfyWorkflows,
  setComfyWorkflowEnabled, claimComfyRequest } from '../../src/media/comfyui/store.js';
import { releaseComfyOccupancy, listComfyWorkflows, discoverComfy } from '../../src/media/comfyui/store.js';
import { assertComfyAddress } from '../../src/media/comfyui/client.js';
import { validateComfySchema } from '../../src/media/comfyui/schema.js';
import { ComfyError } from '../../src/media/comfyui/errors.js';

export const schemas = {
  SolidImage: { input: { required: { prompt: ['STRING', {}] } }, output: ['IMAGE'] },
  SaveImage: { input: { required: { images: ['IMAGE'], filename_prefix: ['STRING', {}] } }, output: [], output_node: true },
};
const graph = {
  '1': { class_type: 'SolidImage', inputs: { prompt: 'original' } },
  '9': { class_type: 'SaveImage', inputs: { images: ['1', 0], filename_prefix: 'test' } },
};
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const databases: Database.Database[] = [];
const dirs: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const db of databases.splice(0)) db.close();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function setup() {
  const db = new Database(':memory:'); databases.push(db);
  db.pragma('foreign_keys = ON'); migrateComfyWorkflows(db);
  const connection = addComfyConnection(db, { name: 'Studio', baseUrl: 'http://127.0.0.1:8188', trustedNetwork: true });
  const draft = { name: 'Solid', connectionId: connection.id, graph, promptTargets: [{ nodeId: '1', input: 'prompt' }], output: { nodeId: '9', index: 0 } };
  const workflow = addComfyWorkflowDraft(db, draft);
  const json = vi.fn(async (path: string, _body?: unknown): Promise<unknown> => {
    if (path.startsWith('/object_info/')) {
      const nodeClass = decodeURIComponent(path.slice('/object_info/'.length));
      const schema = (schemas as Record<string, unknown>)[nodeClass];
      return schema ? { [nodeClass]: schema } : {};
    }
    if (path === '/prompt') return { prompt_id: 'owned-prompt', node_errors: {} };
    return { 'owned-prompt': { status: { status_str: 'success', completed: true }, outputs: {
      '1': { images: [{ filename: 'wrong-preview.png', subfolder: '', type: 'temp' }] },
      '9': { images: [{ filename: 'final.png', subfolder: 'generated', type: 'output' }] },
    } } };
  });
  const client = { json, image: vi.fn(async () => png) };
  await checkComfyWorkflow(db, workflow.id, workflow.version, client);
  setComfyWorkflowEnabled(db, workflow.id, workflow.version, true);
  return { db, connection, draft, client, model: comfyWorkflowModelId(workflow.id, workflow.version) };
}

describe('ComfyUI handoff and returned assets', () => {
  it('checks server health without fetching schemas or submitting a workflow', async () => {
    const client = { json: vi.fn(async () => ({ system: { os: 'fixture' }, devices: [] })), image: vi.fn() };
    await expect(checkComfyConnection(client)).resolves.toEqual({ connected: true, checkedAt: expect.any(Number) });
    expect(client.json.mock.calls).toEqual([['/system_stats']]);
    expect(client.image).not.toHaveBeenCalled();
  });

  it.each([null, [], {}, { system: {}, devices: 'not-a-list' }, { error: 'upstream private error' }])
    ('does not mistake unrelated JSON for a successful ComfyUI health check: %j', async (response) => {
      await expect(checkComfyConnection({ json: async () => response, image: vi.fn() }))
        .rejects.toMatchObject({ code: 'COMFY_INVALID_RESPONSE' });
    });

  it('validates and submits with only workflow-specific schemas, never the full catalogue', async () => {
    const { db, client, model } = await setup();
    const originalJson = client.json.getMockImplementation()!;
    client.json.mockClear();
    client.json.mockImplementation(async (path, body) => {
      if (path === '/object_info') throw new Error('full catalogue exceeds the response limit');
      if (path === '/object_info/SolidImage') return { SolidImage: schemas.SolidImage };
      if (path === '/object_info/SaveImage') return { SaveImage: schemas.SaveImage };
      return originalJson(path, body);
    });
    const selected = listComfyWorkflows(db)[0]!;
    await checkComfyWorkflow(db, selected.id, selected.version, client);
    await renderComfyWorkflow(db, { taskId: 'targeted', projectId: 'A', model, prompt: 'cup' }, { client });
    expect(client.json.mock.calls.filter(([path]) => path.startsWith('/object_info/')).map(([path]) => path))
      .toEqual(['/object_info/SaveImage', '/object_info/SolidImage', '/object_info/SaveImage', '/object_info/SolidImage']);
    expect(client.json.mock.calls.some(([path]) => path === '/object_info')).toBe(false);
    expect(client.json.mock.calls.filter(([path]) => path === '/prompt')).toHaveLength(1);
  });

  it('requires an explicit choice when no preference exists and multiple servers are configured', async () => {
    const { db, connection } = await setup();
    expect(resolveComfyServer(db, {}).id).toBe(connection.id);
    const other = addComfyConnection(db, { name: 'Other', baseUrl: 'http://127.0.0.1:8189', trustedNetwork: true });
    expect(() => resolveComfyServer(db, {})).toThrow('Several');
    expect(resolveComfyServer(db, { connectionId: connection.id }, other.id).id).toBe(other.id);
    expect(() => resolveComfyServer(db, { connectionId: connection.id }, 'missing')).toThrow('not found');
    expect(() => resolveComfyServer(db, {}, '')).toThrow('saved ComfyUI server ID');
  });

  it('discovers a Krea-named workflow and forwards an explicitly exposed 4:3 size without editing the saved graph', async () => {
    const { db, client, draft } = await setup();
    const imageGraph = { ...graph, '1': { ...graph['1'], inputs: { prompt: 'original', width: 512, height: 512 } } };
    const workflow = addComfyWorkflowDraft(db, { ...draft, name: 'Krea fixture', graph: imageGraph,
      parameters: [{ name: 'width', nodeId: '1', input: 'width' }, { name: 'height', nodeId: '1', input: 'height' }] });
    setComfyWorkflowEnabled(db, workflow.id, 1, true);
    const discovered = discoverComfy(db).workflows.find(({ name }) => name === 'Krea fixture')!;
    expect(discovered.inputs).toEqual([{ name: 'width', type: 'number', required: true }, { name: 'height', type: 'number', required: true }]);
    const originalJson = client.json.getMockImplementation()!;
    client.json.mockImplementation((path, body) => path.startsWith('/object_info/') ? Promise.resolve({ ...schemas,
      SolidImage: { ...schemas.SolidImage, input: { required: { prompt: ['STRING', {}], width: ['INT', { min: 64, max: 2048 }], height: ['INT', { min: 64, max: 2048 }] } } },
    }) : originalJson(path, body));
    await renderComfyWorkflow(db, { taskId: 'ratio', projectId: 'A', model: discovered.model, prompt: 'cup',
      workflowInputs: { width: 1024, height: 768 } }, { client });
    const submitted = client.json.mock.calls.find(([path]) => path === '/prompt')?.[1] as { prompt: typeof imageGraph };
    expect(submitted.prompt['1'].inputs).toEqual({ prompt: 'cup', width: 1024, height: 768 });
    expect(imageGraph['1'].inputs).toEqual({ prompt: 'original', width: 512, height: 512 });
  });

  it('reports selected-server schema errors without disabling the workflow or trying another server', async () => {
    const { db, client, model } = await setup();
    client.json.mockResolvedValue({ SaveImage: schemas.SaveImage });
    await expect(renderComfyWorkflow(db, { taskId: 'missing-model', projectId: 'A', model, prompt: 'cup' }, { client }))
      .rejects.toThrow(/Solid on Studio:.*SolidImage/);
    expect(client.json.mock.calls.filter(([path]) => path === '/prompt')).toHaveLength(0);
    expect(getComfyExecution(db, 'missing-model', 'A')?.phase).toBe('failed');
    expect(listComfyWorkflows(db)[0]?.enabled).toBe(true);
  });
  it('explains that the provider alias is not a saved model and never falls back or submits it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'od-comfy-alias-')); dirs.push(dir);
    const comfyRender = vi.fn();
    await expect(generateMedia({ projectRoot: dir, projectsRoot: join(dir, 'projects'), projectId: 'A',
      surface: 'image', model: 'comfyui', prompt: 'a cup', comfyRender,
    })).rejects.toThrow(/save.*enable/i);
    expect(comfyRender).not.toHaveBeenCalled();
  });
  it('records explicit submission rejection as failed rather than manufacturing an unknown GPU job', async () => {
    const { db, client, model } = await setup();
    client.json.mockImplementation(async (path) => {
      if (path.startsWith('/object_info/')) return schemas;
      throw new ComfyError('ComfyUI rejected the graph', 'COMFY_PROMPT_REJECTED', 400);
    });
    await expect(renderComfyWorkflow(db, { taskId: 'rejected', projectId: 'A', model, prompt: 'test' }, { client }))
      .rejects.toMatchObject({ code: 'COMFY_PROMPT_REJECTED' });
    expect(getComfyExecution(db, 'rejected', 'A')?.phase).toBe('failed');
    expect(client.json.mock.calls.filter(([path]) => path === '/prompt')).toHaveLength(1);
  });
  it('patches an exact prompt binding, downloads only the selected node and writes exact project bytes', async () => {
    const { db, client, model } = await setup();
    const dir = await mkdtemp(join(tmpdir(), 'od-comfy-dispatch-')); dirs.push(dir);
    const captured = vi.fn();
    const meta = await generateMedia({ projectRoot: dir, projectsRoot: join(dir, 'projects'), projectId: 'origin-A',
      surface: 'image', model, prompt: 'new prompt', output: 'comfy-task.png', onBytesWritten: captured,
      comfyRender: () => renderComfyWorkflow(db, { taskId: 'task-1', projectId: 'origin-A', model, prompt: 'new prompt' }, { client }),
    });
    expect(meta).toMatchObject({ name: 'comfy-task.png', providerId: 'comfyui', usedStubFallback: false, intentionalStub: false });
    expect(await readFile(join(dir, 'projects', 'origin-A', meta.name))).toEqual(png);
    expect(captured.mock.calls[0]?.[0].bytes).toEqual(png);
    expect(client.image).toHaveBeenCalledWith({ filename: 'final.png', subfolder: 'generated', type: 'output' });
    const submit = client.json.mock.calls.find(([path]) => path === '/prompt')?.[1] as { prompt: typeof graph };
    expect(submit.prompt['1'].inputs.prompt).toBe('new prompt');
    expect(graph['1'].inputs.prompt).toBe('original');
    expect(getComfyExecution(db, 'task-1', 'origin-A')).toMatchObject({ phase: 'importing', promptId: 'owned-prompt' });
    expect(getComfyExecution(db, 'task-1', 'other-project')).toBeNull();
  });

  it('does not resubmit when submission loses its response and keeps server occupancy', async () => {
    const { db, client, model } = await setup();
    client.json.mockImplementation(async (path) => {
      if (path.startsWith('/object_info/')) return schemas;
      throw new Error('token=private upstream response');
    });
    await expect(renderComfyWorkflow(db, { taskId: 'lost-response', projectId: 'A', model, prompt: 'test' }, { client }))
      .rejects.toMatchObject({ code: 'COMFY_OUTCOME_UNKNOWN' });
    expect(client.json.mock.calls.filter(([path]) => path === '/prompt')).toHaveLength(1);
    expect(getComfyExecution(db, 'lost-response', 'A')?.phase).toBe('outcome_unknown');
    await expect(renderComfyWorkflow(db, { taskId: 'duplicate', projectId: 'A', model, prompt: 'test' }, { client }))
      .rejects.toThrow('unfinished');
    expect(client.json.mock.calls.filter(([path]) => path === '/prompt')).toHaveLength(1);
    releaseComfyOccupancy(db, 'lost-response');
    expect(getComfyExecution(db, 'lost-response', 'A')).toMatchObject({ phase: 'outcome_unknown', releasedAt: expect.any(Number) });
  });

  it('recovers safe reads for a known prompt without another /prompt call', async () => {
    const { db, client, model } = await setup();
    client.image.mockRejectedValueOnce(new Error('download interrupted'));
    await expect(renderComfyWorkflow(db, { taskId: 'recover', projectId: 'A', model, prompt: 'test' }, { client }))
      .rejects.toMatchObject({ code: 'COMFY_OUTCOME_UNKNOWN' });
    const result = await renderComfyWorkflow(db, { taskId: 'recover', projectId: 'A', model, prompt: '', resume: true }, { client });
    expect(result.bytes).toEqual(png);
    expect(client.json.mock.calls.filter(([path]) => path === '/prompt')).toHaveLength(1);
  });

  it('polls only matching history and never treats another prompt output as success', async () => {
    const { db, client, model } = await setup();
    client.json.mockImplementation(async (path) => path.startsWith('/object_info/') ? schemas
      : path === '/prompt' ? { prompt_id: 'owned-prompt' }
        : { 'other-prompt': { status: { completed: true, status_str: 'success' }, outputs: {} } });
    await expect(renderComfyWorkflow(db, { taskId: 'pending', projectId: 'A', model, prompt: 'test' },
      { client, maxPolls: 2, wait: async () => {} })).rejects.toMatchObject({ code: 'COMFY_OUTCOME_UNKNOWN' });
    expect(client.image).not.toHaveBeenCalled();
  });

  it('rejects schema drift and invalid links before GPU submission, even with stubs allowed', async () => {
    vi.stubEnv('OD_MEDIA_ALLOW_STUBS', '1');
    const { db, client, model, draft } = await setup();
    expect(() => validateComfySchema({ ...draft, graph: { ...graph, '9': { ...graph['9'], inputs: { ...graph['9'].inputs, images: ['1', 2] } } } }, schemas))
      .toThrow('Incompatible link');
    client.json.mockResolvedValue({ ...schemas, SolidImage: { ...schemas.SolidImage, output: ['LATENT'] } });
    const dir = await mkdtemp(join(tmpdir(), 'od-comfy-no-stub-')); dirs.push(dir);
    await expect(generateMedia({ projectRoot: dir, projectsRoot: join(dir, 'projects'), projectId: 'A', surface: 'image', model,
      comfyRender: () => renderComfyWorkflow(db, { taskId: 'stale', projectId: 'A', model, prompt: 'test' }, { client }),
    })).rejects.toThrow();
    expect(client.json.mock.calls.filter(([path]) => path === '/prompt')).toHaveLength(0);
  });

  it('deduplicates durable operation IDs and refuses mismatched payloads', async () => {
    const { db, model } = await setup();
    const request = { taskId: 'first-task', requestId: 'operation-1', projectId: 'A', model, prompt: 'test' };
    expect(claimComfyRequest(db, request)).toBe('first-task');
    expect(claimComfyRequest(db, { ...request, taskId: 'new-task' })).toBe('first-task');
    expect(() => claimComfyRequest(db, { ...request, prompt: 'different' })).toThrow('different request');
    const parameterized = { ...request, requestId: 'parameters-1', workflowInputs: { seed: 12, resolution: 'medium' } };
    expect(claimComfyRequest(db, parameterized)).toBe('first-task');
    expect(claimComfyRequest(db, { ...parameterized, workflowInputs: { resolution: 'medium', seed: 12 } })).toBe('first-task');
    expect(() => claimComfyRequest(db, { ...parameterized, workflowInputs: { seed: 13, resolution: 'medium' } })).toThrow('different request');
    const onServer = { ...request, requestId: 'server-choice-1', comfyServerId: 'server-a' };
    expect(claimComfyRequest(db, onServer)).toBe('first-task');
    expect(() => claimComfyRequest(db, { ...onServer, comfyServerId: 'server-b' })).toThrow('different request');
  });

  it('records an explicit server override and refuses to recover the job on a different server', async () => {
    const { db, client, model } = await setup();
    const other = addComfyConnection(db, { name: 'Other', baseUrl: 'http://127.0.0.1:8189', trustedNetwork: true });
    client.image.mockRejectedValueOnce(new Error('download interrupted'));
    await expect(renderComfyWorkflow(db, { taskId: 'override', projectId: 'A', model, prompt: 'cup', comfyServerId: other.id }, { client }))
      .rejects.toMatchObject({ code: 'COMFY_OUTCOME_UNKNOWN' });
    expect(getComfyExecution(db, 'override', 'A')).toMatchObject({ connectionId: other.id });
    await expect(renderComfyWorkflow(db, { taskId: 'override', projectId: 'A', model, prompt: '', resume: true, comfyServerId: 'different' }, { client }))
      .rejects.toThrow(/original server/i);
    expect(client.json.mock.calls.filter(([path]) => path === '/prompt')).toHaveLength(1);
  });

  it('validates substituted enum/range values before posting and keeps the saved fixed graph intact', async () => {
    const { db, client, draft } = await setup();
    const extendedGraph = { ...graph, '20': { class_type: 'FixtureDimensions', inputs: { width: 512, preset: 'standard' } } };
    const info = { ...schemas, FixtureDimensions: { input: { required: {
      width: ['INT', { min: 1, max: 1024 }], preset: [['standard', 'large'], {}],
    } }, output: ['INT', 'INT'] } };
    const workflow = addComfyWorkflowDraft(db, { ...draft, graph: extendedGraph,
      parameters: [{ name: 'preset', nodeId: '20', input: 'preset' }, { name: 'width', nodeId: '20', input: 'width' }],
    });
    const model = comfyWorkflowModelId(workflow.id, 1);
    const originalJson = client.json.getMockImplementation()!;
    client.json.mockImplementation((path, body) => path.startsWith('/object_info/') ? Promise.resolve(info) : originalJson(path, body));
    await checkComfyWorkflow(db, workflow.id, 1, client); setComfyWorkflowEnabled(db, workflow.id, 1, true);
    await expect(renderComfyWorkflow(db, { taskId: 'bad-enum', projectId: 'A', model, prompt: 'cup', workflowInputs: { preset: 'missing', width: 512 } }, { client }))
      .rejects.toThrow('Unavailable model or enum');
    await expect(renderComfyWorkflow(db, { taskId: 'bad-range', projectId: 'A', model, prompt: 'cup', workflowInputs: { preset: 'large', width: 0 } }, { client }))
      .rejects.toThrow('Numeric input out of range');
    expect(client.json.mock.calls.filter(([path]) => path === '/prompt')).toHaveLength(0);
    await renderComfyWorkflow(db, { taskId: 'good-enum', projectId: 'A', model, prompt: 'cup', workflowInputs: { preset: 'large', width: 512 } }, { client });
    const submitted = client.json.mock.calls.find(([path]) => path === '/prompt')?.[1] as { prompt: typeof extendedGraph };
    expect(submitted.prompt['20'].inputs).toEqual({ width: 512, preset: 'large' });
    expect(extendedGraph['20'].inputs.preset).toBe('standard');
  });

  it('rejects metadata, unapproved LAN targets, and non-image or oversized decoded data', () => {
    expect(() => assertComfyAddress('169.254.169.254', true)).toThrow();
    expect(() => assertComfyAddress('::ffff:169.254.169.254', true)).toThrow();
    expect(() => assertComfyAddress('10.0.0.1', false)).toThrow();
    expect(() => assertComfyAddress('127.0.0.1', false)).toThrow();
    expect(() => assertComfyAddress('10.0.0.1', true)).not.toThrow();
    expect(() => validateComfyPng(Buffer.from('<html>not an image</html>'))).toThrow();
    expect(() => validateComfyPng(png)).not.toThrow();
    const oversized = Buffer.from(png); oversized.writeUInt32BE(100_000, 16); oversized.writeUInt32BE(100_000, 20);
    expect(() => validateComfyPng(oversized)).toThrow('megapixels');
  });
});
