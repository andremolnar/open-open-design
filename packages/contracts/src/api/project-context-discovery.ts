import { z } from 'zod';
import type { ProjectCodebaseBindingReason } from './codebase-binding.js';
import type { WorkspaceType } from './collab.js';

/** Caller cwd is transient input, never daemon/UI cwd or a persisted binding. */
export const projectContextDiscoveryRequestSchema = z.object({
  cwd: z.string().min(1).max(32_768),
  projectId: z.string().min(1).max(256).optional(),
  workspaceId: z.string().min(1).max(256).optional(),
  workspaceMemberId: z.string().min(1).max(256).optional(),
}).strict().refine((request) => Boolean(request.workspaceId) === Boolean(request.workspaceMemberId), {
  message: 'Supply workspaceId and workspaceMemberId together.',
});

export type ProjectContextDiscoveryRequest = z.infer<typeof projectContextDiscoveryRequestSchema>;

/** Verified membership and labels supplied by the authorization boundary. */
export interface ProjectContextDiscoveryWorkspaceScope {
  workspaceId: string;
  workspaceMemberId: string;
  workspaceName: string;
  workspaceType: WorkspaceType;
}

export type ProjectContextDiscoveryReason = ProjectCodebaseBindingReason
  | 'no_match' | 'project_mismatch' | 'ambiguous' | 'binding_changed'
  | 'missing_cwd' | 'inaccessible_cwd' | 'selection_incomplete' | 'path_depth_exceeded';

/** Discovery returns association metadata only, never source evidence. */
export interface ProjectContextDiscoveryCandidate {
  projectId: string;
  projectName: string;
  /** Null is reserved for a legacy project without a workspace binding. */
  workspaceScope: ProjectContextDiscoveryWorkspaceScope | null;
  sourceRoot: string;
  appRelativePath: string;
  /** Null when a malformed saved record has no usable revision. */
  bindingRevision: number | null;
  status: 'ready' | 'unavailable';
  reason: ProjectContextDiscoveryReason | null;
  message: string | null;
  match: 'within_app' | 'ancestor_of_app';
}

export type ProjectContextDiscoveryCoverageScope =
  | 'authorized_projects' | 'explicit_workspace' | 'unbound_local';

export interface ProjectContextDiscoveryResponse {
  status: 'ready' | 'needs_selection' | 'unavailable';
  /** Only one total match, ready and exhaustively scanned, may be selected. */
  selected: ProjectContextDiscoveryCandidate | null;
  candidates: ProjectContextDiscoveryCandidate[];
  reason: ProjectContextDiscoveryReason | null;
  message: string | null;
  truncated: boolean;
  limits: { maxCandidates: number; maxScannedProjects: number; maxPathDepth: number };
  coverage: {
    scope: ProjectContextDiscoveryCoverageScope;
    scannedProjects: number;
    scanTruncated: boolean;
    candidatesTruncated: boolean;
  };
}
