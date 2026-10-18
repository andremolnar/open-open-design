import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { bindComfyInputs, validateComfyWorkflowDraft } from '../../src/media/comfyui/workflow.js';
import { addComfyWorkflowDraft, discoverComfy, migrateComfyWorkflows, setComfyWorkflowEnabled } from '../../src/media/comfyui/store.js';
import { getComfyWorkflowDraft, reviseComfyWorkflowDraft } from '../../src/media/comfyui/store.js';

const graph = {
  '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'private-model.safetensors' } },
  '6': { class_type: 'CLIPTextEncode', inputs: { text: 'a cup', clip: ['1', 1] } },
  '7': { class_type: 'KSampler', inputs: { seed: 123, steps: 20, cfg: 7.5, enabled: true, sampler_name: 'euler', positive: ['6', 0] } },
  '8': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
  '9': { class_type: 'SaveImage', inputs: { images: ['7', 0], filename_prefix: 'private-prefix' } },
};
const draft = () => ({ name: 'Krea fixture', inputMode: 'automatic', graph,
  promptTargets: [{ nodeId: '6', input: 'text' }], output: { nodeId: '9', index: 0 } });
const databases: Database.Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

describe('ComfyUI promptable defaults', () => {
  it('uses imported defaults and accepts partial typed overrides without modifying the stored graph', () => {
    const workflow = validateComfyWorkflowDraft(draft());
    const bound = bindComfyInputs(workflow, 'new cup', { node7_seed: 456, node8_width: 1024, node8_height: 768 });
    expect(bound['7']?.inputs).toMatchObject({ seed: 456, steps: 20, cfg: 7.5, enabled: true, sampler_name: 'euler' });
    expect(bound['8']?.inputs).toEqual({ width: 1024, height: 768, batch_size: 1 });
    expect(bound['6']?.inputs.text).toBe('new cup');
    expect(bindComfyInputs(workflow, 'cup')['7']?.inputs.seed).toBe(123);
    expect(workflow.graph).toEqual(graph);
  });

  it('discovers every editable default but no model/path, link or batch-output controls', () => {
    const db = new Database(':memory:'); databases.push(db); migrateComfyWorkflows(db);
    const workflow = addComfyWorkflowDraft(db, draft());
    setComfyWorkflowEnabled(db, workflow.id, 1, true);
    const discovered = discoverComfy(db).workflows[0]!;
    expect(discovered.inputs).toContainEqual(expect.objectContaining({ name: 'node7_seed', type: 'number', defaultValue: 123, required: false }));
    expect(discovered.inputs).toContainEqual(expect.objectContaining({ name: 'node6_text', type: 'string', defaultValue: 'a cup', required: false, usesPrompt: true }));
    for (const name of ['node8_batch_size', 'node1_ckpt_name', 'node7_sampler_name', 'node9_filename_prefix', 'node6_clip']) {
      expect(discovered.inputs.some((input) => input.name === name)).toBe(false);
    }
    expect(JSON.stringify(discovered)).not.toContain('private-');
  });

  it('rejects read-only or incorrectly typed overrides instead of coercing them', () => {
    const workflow = validateComfyWorkflowDraft(draft());
    for (const inputs of [{ node1_ckpt_name: 'other' }, { node7_sampler_name: 'other' }, { node8_batch_size: 5 },
      { node7_seed: 'random' }, { node7_seed: 1.5 }, { node7_seed: Number.MAX_SAFE_INTEGER + 1 },
      { node7_enabled: 'false' }, { node7_cfg: NaN }]) {
      expect(() => bindComfyInputs(workflow, 'cup', inputs)).toThrow();
    }
    expect(bindComfyInputs(workflow, 'cup', { node7_seed: 0, node7_enabled: false, node7_cfg: 5.25 })['7']?.inputs)
      .toMatchObject({ seed: 0, enabled: false, cfg: 5.25 });
    expect(bindComfyInputs(workflow, 'request prompt', { node6_text: 'explicit text' })['6']?.inputs.text).toBe('explicit text');
  });

  it('keeps immutable legacy inputs required until the operator saves a new automatic version', () => {
    const db = new Database(':memory:'); databases.push(db); migrateComfyWorkflows(db);
    const { inputMode: _mode, ...legacy } = draft();
    const old = addComfyWorkflowDraft(db, { ...legacy, parameters: [{ name: 'seed', nodeId: '7', input: 'seed' }] });
    const before = getComfyWorkflowDraft(db, old.id, 1)!;
    expect(() => bindComfyInputs(before, 'cup')).toThrow('Required workflow input');
    const next = reviseComfyWorkflowDraft(db, old.id, draft());
    expect(next.inputMode).toBe('automatic');
    expect(getComfyWorkflowDraft(db, old.id, 1)).toEqual(before);
    migrateComfyWorkflows(db);
    const saved = getComfyWorkflowDraft(db, old.id, 2)!;
    expect(saved.inputMode).toBe('automatic');
    expect(bindComfyInputs(saved, 'cup')['7']?.inputs.seed).toBe(123);
  });

  it('produces five distinct seed variants and six explicit sizes from discovered defaults', () => {
    const workflow = validateComfyWorkflowDraft(draft());
    const seeded = [11, 22, 33, 44, 55].map((seed) => bindComfyInputs(workflow, 'cup', { node7_seed: seed }));
    expect(new Set(seeded.map((item) => item['7']?.inputs.seed)).size).toBe(5);
    for (const [width, height] of [[1024, 1024], [1024, 768], [768, 1024], [1024, 576], [576, 1024], [1152, 768]]) {
      expect(bindComfyInputs(workflow, 'cup', { node8_width: width, node8_height: height })['8']?.inputs)
        .toEqual({ width, height, batch_size: 1 });
    }
    expect(workflow.graph).toEqual(graph);
  });
});
