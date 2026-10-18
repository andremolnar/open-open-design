import type { ComfyApiGraph, ComfyEditableField, ComfyInputTarget } from './comfyui.js';

/** Stable request keys also used by the editor. Unclear string enums/paths and
 * multi-image controls remain read-only: this adapter imports one image/job.
 * Live server types/ranges are still checked immediately before submission. */
export function comfyEditableFields(graph: ComfyApiGraph, promptTargets: ComfyInputTarget[] = []): ComfyEditableField[] {
  return Object.entries(graph).flatMap(([nodeId, node]) => Object.entries(node.inputs).flatMap(([input, value]) => {
    const name = `node${nodeId}_${input}`;
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(name)
      || ['batch_size', 'batch_count', 'num_images', 'image_count'].includes(input)) return [];
    const usesPrompt = promptTargets.some((target) => target.nodeId === nodeId && target.input === input);
    const prompt = typeof value === 'string' && value.length <= 65_536
      && (usesPrompt || ['prompt', 'positive_prompt', 'negative_prompt', 'text'].includes(input));
    if (!prompt && typeof value !== 'boolean' && !(typeof value === 'number' && Number.isFinite(value))) return [];
    const role = prompt ? 'prompt' as const : typeof value !== 'number' ? undefined
      : ['seed', 'noise_seed'].includes(input) ? 'seed' as const
        : input === 'width' ? 'width' as const : input === 'height' ? 'height' as const : undefined;
    const integer = typeof value === 'number' && ['seed', 'noise_seed', 'width', 'height', 'steps', 'start_at_step', 'end_at_step'].includes(input);
    if (integer && !Number.isSafeInteger(value)) return [];
    return [{ name, nodeId, nodeType: node.class_type, input, label: `${input} · node ${nodeId}`, type: typeof value as 'string' | 'number' | 'boolean',
      defaultValue: value as string | number | boolean, required: false as const, usesPrompt,
      ...(role ? { role } : {}), ...(integer ? { integer: true } : {}) }];
  }));
}
