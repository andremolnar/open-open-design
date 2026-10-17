import { describe, expect, it } from 'vitest';
import {
  bindComfyPrompt,
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
