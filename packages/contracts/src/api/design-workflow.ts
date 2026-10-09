import { z } from 'zod';

/** Host-owned execution: this protocol never grants source writes or starts a Run. */
export const DESIGN_WORKFLOW_VERSION = 1 as const;
export const DESIGN_WORKFLOW_LIMITS = {
  maxResources: 128,
  maxResourceBytes: 2 * 1024 * 1024,
  maxPackageBytes: 16 * 1024 * 1024,
  maxGuidanceBytes: 128 * 1024,
  maxCheckpoints: 64,
} as const;

const id = z.string().min(1).max(256);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const identity = {
  projectId: id,
  workflowId: z.string().uuid(),
  hostSessionId: id,
};

export const prepareDesignContextRequestSchema = z.object({
  projectId: id,
  sourceRoot: z.string().min(1).max(32_768),
  appRelativePath: z.string().min(1).max(32_768).default('.'),
  expectedBindingRevision: revision,
  hostSessionId: id,
  requestId: id,
  prompt: z.string().min(1).max(8_000),
  capabilities: z.object({
    imageContent: z.boolean(),
    embeddedResources: z.boolean(),
  }).strict(),
  /** Refresh the same workflow explicitly; previous context handles become stale. */
  workflowId: z.string().uuid().optional(),
  expectedRevision: revision.optional(),
}).strict().refine((value) => Boolean(value.workflowId) === Boolean(value.expectedRevision), {
  message: 'workflowId and expectedRevision are required together for refresh',
});

export const getDesignWorkflowRequestSchema = z.object(identity).strict();
export const getDesignAssetRequestSchema = z.object({
  ...identity,
  contextRevision: digest,
  assetId: id,
  representation: z.enum(['image', 'original']).default('original'),
  offset: z.number().int().min(0).max(DESIGN_WORKFLOW_LIMITS.maxResourceBytes).default(0),
  maxBytes: z.number().int().min(1).max(65_536).default(32_768),
}).strict();

export const checkpointDesignWorkflowRequestSchema = z.object({
  ...identity,
  contextRevision: digest,
  expectedRevision: revision,
  requestId: id,
  phase: z.enum(['planning', 'implementing', 'critique', 'completed']),
  summary: z.string().min(1).max(4_000),
  checks: z.array(z.object({
    name: z.string().min(1).max(200),
    status: z.enum(['passed', 'failed', 'not_run']),
    detail: z.string().max(1_000).optional(),
  }).strict()).max(32).default([]),
}).strict();

/** Register an existing managed artifact, never read/write a host source path. */
export const registerDesignArtifactRequestSchema = z.object({
  ...identity,
  contextRevision: digest,
  expectedRevision: revision,
  requestId: id,
  name: z.string().min(1).max(1_024),
  sha256: digest,
}).strict();

/** Explicitly discard a frozen context cache, retaining replay-protection tombstones. */
export const archiveDesignWorkflowRequestSchema = z.object({
  ...identity,
  contextRevision: digest,
  expectedRevision: revision,
  requestId: id,
  confirm: z.literal(true),
}).strict();

export type PrepareDesignContextRequest = z.infer<typeof prepareDesignContextRequestSchema>;
export type GetDesignWorkflowRequest = z.infer<typeof getDesignWorkflowRequestSchema>;
export type GetDesignAssetRequest = z.infer<typeof getDesignAssetRequestSchema>;
export type CheckpointDesignWorkflowRequest = z.infer<typeof checkpointDesignWorkflowRequestSchema>;
export type RegisterDesignArtifactRequest = z.infer<typeof registerDesignArtifactRequestSchema>;
export type ArchiveDesignWorkflowRequest = z.infer<typeof archiveDesignWorkflowRequestSchema>;

export interface DesignGuidanceSection {
  id: string;
  title: string;
  /** Ordered reference material, subordinate to host/project instructions. */
  authority: 'host_contract' | 'design_reference';
  content: string;
  sha256: string;
}

export interface DesignResourceManifestEntry {
  id: string;
  name: string;
  role: 'design_system' | 'skill_sidefile' | 'project_asset' | 'guidance';
  provenance: string;
  mimeType: string;
  bytes: number;
  sha256: string;
  required: boolean;
  /** The frozen original; no silent preview conversion or server path handoff. */
  transformed: false;
  representations: Array<'image' | 'original'>;
}

export interface DesignWorkflowContext {
  version: typeof DESIGN_WORKFLOW_VERSION;
  executionOwner: 'host';
  projectId: string;
  workflowId: string;
  hostSessionId: string;
  revision: number;
  contextRevision: string;
  bindingRevision: number;
  sourceRoot: string;
  appRelativePath: string;
  prompt: string;
  guidance: DesignGuidanceSection[];
  resources: DesignResourceManifestEntry[];
  preflight: string[];
  critique: string[];
  adaptations: Array<{ original: string; host: string }>;
  missingCapabilities: string[];
  warnings: string[];
  truncated: boolean;
  limits: typeof DESIGN_WORKFLOW_LIMITS;
  phase: 'prepared' | 'archived' | CheckpointDesignWorkflowRequest['phase'];
  checkpoints: Array<{
    revision: number;
    contextRevision: string;
    phase: CheckpointDesignWorkflowRequest['phase'];
    summary: string;
    checks: CheckpointDesignWorkflowRequest['checks'];
  }>;
  artifacts: Array<{ name: string; sha256: string; bytes: number; contextRevision: string }>;
}

export interface DesignAssetResponse {
  version: typeof DESIGN_WORKFLOW_VERSION;
  projectId: string;
  workflowId: string;
  contextRevision: string;
  resource: DesignResourceManifestEntry;
  representation: 'image' | 'original';
  /** Actual bytes, not a path or URL. Both representations preserve the original hash. */
  base64: string;
  offset: number;
  totalBytes: number;
  nextOffset: number | null;
  chunkSha256: string;
}
