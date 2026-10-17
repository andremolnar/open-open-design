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

/** API-format graph (not the ComfyUI editor's canvas/workflow document). */
export type ComfyApiGraph = Record<string, {
  class_type: string;
  inputs: Record<string, unknown>;
  _meta?: Record<string, unknown>;
}>;

/** A draft is inert until server schemas have been checked and it is enabled. */
export interface ComfyWorkflowDraft {
  name: string;
  connectionId: string;
  graph: ComfyApiGraph;
  promptTargets: ComfyInputTarget[];
  output: { nodeId: string; index: number };
}

export interface ComfyWorkflowSummary {
  id: string;
  version: number;
  name: string;
  connectionId: string;
  graphSha256: string;
  enabled: boolean;
  schemaCheckedAt?: number;
}

export interface ComfySettingsResponse {
  connections: ComfyConnectionSummary[];
  workflows: ComfyWorkflowSummary[];
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
  phase: ComfyExecutionPhase;
  promptId?: string;
  /** Operator overrides local occupancy only; this never means remote cancellation. */
  releasedAt?: number;
}

/** A version is part of the model ID, so a selection never silently becomes latest. */
export function comfyWorkflowModelId(id: string, version: number): string {
  return `comfyui/${id}@${version}`;
}

export function parseComfyWorkflowModelId(model: string): { id: string; version: number } | null {
  const match = /^comfyui\/([a-zA-Z0-9-]{1,80})@([1-9][0-9]*)$/.exec(model);
  if (!match || !Number.isSafeInteger(Number(match[2]))) return null;
  return { id: match[1]!, version: Number(match[2]) };
}
