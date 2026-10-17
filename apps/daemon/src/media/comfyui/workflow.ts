import type {
  ComfyApiGraph,
  ComfyInputTarget,
  ComfyWorkflowDraft,
} from '@open-design/contracts';

const MAX_GRAPH_BYTES = 2 * 1024 * 1024;
const MAX_NODES = 500;
const NODE_ID = /^(?:0|[1-9][0-9]*)$/;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function targetKey(target: ComfyInputTarget): string {
  return `${target.nodeId}:${target.input}`;
}

/**
 * Parse an API export without guessing how canvas widget positions map to inputs.
 * This is structural validation only: /object_info must validate classes, types,
 * connected inputs and output capability before a draft can be enabled or run.
 */
export function parseComfyApiGraph(raw: unknown): ComfyApiGraph {
  const size = Buffer.byteLength(typeof raw === 'string' ? raw : JSON.stringify(raw) ?? '');
  if (size > MAX_GRAPH_BYTES) throw new Error('ComfyUI API graph exceeds 2 MiB');

  let graph: unknown = raw;
  if (typeof raw === 'string') {
    try {
      graph = JSON.parse(raw);
    } catch {
      throw new Error('Invalid ComfyUI API JSON');
    }
  }
  if (record(graph) && Array.isArray(graph.nodes)) {
    throw new Error('This is a ComfyUI editor workflow; export the API format instead');
  }
  if (!record(graph) || !Object.keys(graph).length) {
    throw new Error('ComfyUI API graph must contain nodes keyed by node ID');
  }
  const entries = Object.entries(graph);
  if (entries.length > MAX_NODES) throw new Error('ComfyUI API graph exceeds 500 nodes');

  for (const [id, rawNode] of entries) {
    if (!NODE_ID.test(id) || !record(rawNode)
      || typeof rawNode.class_type !== 'string' || !rawNode.class_type.trim()
      || !record(rawNode.inputs)) {
      throw new Error(`Invalid ComfyUI API node ${id}`);
    }
    for (const [input, value] of Object.entries(rawNode.inputs)) {
      if (!input || input === '__proto__' || input === 'constructor' || input === 'prototype') {
        throw new Error(`Invalid ComfyUI input in node ${id}`);
      }
      if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'string'
        && Number.isInteger(value[1]) && NODE_ID.test(value[0])) {
        if (!Object.hasOwn(graph, value[0])) {
          throw new Error(`Node ${id}.${input} links to missing node ${value[0]}`);
        }
      }
    }
  }
  // Clone: callers can bind literals without mutating a stored version.
  return structuredClone(graph) as ComfyApiGraph;
}

export function validateComfyWorkflowDraft(raw: unknown): ComfyWorkflowDraft {
  if (!record(raw)) throw new Error('Workflow must be an object');
  const { name, connectionId, promptTargets, output } = raw;
  if (typeof name !== 'string' || !name.trim() || name.length > 120) {
    throw new Error('Workflow name must be between 1 and 120 characters');
  }
  if (typeof connectionId !== 'string' || !connectionId.trim()) {
    throw new Error('Choose a saved ComfyUI server');
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
  if (!record(output) || typeof output.nodeId !== 'string' || !Object.hasOwn(graph, output.nodeId)
    || output.index !== 0) {
    throw new Error('Choose one output node and image index 0');
  }
  return {
    name: name.trim(),
    connectionId: connectionId.trim(),
    graph,
    promptTargets: promptTargets.map((target: ComfyInputTarget) => ({ nodeId: target.nodeId, input: target.input })),
    output: { nodeId: output.nodeId, index: 0 },
  };
}

/** A prompt is bound only to confirmed literal paths in a fresh graph copy. */
export function bindComfyPrompt(draft: ComfyWorkflowDraft, prompt: string): ComfyApiGraph {
  if (!prompt.trim()) throw new Error('Image prompt is required');
  const validated = validateComfyWorkflowDraft(draft);
  for (const target of validated.promptTargets) {
    validated.graph[target.nodeId]!.inputs[target.input] = prompt;
  }
  return validated.graph;
}
