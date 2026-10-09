import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type {
  ProjectContextDiscoveryCandidate, ProjectContextDiscoveryCoverageScope,
  ProjectContextDiscoveryReason, ProjectContextDiscoveryRequest,
  ProjectContextDiscoveryResponse, ProjectContextDiscoveryWorkspaceScope,
} from '@open-design/contracts';
import { getCodebaseBinding, type StoredCodebaseBinding } from '../storage/codebase-binding.js';
import { codebaseBindingStatus, type CodebaseBindingPaths } from './codebase-binding.js';

/** Authorization and exact membership resolution are the caller's responsibility. */
export interface ProjectContextDiscoveryProject {
  id: string;
  name: string;
  metadata?: { baseDir?: string };
  workspaceScope: ProjectContextDiscoveryWorkspaceScope | null;
}

export interface ProjectContextDiscoveryOptions {
  /** Includes an incomplete upstream authorization/catalog scan. */
  scanTruncated?: boolean;
  coverageScope?: ProjectContextDiscoveryCoverageScope;
  /** Synchronous freshness fence supplied by the same authorization boundary. */
  isProjectAuthorized?: (project: ProjectContextDiscoveryProject) => boolean;
}

export const PROJECT_CONTEXT_DISCOVERY_LIMITS = Object.freeze({
  maxCandidates: 64, maxScannedProjects: 2_048, maxPathDepth: 128,
});

const EXCLUDED_SEGMENTS = new Set([
  'node_modules', 'bower_components', '.git', '.hg', '.svn', '.ssh', '.aws',
  '.gnupg', '.kube', '.docker', '.next', '.nuxt', '.npm', '.yarn', '.pnpm',
]);
const CREDENTIAL_SEGMENT = /(?:^|[._-])(?:secrets?|credentials?|passwords?|private[._-]?key|service[._-]?account|id_rsa|id_ed25519)(?:[._-]|$)/i;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const CAPABILITIES = { canBind: false, requiresTrustedPicker: false };

function boundedText(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= limit && !CONTROL.test(value);
}

/** IDs stay exact. Malformed or oversized authority metadata cannot be returned. */
function validAuthorityMetadata(project: ProjectContextDiscoveryProject): boolean {
  const scope = project.workspaceScope;
  return boundedText(project.id, 256) && boundedText(project.name, 1_024)
    && (scope === null || (Boolean(scope) && boundedText(scope.workspaceId, 256)
      && boundedText(scope.workspaceMemberId, 256) && boundedText(scope.workspaceName, 1_024)
      && (scope.workspaceType === 'personal' || scope.workspaceType === 'team')));
}

