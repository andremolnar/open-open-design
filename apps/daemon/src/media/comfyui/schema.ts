import { createHash } from 'node:crypto';
import type { ComfyWorkflowDraft, ComfyWorkflowValidation } from '@open-design/contracts';
import { ComfyError } from './errors.js';

export function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Check advertised types/enums, not GPU availability or arbitrary custom-node code. */
export function validateComfySchema(draft: ComfyWorkflowDraft, info: unknown): ComfyWorkflowValidation {
  if (!object(info)) throw new ComfyError('ComfyUI node schemas are unavailable');
  const requiredSchemas: Record<string, unknown> = {};
  const outputNodes: string[] = [];
  for (const [id, node] of Object.entries(draft.graph)) {
    const schema = info[node.class_type];
    if (!object(schema) || !object(schema.input)) {
      throw new ComfyError(`Required node class is unavailable: ${node.class_type}`);
    }
    if (schema.api_node === true || schema.price_badge !== undefined) {
      throw new ComfyError(`Paid/API node is unsupported in this adapter: ${node.class_type}`);
    }
    requiredSchemas[node.class_type] = schema;
    if (schema.output_node === true) {
      if (!['SaveImage', 'PreviewImage'].includes(node.class_type)) {
        throw new ComfyError(`Unsupported executable output branch at node ${id}`);
      }
      outputNodes.push(id);
    }
    const required = object(schema.input.required) ? schema.input.required : {};
    const optional = object(schema.input.optional) ? schema.input.optional : {};
    for (const name of Object.keys(required)) {
      if (!Object.hasOwn(node.inputs, name)) throw new ComfyError(`Missing required input: node ${id}.${name}`);
    }
    for (const [name, value] of Object.entries(node.inputs)) {
      const definition = required[name] ?? optional[name];
      if (!Array.isArray(definition)) throw new ComfyError(`Unknown input: node ${id}.${name}`);
      const type = definition[0];
      const options = object(definition[1]) ? definition[1] : {};
      if (Array.isArray(value)) {
        if (value.length !== 2 || typeof value[0] !== 'string' || !Number.isSafeInteger(value[1]) || Number(value[1]) < 0) {
          throw new ComfyError(`Invalid link: node ${id}.${name}`);
        }
        const source = draft.graph[value[0]];
        const sourceSchema = source ? info[source.class_type] : null;
        const outputs = object(sourceSchema) && Array.isArray(sourceSchema.output) ? sourceSchema.output : [];
        const sourceType = outputs[Number(value[1])];
        if (!sourceType || (type !== '*' && sourceType !== '*' && sourceType !== type)) {
          throw new ComfyError(`Incompatible link: node ${id}.${name}`);
        }
      } else if (Array.isArray(type)) {
        if (!type.includes(value)) throw new ComfyError(`Unavailable model or enum value: node ${id}.${name}`);
      } else if (type === 'STRING') {
        if (typeof value !== 'string') throw new ComfyError(`Expected text: node ${id}.${name}`);
      } else if (type === 'BOOLEAN') {
        if (typeof value !== 'boolean') throw new ComfyError(`Expected boolean: node ${id}.${name}`);
      } else if (type === 'INT' || type === 'FLOAT') {
        if (typeof value !== 'number' || !Number.isFinite(value) || (type === 'INT' && !Number.isSafeInteger(value))
          || (typeof options.min === 'number' && value < options.min)
          || (typeof options.max === 'number' && value > options.max)) {
          throw new ComfyError(`Numeric input out of range: node ${id}.${name}`);
        }
      } else {
        throw new ComfyError(`Input requires a compatible node connection: node ${id}.${name}`);
      }
    }
  }
  if (!outputNodes.includes(draft.output.nodeId)) throw new ComfyError('Selected output must be a SaveImage or PreviewImage output node');
  return {
    checkedAt: Date.now(),
    schemaFingerprint: createHash('sha256').update(JSON.stringify(Object.fromEntries(
      Object.entries(requiredSchemas).sort(([a], [b]) => a.localeCompare(b)),
    ))).digest('hex'),
    outputNodes,
  };
}
