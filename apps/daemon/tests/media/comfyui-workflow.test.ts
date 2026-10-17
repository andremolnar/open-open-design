import { describe, expect, it } from 'vitest';
import {
  bindComfyPrompt,
  bindComfyInputs,
  parseComfyApiGraph,
  validateComfyWorkflowDraft,
} from '../../src/media/comfyui/workflow.js';

const graph = {
  '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'installed.safetensors' } },
  '6': { class_type: 'CLIPTextEncode', inputs: { text: 'original', clip: ['4', 1] } },
  '9': { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'test' } },
};

function draft() {
  return {
    name: 'Product render', connectionId: 'studio', graph,
    promptTargets: [{ nodeId: '6', input: 'text' }],
    output: { nodeId: '9', index: 0 },
  };
}

describe('ComfyUI API graph import', () => {
  it('accepts a /prompt request envelope as well as its inner API graph', () => {
    expect(parseComfyApiGraph(JSON.stringify({ prompt: graph, client_id: 'ignored' }))).toEqual(graph);
  });

  it('binds only declared typed request inputs while preserving locked literals and links', () => {
    const workflow = { ...draft(), graph: { ...graph,
      '20': { class_type: 'FixtureDimensions', inputs: { width: 512, height: 512, preset: 'standard', enabled: true } },
    }, parameters: [{ name: 'preset', nodeId: '20', input: 'preset' }] };
    const bound = bindComfyInputs(workflow, 'a cup', { preset: 'large' });
    expect(bound['6']?.inputs.text).toBe('a cup');
    expect(bound['20']?.inputs).toEqual({ width: 512, height: 512, preset: 'large', enabled: true });
    expect(bound['6']?.inputs.clip).toEqual(['4', 1]);
    expect(workflow.graph['20'].inputs.preset).toBe('standard');
    expect(() => bindComfyInputs(workflow, 'cup', {})).toThrow('preset');
    expect(() => bindComfyInputs(workflow, 'cup', { preset: 123 })).toThrow('string');
    expect(() => bindComfyInputs(workflow, 'cup', { preset: 'large', width: 640 })).toThrow('Unknown workflow input');
    expect(() => bindComfyInputs(workflow, 'cup', [])).toThrow();
  });

  it('rejects ambiguous parameter mappings, links and unsafe keys before saving', () => {
    for (const parameters of [
      [{ name: 'clip', nodeId: '6', input: 'clip' }],
      [{ name: 'promptAgain', nodeId: '6', input: 'text' }],
      [{ name: 'constructor', nodeId: '9', input: 'filename_prefix' }],
      [{ name: 'same', nodeId: '4', input: 'ckpt_name' }, { name: 'same', nodeId: '9', input: 'filename_prefix' }],
    ]) expect(() => validateComfyWorkflowDraft({ ...draft(), parameters })).toThrow();
  });

  it('requires actual finite numbers and booleans rather than coercing request strings', () => {
    const workflow = { ...draft(), graph: { ...graph, '16': { class_type: 'Custom', inputs: { seed: 123, enabled: true } } },
      parameters: [{ name: 'seed', nodeId: '16', input: 'seed' }, { name: 'enabled', nodeId: '16', input: 'enabled' }],
    };
    expect(bindComfyInputs(workflow, 'cup', { seed: 0, enabled: false })['16']?.inputs).toEqual({ seed: 0, enabled: false });
    for (const inputs of [{ seed: '123', enabled: false }, { seed: 123, enabled: 'false' }, { seed: Infinity, enabled: true }]) {
      expect(() => bindComfyInputs(workflow, 'cup', inputs)).toThrow();
    }
  });
  it('accepts an API export without changing the imported graph when binding a prompt', () => {
    const workflow = validateComfyWorkflowDraft(draft());
    const bound = bindComfyPrompt(workflow, 'new prompt');
    expect(bound['6']?.inputs.text).toBe('new prompt');
    expect(workflow.graph['6']?.inputs.text).toBe('original');
    expect(graph['6'].inputs.text).toBe('original');
    expect(bound['6']?.inputs.clip).toEqual(['4', 1]);
  });

  it('refuses editor/canvas JSON rather than guessing widget positions', () => {
    expect(() => parseComfyApiGraph(JSON.stringify({ nodes: [{ id: 6, widgets_values: ['prompt'] }] })))
      .toThrow('export the API format');
  });

  it('rejects broken links and non-node payloads', () => {
    expect(() => parseComfyApiGraph({ '1': { class_type: 'SaveImage', inputs: { images: ['42', 0] } } }))
      .toThrow('missing node');
    expect(() => parseComfyApiGraph({ invalid: { class_type: 'SaveImage', inputs: {} } }))
      .toThrow('Invalid ComfyUI API node');
  });

  it('rejects links, duplicate targets and missing outputs before binding', () => {
    expect(() => validateComfyWorkflowDraft({ ...draft(), promptTargets: [{ nodeId: '6', input: 'clip' }] }))
      .toThrow('text literal');
    expect(() => validateComfyWorkflowDraft({ ...draft(), promptTargets: [
      { nodeId: '6', input: 'text' }, { nodeId: '6', input: 'text' },
    ] })).toThrow('Duplicate prompt binding');
    expect(() => validateComfyWorkflowDraft({ ...draft(), output: { nodeId: '99', index: 0 } }))
      .toThrow('output node');
  });

  it('fails closed on oversized imports and multiple image output indices', () => {
    expect(() => parseComfyApiGraph(' '.repeat(2 * 1024 * 1024 + 1))).toThrow('2 MiB');
    expect(() => validateComfyWorkflowDraft({ ...draft(), output: { nodeId: '9', index: 1 } }))
      .toThrow('image index 0');
  });
});
