import { describe, expect, it } from 'vitest';
import { comfyEditableFields } from '../src/api/comfyui-fields';

describe('ComfyUI editable-field policy shared by editor and discovery', () => {
  it('derives stable distinct typed keys and leaves ambiguous strings, structured data and links read-only', () => {
    const graph = {
      '6': { class_type: 'CLIPTextEncode', inputs: { text: 'positive', clip: ['4', 0] } },
      '7': { class_type: 'CLIPTextEncode', inputs: { text: 'negative' } },
      '4': { class_type: 'Fixture', inputs: { seed: 12, steps: 20, cfg: 7.5, enabled: false,
        model: 'private-model', preset: 'unknown-options', width: ['8', 0], options: { secret: 'private' }, batch_size: 1 } },
    };
    const fields = comfyEditableFields(graph, [{ nodeId: '6', input: 'text' }]);
    expect(fields.map((field) => field.name)).toEqual(['node4_seed', 'node4_steps', 'node4_cfg', 'node4_enabled', 'node6_text', 'node7_text']);
    expect(fields.find((field) => field.name === 'node6_text')).toMatchObject({ usesPrompt: true, defaultValue: 'positive', type: 'string' });
    expect(fields.find((field) => field.name === 'node7_text')).toMatchObject({ usesPrompt: false, defaultValue: 'negative' });
    expect(fields.find((field) => field.name === 'node4_seed')).toMatchObject({ role: 'seed', integer: true });
    expect(fields.find((field) => field.name === 'node4_cfg')?.integer).toBeUndefined();
    expect(JSON.stringify(fields)).not.toContain('private');
  });
});
