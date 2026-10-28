import type {
  ComfyApiGraph,
  ComfyInputTarget,
  ComfyWorkflowDraft,
  ComfyParameterBinding,
} from '@open-design/contracts';
import { COMFY_MAX_REQUEST_INPUTS, comfyEditableFields, isComfyLiteral, parseComfyGraphDocument } from '@open-design/contracts';

const MAX_GRAPH_BYTES = 2 * 1024 * 1024;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function targetKey(target: ComfyInputTarget): string {
  return `${target.nodeId}:${target.input}`;
}

/**
 * Parse an API export without guessing how canvas widget positions map to inputs.
 * This is structural validation only: per-node schemas must validate classes, types,
 * connected inputs and output capability on the selected server before a run.
 */
export function parseComfyApiGraph(raw: unknown): ComfyApiGraph {
  const size = Buffer.byteLength(typeof raw === 'string' ? raw : JSON.stringify(raw) ?? '');
  if (size > MAX_GRAPH_BYTES) throw new Error('ComfyUI API graph exceeds 2 MiB');

  return parseComfyGraphDocument(raw);
}

export function validateComfyWorkflowDraft(raw: unknown): ComfyWorkflowDraft {
  if (!record(raw)) throw new Error('Workflow must be an object');
  const { name, connectionId, promptTargets, output } = raw;
  if (raw.inputMode !== undefined && raw.inputMode !== 'automatic') throw new Error('Unsupported workflow input mode');
  if (typeof name !== 'string' || !name.trim() || name.length > 120) {
    throw new Error('Workflow name must be between 1 and 120 characters');
  }
  if (connectionId !== undefined && connectionId !== null && (typeof connectionId !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(connectionId))) {
    throw new Error('Preferred server must be a saved ComfyUI server ID');
  }
  const graph = parseComfyApiGraph(raw.graph);
  if (!Array.isArray(promptTargets) || !promptTargets.length || promptTargets.length > 8) {
    throw new Error('Choose at least one prompt input (maximum 8)');
  }
  const seen = new Set<string>();
  for (const target of promptTargets) {
    if (!record(target) || typeof target.nodeId !== 'string' || typeof target.input !== 'string'
      || !target.input || !Object.hasOwn(graph, target.nodeId)
      || !Object.hasOwn(graph[target.nodeId]!.inputs, target.input)) {
      throw new Error('Prompt binding must target an existing node input');
    }
    const value = graph[target.nodeId]!.inputs[target.input];
    if (typeof value !== 'string') {
      throw new Error(`Prompt binding ${target.nodeId}.${target.input} must target a text literal, not a link`);
    }
    const key = targetKey(target as unknown as ComfyInputTarget);
    if (seen.has(key)) throw new Error('Duplicate prompt binding');
    seen.add(key);
  }
  const parameters: ComfyParameterBinding[] = [];
  if (raw.inputMode === 'automatic' && Array.isArray(raw.parameters) && raw.parameters.length) {
    throw new Error('Automatic workflow fields cannot also declare legacy parameter bindings');
  }
  if (raw.parameters !== undefined) {
    if (!Array.isArray(raw.parameters) || raw.parameters.length > 32) throw new Error('Choose at most 32 request inputs');
    const names = new Set<string>();
    for (const binding of raw.parameters) {
      if (!record(binding) || typeof binding.name !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(binding.name)
        || ['constructor', 'prototype', 'prompt'].includes(binding.name) || names.has(binding.name)) {
        throw new Error('Request input names must be unique identifiers, not reserved keys');
      }
      if (typeof binding.nodeId !== 'string' || typeof binding.input !== 'string'
        || !Object.hasOwn(graph, binding.nodeId) || !Object.hasOwn(graph[binding.nodeId]!.inputs, binding.input)
        || !isComfyLiteral(graph[binding.nodeId]!.inputs[binding.input])) throw new Error('Request bindings must target existing text, number or boolean literals, not links');
      const key = targetKey(binding as unknown as ComfyInputTarget);
      if (seen.has(key)) throw new Error('A node input cannot have multiple bindings');
      seen.add(key); names.add(binding.name);
      parameters.push({ name: binding.name, nodeId: binding.nodeId, input: binding.input });
    }
  }
  if (!record(output) || typeof output.nodeId !== 'string' || !Object.hasOwn(graph, output.nodeId)
    || output.index !== 0) {
    throw new Error('Choose one output node and image index 0');
  }
  return {
    name: name.trim(),
    ...(typeof connectionId === 'string' ? { connectionId } : {}),
    graph,
    ...(raw.inputMode === 'automatic' ? { inputMode: 'automatic' as const } : {}),
    promptTargets: promptTargets.map((target: ComfyInputTarget) => ({ nodeId: target.nodeId, input: target.input })),
    ...(parameters.length ? { parameters } : {}),
    output: { nodeId: output.nodeId, index: 0 },
  };
}

/** A prompt is bound only to confirmed literal paths in a fresh graph copy. */
export function bindComfyPrompt(draft: ComfyWorkflowDraft, prompt: string): ComfyApiGraph {
  return bindComfyInputs(draft, prompt);
}

/** Automatic fields inherit saved defaults; legacy mappings keep required-input semantics. */
export function bindComfyInputs(draft: ComfyWorkflowDraft, prompt: string, workflowInputs: unknown = {}): ComfyApiGraph {
  if (!prompt.trim()) throw new Error('Image prompt is required');
  const validated = validateComfyWorkflowDraft(draft);
  if (!record(workflowInputs) || Object.keys(workflowInputs).length > COMFY_MAX_REQUEST_INPUTS) throw new Error(`workflowInputs must be an object of at most ${COMFY_MAX_REQUEST_INPUTS} values`);
  const bindings = validated.inputMode === 'automatic'
    ? comfyEditableFields(validated.graph, validated.promptTargets)
    : validated.parameters ?? [];
  const names = new Set(bindings.map((binding) => binding.name));
  for (const name of Object.keys(workflowInputs)) if (!names.has(name)) throw new Error(`Unknown workflow input: ${name}`);
  for (const binding of bindings) {
    const original = validated.graph[binding.nodeId]!.inputs[binding.input];
    const value = workflowInputs[binding.name];
    if (!Object.hasOwn(workflowInputs, binding.name)) {
      if (validated.inputMode === 'automatic') continue;
      throw new Error(`Required workflow input: ${binding.name}`);
    }
    if (!isComfyLiteral(value) || typeof value !== typeof original || (typeof value === 'string' && value.length > 65_536)) {
      throw new Error(`Workflow input ${binding.name} must be a bounded ${typeof original}`);
    }
    if ('integer' in binding && binding.integer && !Number.isSafeInteger(value)) throw new Error(`Workflow input ${binding.name} must be a safe integer`);
    validated.graph[binding.nodeId]!.inputs[binding.input] = value;
  }
  for (const target of validated.promptTargets) {
    if (validated.inputMode === 'automatic' && bindings.some((binding) => binding.nodeId === target.nodeId
      && binding.input === target.input && Object.hasOwn(workflowInputs, binding.name))) continue;
    validated.graph[target.nodeId]!.inputs[target.input] = prompt;
  }
  return validated.graph;
}
