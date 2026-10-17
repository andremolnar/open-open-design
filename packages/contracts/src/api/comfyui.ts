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
