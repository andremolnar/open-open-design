import { z } from 'zod';
import type { ProjectCodebaseBinding, ProjectCodebaseBindingReason } from './codebase-binding.js';

/** Source evidence does not grant filesystem, process, or network authority. */
export interface ProjectSourceEvidence {
  /** Relative to the bound source root, never an arbitrary requested path. */
  path: string;
  kind: 'instruction' | 'manifest' | 'source' | 'component' | 'tokens';
  content: string;
}

export type ProjectSourceContextReason = ProjectCodebaseBindingReason
  | 'unbound' | 'no_match' | 'ambiguous' | 'project_mismatch' | 'binding_changed';

export interface ProjectSourceContextResponse {
  status: 'ready' | 'needs_selection' | 'unavailable';
  projectId: string | null;
  bindingRevision: number | null;
  binding: ProjectCodebaseBinding | null;
  reason: ProjectSourceContextReason | null;
  message: string | null;
  evidence: ProjectSourceEvidence[];
  /** At least one scan, file, or byte budget was exhausted. */
  truncated: boolean;
  limits: { maxFiles: number; maxFileBytes: number; maxTotalBytes: number };
}

/** Exact source/package selection. Omitted appRelativePath means the source root. */
export const projectSourceContextResolveRequestSchema = z.object({
  sourceRoot: z.string().min(1).max(32_768),
  appRelativePath: z.string().min(1).max(32_768).optional(),
  projectId: z.string().min(1).max(256).optional(),
  query: z.string().max(2_000).optional(),
}).strict();

export type ProjectSourceContextResolveRequest = z.infer<typeof projectSourceContextResolveRequestSchema>;
