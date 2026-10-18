export const COMFY_WORKFLOW_MODEL_HELP = 'ComfyUI is a provider, not an executable model. Save and enable a workflow in Settings → Media providers → ComfyUI. Discover saved servers, enabled workflows and required inputs with od media comfyui discover --json (GET /api/media/models). Use the full comfyui/<workflow-id>@<version> model ID, not comfyui. A workflow may prefer a server; a generation can select another with --comfy-server. Do not retry the provider name.';

/** A connection is a server, not a generation model. Several workflows may use it. */
export interface ComfyConnectionInput {
  name: string;
  baseUrl: string;
  /** Deliberate opt-in for an operator-owned loopback/LAN server. */
  trustedNetwork: boolean;
  /** Write-only bearer token; never included in a read response. */
  token?: string;
}

export interface ComfyConnectionSummary {
  id: string;
  name: string;
  baseUrl: string;
  trustedNetwork: boolean;
  hasToken: boolean;
}

export interface ComfyInputTarget {
  nodeId: string;
  input: string;
}

export type ComfyLiteral = string | number | boolean;

/** Explicit public request key; the graph remains an immutable template. */
export interface ComfyParameterBinding extends ComfyInputTarget {
  name: string;
}

export interface ComfyWorkflowParameter {
  name: string;
  type: 'string' | 'number' | 'boolean';
  defaultValue: ComfyLiteral;
  required?: boolean;
  nodeId?: string;
  nodeType?: string;
  input?: string;
  label?: string;
  role?: 'prompt' | 'seed' | 'width' | 'height';
  integer?: boolean;
  usesPrompt?: boolean;
}

/** Derived editor/discovery field; each editable default has a concrete graph target. */
export interface ComfyEditableField extends ComfyWorkflowParameter {
  nodeId: string;
  nodeType: string;
  input: string;
  label: string;
  required: false;
  usesPrompt: boolean;
}

export type ComfyWorkflowInputs = Record<string, ComfyLiteral>;
export const COMFY_MAX_REQUEST_INPUTS = 256;

/** Additional fields on the existing media generation request, not a new dispatcher. */
export interface ComfyMediaRequestInputs {
  workflowInputs?: ComfyWorkflowInputs;
  /** Saved server ID for this submission only; omitted uses the workflow preference or sole server. */
  comfyServerId?: string;
}

/** API-format graph (not the ComfyUI editor's canvas/workflow document). */
export type ComfyApiGraph = Record<string, {
  class_type: string;
  inputs: Record<string, unknown>;
  _meta?: Record<string, unknown>;
}>;

/** OpenDesign owns the reusable graph; servers are selected at execution time. */
export interface ComfyWorkflowDraft {
  name: string;
  /** Optional preferred server. Kept under its existing wire name for saved configuration compatibility. */
  connectionId?: string;
  graph: ComfyApiGraph;
  /** New versions derive conservative editable inputs with optional saved defaults. Omitted preserves legacy mappings. */
  inputMode?: 'automatic';
  promptTargets: ComfyInputTarget[];
  /** Legacy explicit mappings; required when inputMode is omitted. */
  parameters?: ComfyParameterBinding[];
  output: { nodeId: string; index: number };
}

export interface ComfyWorkflowSummary {
  id: string;
  version: number;
  name: string;
  /** Optional preference, never a server lock. */
  connectionId?: string;
  graphSha256: string;
  enabled: boolean;
  inputMode?: 'automatic';
  schemaCheckedAt?: number;
  parameters?: ComfyWorkflowParameter[];
  output?: { nodeId: string; index: number };
}

export interface ComfySettingsResponse {
  connections: ComfyConnectionSummary[];
  workflows: ComfyWorkflowSummary[];
  /** Operator recovery only; each job keeps its original project and server. */
  executions?: Array<ComfyExecutionSummary & { running: boolean }>;
}

/** Agent-safe discovery: editable defaults only, never URLs, credentials, private graph or read-only literals. */
export interface ComfyDiscovery {
  servers: Array<{ id: string; name: string }>;
  workflows: Array<{
    id: string; version: number; name: string; model: string; preferredServerId?: string;
    inputs: Array<Omit<ComfyWorkflowParameter, 'defaultValue' | 'required'> & { required: boolean; defaultValue?: ComfyLiteral }>;
  }>;
}

export interface ComfyWorkflowValidation {
  checkedAt: number;
  schemaFingerprint: string;
  /** All executable image output branches, not just the selected import. */
  outputNodes: string[];
}

export type ComfyExecutionPhase = 'validating' | 'submitting' | 'queued' | 'fetching'
  | 'importing' | 'completed' | 'failed' | 'outcome_unknown';

/** Linked to the existing media task; never a competing task lifecycle. */
export interface ComfyExecutionSummary {
  taskId: string;
  projectId: string;
  model: string;
  /** Recovery always uses this recorded server, not a new preference or override. */
  connectionId: string;
  phase: ComfyExecutionPhase;
  promptId?: string;
  /** Operator overrides local occupancy only; this never means remote cancellation. */
  releasedAt?: number;
}

/** A version is part of the model ID, so a selection never silently becomes latest. */
export function comfyWorkflowModelId(id: string, version: number): string {
  return `comfyui/${id}@${version}`;
}

/** Diagnostics may expose the same public IDs/input types as the model catalog, never graphs. */
export function comfyWorkflowModelHelp(workflows: ComfyWorkflowSummary[]): string {
  const enabled = workflows.filter((workflow) => workflow.enabled).slice(0, 20);
  if (!enabled.length) return `${COMFY_WORKFLOW_MODEL_HELP} No workflows are currently enabled.`;
  return `${COMFY_WORKFLOW_MODEL_HELP} Enabled workflow choices: ${JSON.stringify(enabled.map((workflow) => ({
    model: comfyWorkflowModelId(workflow.id, workflow.version),
    requiredWorkflowInputs: (workflow.parameters ?? []).filter((input) => input.required !== false).map(({ name, type }) => ({ name, type })),
  })))}`;
}

export function parseComfyWorkflowModelId(model: string): { id: string; version: number } | null {
  const match = /^comfyui\/([a-zA-Z0-9-]{1,80})@([1-9][0-9]*)$/.exec(model);
  if (!match || !Number.isSafeInteger(Number(match[2]))) return null;
  return { id: match[1]!, version: Number(match[2]) };
}
