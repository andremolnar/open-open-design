import type { ComfyApiGraph, ComfyLiteral } from './comfyui.js';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isComfyLiteral(value: unknown): value is ComfyLiteral {
  return typeof value === 'string' || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value));
}

/** Read API exports or /prompt envelopes; never guess canvas widget positions. */
export function parseComfyGraphDocument(raw: unknown): ComfyApiGraph {
  let graph: unknown = raw;
  if (typeof raw === 'string') {
    if (raw.length > 2 * 1024 * 1024) throw new Error('ComfyUI API graph exceeds 2 MiB');
    try { graph = JSON.parse(raw); } catch { throw new Error('Invalid ComfyUI API JSON'); }
  }
  if (record(graph) && record(graph.prompt)) graph = graph.prompt;
  if (record(graph) && Array.isArray(graph.nodes)) throw new Error('This is a ComfyUI editor workflow; export the API format instead');
  if (!record(graph) || !Object.keys(graph).length) throw new Error('ComfyUI API graph must contain nodes keyed by node ID');
  if (Object.keys(graph).length > 500) throw new Error('ComfyUI API graph exceeds 500 nodes');
  for (const [id, node] of Object.entries(graph)) {
    if (!/^(?:0|[1-9][0-9]*)$/.test(id) || !record(node)
      || typeof node.class_type !== 'string' || !node.class_type.trim() || !record(node.inputs)) {
      throw new Error(`Invalid ComfyUI API node ${id}`);
    }
    for (const [input, value] of Object.entries(node.inputs)) {
      if (!input || ['__proto__', 'constructor', 'prototype'].includes(input)) throw new Error(`Invalid ComfyUI input in node ${id}`);
      if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'string'
        && Number.isInteger(value[1]) && /^(?:0|[1-9][0-9]*)$/.test(value[0]) && !Object.hasOwn(graph, value[0])) {
        throw new Error(`Node ${id}.${input} links to missing node ${value[0]}`);
      }
    }
  }
  return structuredClone(graph) as ComfyApiGraph;
}
