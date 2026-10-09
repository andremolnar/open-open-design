import { createHash } from 'node:crypto';
import {
  DESIGN_WORKFLOW_LIMITS,
  prepareDesignContextRequestSchema, getDesignWorkflowRequestSchema,
  getDesignAssetRequestSchema, checkpointDesignWorkflowRequestSchema,
  registerDesignArtifactRequestSchema, archiveDesignWorkflowRequestSchema, type DesignAssetResponse,
} from '@open-design/contracts';

const id = { type: 'string', minLength: 1, maxLength: 256 };
const revision = { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
const digest = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const identity = { projectId: id, workflowId: { type: 'string', format: 'uuid' }, hostSessionId: id };
const pinned = { ...identity, contextRevision: digest };
const mutation = { ...pinned, expectedRevision: revision, requestId: id };
const identityRequired = ['projectId', 'workflowId', 'hostSessionId'];
const mutationRequired = [...identityRequired, 'contextRevision', 'expectedRevision', 'requestId'];

const definitions = [
  {
    name: 'prepare_design_context', action: 'prepare', readOnly: false,
    description: 'Prepare or explicitly refresh a versioned design package for work in the CURRENT coding session. Reuses OpenDesign design expertise, skills and assets; starts no Run. Requires exact connected project/source/package/binding revision, a stable hostSessionId and requestId. Host owns repository rules, edits, tests, approvals and visible progress. Reuse returned workflowId/contextRevision for subsequent calls. Refresh requires workflowId plus expectedRevision.',
    properties: {
      projectId: id, sourceRoot: { type: 'string', minLength: 1, maxLength: 32768 },
      appRelativePath: { type: 'string', minLength: 1, maxLength: 32768, default: '.' },
      expectedBindingRevision: revision, hostSessionId: id, requestId: id,
      prompt: { type: 'string', minLength: 1, maxLength: 8000 },
      capabilities: { type: 'object', properties: { imageContent: { type: 'boolean' }, embeddedResources: { type: 'boolean' } }, required: ['imageContent', 'embeddedResources'], additionalProperties: false },
      workflowId: { type: 'string', format: 'uuid' }, expectedRevision: revision,
    },
    required: ['projectId', 'sourceRoot', 'expectedBindingRevision', 'hostSessionId', 'requestId', 'prompt', 'capabilities'],
  },
  {
    name: 'get_design_workflow', action: 'get', readOnly: true,
    description: 'Resume the exact host-owned design workflow: frozen guidance, manifest, revision, host-reported checkpoints and registered artifacts. Revalidates its source binding. No active-project fallback and no nested coding agent.',
    properties: identity, required: identityRequired,
  },
  {
    name: 'get_design_asset', action: 'asset', readOnly: true,
    description: 'Fetch an asset from the pinned context package. image returns actual original PNG/JPEG/GIF/WebP bytes as MCP image content for visual inspection (at most 2 MiB). original returns an embedded JSON text resource containing an exact base64 byte chunk (default 32 KiB, max 64 KiB), offsets and hashes for host-owned materialization. Reassemble chunks and verify the full original SHA-256. Server filenames/links alone are not image delivery; no asset is copied into the repository by this tool.',
    properties: { ...pinned, assetId: id,
      representation: { type: 'string', enum: ['image', 'original'], default: 'original' },
      offset: { type: 'integer', minimum: 0, maximum: DESIGN_WORKFLOW_LIMITS.maxResourceBytes, default: 0 },
      maxBytes: { type: 'integer', minimum: 1, maximum: 65536, default: 32768 },
    },
    required: [...identityRequired, 'contextRevision', 'assetId'],
  },
  {
    name: 'checkpoint_design_workflow', action: 'checkpoint', readOnly: false,
    description: 'Record bounded progress and check evidence from the CURRENT host session against exact workflow/context revisions. Does not run tests, critique, edit files or invoke another agent. Checks are host-reported; mark failures and not-run stages honestly. Retries with the same requestId must have identical input.',
    properties: { ...mutation, phase: { type: 'string', enum: ['planning', 'implementing', 'critique', 'completed'] },
      summary: { type: 'string', minLength: 1, maxLength: 4000 },
      checks: { type: 'array', maxItems: 32, items: { type: 'object', properties: {
        name: { type: 'string', minLength: 1, maxLength: 200 }, status: { type: 'string', enum: ['passed', 'failed', 'not_run'] }, detail: { type: 'string', maxLength: 1000 },
      }, required: ['name', 'status'], additionalProperties: false } },
    }, required: [...mutationRequired, 'phase', 'summary'],
  },
  {
    name: 'register_design_artifact', action: 'register-artifact', readOnly: false,
    description: 'Explicitly register an EXISTING artifact in this exact OpenDesign project after verifying its current SHA-256. Use existing create_artifact separately if the user authorized saving a preview. This does not read source paths, promote assets, copy host files or overwrite an artifact. Revision-checked and idempotent by requestId.',
    properties: { ...mutation, name: { type: 'string', minLength: 1, maxLength: 1024 }, sha256: digest },
    required: [...mutationRequired, 'name', 'sha256'],
  },
  {
    name: 'archive_design_workflow', action: 'archive', readOnly: false,
    description: 'Explicitly discard this workflow’s frozen guidance and resource cache to free capacity. Requires confirm:true and exact session/context/revision. Keeps a small replay-protection tombstone; archived handles cannot resume. Original design assets, registered project files and source files are untouched. Start a new workflow for future work.',
    properties: { ...mutation, confirm: { type: 'boolean', const: true } },
    required: [...mutationRequired, 'confirm'],
  },
] as const;

export const DESIGN_WORKFLOW_MCP_TOOL_DEFS = definitions.map((definition) => ({
  name: definition.name, description: definition.description,
  inputSchema: { type: 'object' as const, properties: { ...definition.properties,
    workspaceId: { ...id, description: 'Optional exact workspace ID; workspaceMemberId is required with it. Use the saved connection scope for Team projects.' },
    workspaceMemberId: { ...id, description: 'Exact active member ID paired with workspaceId, verified against the daemon directory.' },
  }, required: [...definition.required], additionalProperties: false },
  annotations: { title: definition.name.replaceAll('_', ' '), readOnlyHint: definition.readOnly, idempotentHint: true, destructiveHint: definition.action === 'archive', openWorldHint: false },
}));
export const DESIGN_WORKFLOW_MCP_NAMES = new Set<string>(definitions.map((definition) => definition.name));

export function designWorkflowMcpScope(args: Record<string, unknown>): { workspaceId: string; workspaceMemberId: string } | null {
  if (args.workspaceId === undefined && args.workspaceMemberId === undefined) return null;
  if (typeof args.workspaceId !== 'string' || !args.workspaceId.trim() || args.workspaceId.length > 256
    || typeof args.workspaceMemberId !== 'string' || !args.workspaceMemberId.trim() || args.workspaceMemberId.length > 256) {
    throw new Error('Provide both exact workspaceId and workspaceMemberId; no default scope is allowed for a partial pair.');
  }
  return { workspaceId: args.workspaceId, workspaceMemberId: args.workspaceMemberId };
}

export function designWorkflowMcpRequest(name: string, args: unknown): { path: string; body: Record<string, unknown> } {
  const definition = definitions.find((entry) => entry.name === name);
  if (!definition) throw new Error('Unknown design workflow tool');
  const schemas = {
    prepare: prepareDesignContextRequestSchema, get: getDesignWorkflowRequestSchema,
    asset: getDesignAssetRequestSchema, checkpoint: checkpointDesignWorkflowRequestSchema,
    'register-artifact': registerDesignArtifactRequestSchema,
    archive: archiveDesignWorkflowRequestSchema,
  };
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Provide an object request');
  designWorkflowMcpScope(args as Record<string, unknown>);
  const { workspaceId: _workspace, workspaceMemberId: _member, ...body } = args as Record<string, unknown>;
  const parsed = schemas[definition.action].safeParse(body);
  if (!parsed.success) throw new Error(`Invalid ${name} request: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`);
  return { path: `/api/projects/${encodeURIComponent(parsed.data.projectId)}/design-workflow/${definition.action}`, body: parsed.data };
}

export type DesignMcpSupplement =
  | { type: 'image'; data: string; mimeType: string; text?: never }
  | { type: 'resource'; resource: { uri: string; mimeType: string; text: string }; text?: never };

/** Preserve actual bytes in MCP content even when structured metadata is present. */
export function designAssetMcpResult(payload: DesignAssetResponse): {
  content: [{ type: 'text'; text: string }, DesignMcpSupplement];
  structuredContent: Record<string, unknown>;
} {
  const maxBytes = payload.representation === 'image' ? DESIGN_WORKFLOW_LIMITS.maxResourceBytes : 65536;
  if (typeof payload.base64 !== 'string' || payload.base64.length > Math.ceil(maxBytes / 3) * 4
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload.base64)) {
    throw new Error('Invalid or oversized design asset payload');
  }
  const bytes = Buffer.from(payload.base64, 'base64');
  if (bytes.length > maxBytes || createHash('sha256').update(bytes).digest('hex') !== payload.chunkSha256) {
    throw new Error('Design asset chunk hash mismatch');
  }
  const { base64, ...metadata } = payload;
  const uri = `od://projects/${encodeURIComponent(payload.projectId)}/design-workflows/${payload.workflowId}/${payload.contextRevision}/${encodeURIComponent(payload.resource.id)}?offset=${payload.offset}`;
  let attachment: DesignMcpSupplement;
  if (payload.representation === 'image') {
    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(payload.resource.mimeType)
      || payload.offset !== 0 || payload.nextOffset !== null || bytes.length !== payload.resource.bytes
      || payload.chunkSha256 !== payload.resource.sha256) throw new Error('Invalid original image payload');
    attachment = { type: 'image', data: base64, mimeType: payload.resource.mimeType };
  } else {
    attachment = { type: 'resource', resource: {
      uri, mimeType: 'application/json', text: JSON.stringify({ ...metadata, base64 }),
    } };
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(metadata) }, attachment],
    structuredContent: metadata,
  };
}
