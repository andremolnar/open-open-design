import { describe, expect, it, vi } from 'vitest';
import { COMFY_JSON_LIMIT_BYTES, comfyNodeSchemaPath } from '../../src/media/comfyui/client.js';
import { fetchComfyWorkflowSchemas } from '../../src/media/comfyui/schema.js';

describe('workflow-specific ComfyUI schema reads', () => {
  it('deduplicates classes and retains only required schemas, not unrelated response entries', async () => {
    const nodeClass = 'Custom / Image (v2)';
    const schema = { input: {}, output: ['IMAGE'] };
    const client = { json: vi.fn(async () => ({ [nodeClass]: schema, Unrelated: { private: 'ignored' } })), image: vi.fn() };
    const result = await fetchComfyWorkflowSchemas(client, {
      '1': { class_type: nodeClass, inputs: {} }, '2': { class_type: nodeClass, inputs: {} },
    });
    expect(client.json.mock.calls).toEqual([[comfyNodeSchemaPath(nodeClass)]]);
    expect(Object.keys(result)).toEqual([nodeClass]);
    expect(result[nodeClass]).toEqual(schema);
  });

  it('fails a missing required class without falling back to the catalogue', async () => {
    const client = { json: vi.fn(async () => ({})), image: vi.fn() };
    await expect(fetchComfyWorkflowSchemas(client, { '1': { class_type: 'Missing', inputs: {} } }))
      .rejects.toThrow('Required node class is unavailable: Missing');
    expect(client.json.mock.calls).toEqual([['/object_info/Missing']]);
  });

  it('does not replace the old catalogue limit with an unbounded aggregate across classes', async () => {
    const description = 'x'.repeat(COMFY_JSON_LIMIT_BYTES / 2);
    const client = { json: vi.fn(async () => ({ First: { input: {}, description }, Second: { input: {}, description } })), image: vi.fn() };
    await expect(fetchComfyWorkflowSchemas(client, {
      '1': { class_type: 'First', inputs: {} }, '2': { class_type: 'Second', inputs: {} },
    })).rejects.toThrow('8 MiB workflow limit');
    expect(client.json.mock.calls).toEqual([['/object_info/First'], ['/object_info/Second']]);
  });

  it.each(['', '.', '..', 'bad\nclass', 'x'.repeat(1025)])('rejects invalid node-class segments', nodeClass => {
    expect(() => comfyNodeSchemaPath(nodeClass)).toThrow('Invalid ComfyUI node class');
  });
});
