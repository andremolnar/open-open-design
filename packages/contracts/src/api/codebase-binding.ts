import { z } from 'zod';

/** A machine-local association only. It grants no file or execution authority. */
export interface ProjectCodebaseBinding {
  // Kept numeric so a newer local record can be reported as unsupported.
  schemaVersion: number;
  revision: number;
  sourceRoot: string;
  appRelativePath: string;
  updatedAt: number;
}

export type ProjectCodebaseBindingStatus =
  | 'unbound'
  | 'connected'
  | 'unavailable'
  | 'unsupported';

export type ProjectCodebaseBindingReason =
  | 'missing_source'
  | 'missing_app'
  | 'inaccessible_target'
  | 'identity_changed'
  | 'unsafe_path'
  | 'design_storage_overlap'
  | 'runtime_data_overlap'
  | 'sandbox_unavailable'
  | 'design_storage_unavailable'
  | 'unsupported_schema'
  | 'invalid_record';

export interface ProjectCodebaseBindingResponse {
  projectId: string;
  /** Exact authorized request scope for an external host handoff; never UI focus. */
  workspaceScope?: { workspaceId: string; workspaceMemberId: string };
  designStoragePath: string;
  binding: ProjectCodebaseBinding | null;
  status: ProjectCodebaseBindingStatus;
  reason: ProjectCodebaseBindingReason | null;
  message: string | null;
  capabilities: {
    canBind: boolean;
    requiresTrustedPicker: boolean;
  };
}

export const projectCodebaseBindingRequestSchema = z.object({
  sourceRoot: z.string().min(1).max(32_768),
  appRelativePath: z.string().min(1).max(32_768).optional(),
  expectedRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
  /** Optional guard against changing a folder after its canonical preview. */
  expectedSelection: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();

export type PutProjectCodebaseBindingRequest = z.infer<typeof projectCodebaseBindingRequestSchema>;
export type ProjectCodebaseBindingRequest = PutProjectCodebaseBindingRequest;

/** Read-only selection validation, before the user commits a connection. */
export interface ProjectCodebaseBindingSelection {
  sourceRoot: string;
  appRelativePath: string;
  appRoot: string;
  selectionFingerprint: string;
}