function contains(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/** Pure lexical validation: never inspect a caller path to find an association. */
function absolutePath(input: string): string | null {
  if (!input.trim() || input.length > 32_768 || CONTROL.test(input) || !path.isAbsolute(input)) return null;
  if (path.sep === '/') {
    if (input.includes('\\') || input.startsWith('//') || /^[a-z]:/i.test(input)) return null;
  } else if (!/^[a-z]:[\\/]/i.test(input) && !/^\\\\[^\\?.]+\\[^\\]+/.test(input)) return null;
  if (input.replace(/\\/g, '/').split('/').includes('..')) return null;
  return path.resolve(input);
}

function appPath(source: string, relative: string): string | null {
  if (!relative || relative.length > 32_768 || CONTROL.test(relative) || relative.includes('\\')
    || path.posix.isAbsolute(relative) || path.win32.isAbsolute(relative) || /^[a-z]:/i.test(relative)) return null;
  const segments = relative.split('/');
  if (segments.includes('..')) return null;
  // Saved paths must already use the canonical relative representation.
  if ((segments.filter((segment) => segment && segment !== '.').join('/') || '.') !== relative) return null;
  const app = path.resolve(source, relative);
  return contains(source, app) ? app : null;
}

function segments(absolute: string): string[] {
  return absolute.slice(path.parse(absolute).root.length).split(path.sep).filter(Boolean);
}

function pathProblem(absolute: string): ProjectContextDiscoveryReason | null {
  const parts = segments(absolute);
  if (parts.length > PROJECT_CONTEXT_DISCOVERY_LIMITS.maxPathDepth) return 'path_depth_exceeded';
  return parts.some((part) => EXCLUDED_SEGMENTS.has(part.toLowerCase()) || CREDENTIAL_SEGMENT.test(part)
    || /^\.env(?:[._-]|$)/i.test(part)) ? 'unsafe_path' : null;
}

function diagnostic(reason: ProjectContextDiscoveryReason): string {
  switch (reason) {
    case 'missing_cwd': return 'The caller working directory is missing or is not a directory.';
    case 'inaccessible_cwd': return 'The caller working directory cannot be inspected. Check access and try again.';
    case 'path_depth_exceeded': return 'The directory depth exceeds the discovery limit. Select a shallower source/package directory.';
    case 'binding_changed': return 'The source connection changed during discovery. Request discovery again.';
    default: return 'The directory cannot be used safely. Select an ordinary source directory without symlinks or excluded paths.';
  }
}

type DirectoryIdentity = { dev: bigint; ino: bigint; birthtimeNs: bigint };
function identity(info: DirectoryIdentity): string {
  return `${info.dev}:${info.ino}:${info.birthtimeNs}`;
}

interface CheckedDirectory { identity: string }

/** Null means authorization changed; never return that candidate's metadata. */
async function checkDirectory(
  source: string, directory: string, sourceIdentity: string | null,
  canInspect: () => boolean, expectedIdentity?: string,
): Promise<CheckedDirectory | ProjectContextDiscoveryReason | null> {
  try {
    if (!canInspect()) return null;
    let current = source;
    let info = await fs.lstat(current, { bigint: true });
    if (!canInspect()) return null;
    if (info.isSymbolicLink()) return 'unsafe_path';
    if (!info.isDirectory()) return 'missing_cwd';
    if (sourceIdentity !== null && identity(info) !== sourceIdentity) return 'identity_changed';
    const canonicalSource = await fs.realpath(source);
    if (!canInspect()) return null;
    if (canonicalSource !== source) return 'unsafe_path';
    for (const part of path.relative(source, directory).split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      info = await fs.lstat(current, { bigint: true });
      if (!canInspect()) return null;
      if (info.isSymbolicLink()) return 'unsafe_path';
      if (!info.isDirectory()) return 'missing_cwd';
    }
    const currentIdentity = identity(info);
    if (expectedIdentity !== undefined && currentIdentity !== expectedIdentity) return 'identity_changed';
    const canonicalDirectory = await fs.realpath(directory);
    if (!canInspect()) return null;
    if (canonicalDirectory !== directory) return 'unsafe_path';
    await fs.access(directory, constants.R_OK | constants.X_OK);
    if (!canInspect()) return null;
    return { identity: currentIdentity };
  } catch (error) {
    if (!canInspect()) return null;
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'ENOENT' || code === 'ENOTDIR' ? 'missing_cwd' : 'inaccessible_cwd';
  }
}

function unavailable(candidate: ProjectContextDiscoveryCandidate, reason: ProjectContextDiscoveryReason, message = diagnostic(reason)): ProjectContextDiscoveryCandidate {
  return { ...candidate, status: 'unavailable', reason, message };
}

interface MatchedProject {
  project: ProjectContextDiscoveryProject;
  binding: StoredCodebaseBinding;
  app: string;
  candidate: ProjectContextDiscoveryCandidate;
}

async function inspectMatch(
  db: Database.Database, paths: CodebaseBindingPaths, cwd: string,
  match: MatchedProject, canInspect: () => boolean,
): Promise<ProjectContextDiscoveryCandidate | null> {
  const { project, binding, candidate, app } = match;
  if (!canInspect()) return null;
  const unchanged = () => JSON.stringify(getCodebaseBinding(db, project.id)) === JSON.stringify(binding);
  // A prior candidate may have yielded while this binding was changed. Never
  // inspect the new target before noticing it is not the lexical saved match.
  if (!unchanged()) return unavailable(candidate, 'binding_changed');
  const problem = pathProblem(binding.sourceRoot) ?? pathProblem(app) ?? pathProblem(cwd);
  if (problem) return unavailable(candidate, problem);
  const initial = await codebaseBindingStatus(db, project, paths, CAPABILITIES);
  if (!canInspect()) return null;
  if (!unchanged()) return unavailable(candidate, 'binding_changed');
  if (initial.status !== 'connected') return unavailable(candidate, initial.reason ?? 'binding_changed', initial.message ?? diagnostic('binding_changed'));
  const checkedApp = await checkDirectory(binding.sourceRoot, app, binding.sourceIdentity, canInspect);
  if (checkedApp === null) return null;
  if (typeof checkedApp === 'string') return unavailable(candidate, checkedApp);
  const checkedCwd = await checkDirectory(binding.sourceRoot, cwd, binding.sourceIdentity, canInspect);
  if (checkedCwd === null) return null;
  if (typeof checkedCwd === 'string') return unavailable(candidate, checkedCwd);
  // Check both association and identity after asynchronous cwd validation,
  // before codebaseBindingStatus can inspect a concurrently rebound target.
  if (!canInspect()) return null;
  if (!unchanged()) return unavailable(candidate, 'binding_changed');
  const final = await codebaseBindingStatus(db, project, paths, CAPABILITIES);
  if (!canInspect()) return null;
  if (!unchanged()) return unavailable(candidate, 'binding_changed');
  if (final.status !== 'connected') return unavailable(candidate, final.reason ?? 'binding_changed', final.message ?? diagnostic('binding_changed'));
  const finalApp = await checkDirectory(binding.sourceRoot, app, binding.sourceIdentity, canInspect, checkedApp.identity);
  if (finalApp === null) return null;
  if (typeof finalApp === 'string') return unavailable(candidate, finalApp);
  const finalCwd = await checkDirectory(binding.sourceRoot, cwd, binding.sourceIdentity, canInspect, checkedCwd.identity);
  if (finalCwd === null) return null;
  return typeof finalCwd === 'string' ? unavailable(candidate, finalCwd) : candidate;
}

/**
 * Discover only among already-authorized, saved bindings. No cwd persistence,
 * source evidence, writes, directory enumeration, subprocesses, Git or network.
 * Multiple total matches always require selection, including stale matches.
 */
export async function discoverProjectContext(
  db: Database.Database,
  authorizedProjects: readonly ProjectContextDiscoveryProject[],
  paths: CodebaseBindingPaths,
  request: ProjectContextDiscoveryRequest,
  options: ProjectContextDiscoveryOptions = {},
): Promise<ProjectContextDiscoveryResponse> {
  const response: ProjectContextDiscoveryResponse = {
    status: 'needs_selection', selected: null, candidates: [], reason: null, message: null,
    truncated: false, limits: { ...PROJECT_CONTEXT_DISCOVERY_LIMITS },
    coverage: { scope: options.coverageScope ?? 'authorized_projects', scannedProjects: 0,
      scanTruncated: options.scanTruncated === true, candidatesTruncated: false },
  };
  const cwd = absolutePath(request.cwd);
  const invalidScope = Boolean(request.workspaceId) !== Boolean(request.workspaceMemberId);
  const cwdProblem = cwd ? pathProblem(cwd) : 'unsafe_path';
  if (invalidScope || cwdProblem) {
    const reason = cwdProblem ?? 'unsafe_path';
    return { ...response, status: 'unavailable', reason, message: diagnostic(reason), truncated: response.coverage.scanTruncated };
  }
  const matches: MatchedProject[] = [];
  const seen = new Set<string>();
  const explicitProjects: ProjectContextDiscoveryProject[] = [];
  const scanLength = Math.min(authorizedProjects.length, PROJECT_CONTEXT_DISCOVERY_LIMITS.maxScannedProjects);
  response.coverage.scanTruncated ||= authorizedProjects.length > scanLength;
  for (let index = 0; index < scanLength; index += 1) {
    const project = authorizedProjects[index]!;
    response.coverage.scannedProjects += 1;
    if (request.projectId && project.id !== request.projectId) continue;
    if (request.workspaceId && (project.workspaceScope?.workspaceId !== request.workspaceId
      || project.workspaceScope.workspaceMemberId !== request.workspaceMemberId)) continue;
    if (options.isProjectAuthorized && !options.isProjectAuthorized(project)) continue;
    if (!validAuthorityMetadata(project)) {
      response.coverage.scanTruncated = true;
      continue;
    }
    const key = JSON.stringify([project.id, project.workspaceScope?.workspaceId, project.workspaceScope?.workspaceMemberId]);
    if (seen.has(key)) continue;
    seen.add(key);
    if (project.id === request.projectId) explicitProjects.push(project);
    const binding = getCodebaseBinding(db, project.id);
    if (!binding || typeof binding.sourceRoot !== 'string' || typeof binding.appRelativePath !== 'string'
      || absolutePath(binding.sourceRoot) !== binding.sourceRoot || !contains(binding.sourceRoot, cwd!)) continue;
    const app = appPath(binding.sourceRoot, binding.appRelativePath);
    if (!app || (!contains(app, cwd!) && !contains(cwd!, app))) continue;
    if (matches.length >= PROJECT_CONTEXT_DISCOVERY_LIMITS.maxCandidates) {
      response.coverage.candidatesTruncated = true;
      break;
    }
    matches.push({ project, binding, app, candidate: {
      projectId: project.id, projectName: project.name,
      workspaceScope: project.workspaceScope ? { ...project.workspaceScope } : null,
      sourceRoot: binding.sourceRoot, appRelativePath: binding.appRelativePath,
      bindingRevision: Number.isSafeInteger(binding.revision) && binding.revision > 0 ? binding.revision : null,
      status: 'ready', reason: null, message: null,
      match: contains(app, cwd!) ? 'within_app' : 'ancestor_of_app',
    } });
  }
  const inspected: { match: MatchedProject; candidate: ProjectContextDiscoveryCandidate }[] = [];
  for (const match of matches) {
    const canInspect = () => options.isProjectAuthorized?.(match.project) ?? true;
    const candidate = await inspectMatch(db, paths, cwd!, match, canInspect);
    if (candidate) inspected.push({ match, candidate });
  }
  // Fence authorization and saved revisions synchronously after all async work.
  // A revoked candidate contributes no labels, IDs, paths or diagnostics.
  for (const { match, candidate } of inspected) {
    if (options.isProjectAuthorized && !options.isProjectAuthorized(match.project)) continue;
    response.candidates.push(JSON.stringify(getCodebaseBinding(db, candidate.projectId)) === JSON.stringify(match.binding)
      ? candidate : unavailable(candidate, 'binding_changed'));
  }
  response.truncated = response.coverage.scanTruncated || response.coverage.candidatesTruncated;
  if (response.truncated) return { ...response, reason: 'selection_incomplete',
    message: 'Discovery could not inspect every eligible connection within its limits. Narrow the workspace or select a project explicitly before continuing.' };
  const explicitProjectFound = explicitProjects.some((project) => options.isProjectAuthorized?.(project) ?? true);
  if (response.candidates.length === 0) return { ...response, reason: explicitProjectFound ? 'project_mismatch' : 'no_match',
    message: 'No authorized saved project connection matches this working directory. Select a project and connect its source.' };
  if (response.candidates.length > 1) return { ...response, reason: 'ambiguous',
    message: 'Multiple authorized project connections match this directory. Select a project explicitly before continuing.' };
  const candidate = response.candidates[0]!;
  if (candidate.status !== 'ready') return { ...response, status: 'unavailable', reason: candidate.reason, message: candidate.message };
  return { ...response, status: 'ready', selected: candidate };
}
