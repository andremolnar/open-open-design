import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { access, lstat, realpath, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type {
  ProjectCodebaseBindingReason,
  ProjectCodebaseBindingResponse,
  ProjectCodebaseBindingSelection,
  PutProjectCodebaseBindingRequest,
} from '@open-design/contracts';
import { isBlocked } from '../linked-dirs.js';
import { resolveProjectDir } from '../projects.js';
import {
  isSandboxModeEnabled,
  sandboxImportAllowedRoots,
  sandboxImportedProjectRootUnavailableReason,
} from '../sandbox-mode.js';
import { getCodebaseBinding, type StoredCodebaseBinding } from '../storage/codebase-binding.js';

interface BindingProject {
  id: string;
  metadata?: { baseDir?: string };
}

export interface CodebaseBindingPaths {
  projectsRoot: string;
  runtimeDataRoot: string;
}

export interface ValidatedCodebaseBinding extends ProjectCodebaseBindingSelection {
  sourceIdentity: string | null;
  appIdentity: string | null;
}

export class CodebaseBindingValidationError extends Error {
  constructor(public readonly reason: ProjectCodebaseBindingReason, message: string) {
    super(message);
  }
}

/** Separator-aware containment; sibling prefixes are never children. */
function contains(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function overlaps(first: string, second: string): boolean {
  return contains(first, second) || contains(second, first);
}

function reject(reason: ProjectCodebaseBindingReason, message: string): never {
  throw new CodebaseBindingValidationError(reason, message);
}

function appRelativePath(input: string): string {
  // Treat either separator as a separator on all hosts. Windows-shaped paths
  // must never become an innocent-looking relative filename on Unix.
  if (!input || input.includes('\0') || path.posix.isAbsolute(input)
    || path.win32.isAbsolute(input) || /^[a-z]:/i.test(input)) {
    return reject('unsafe_path', 'App/package folder must be a relative folder inside the source.');
  }
  const segments = input.replace(/\\/g, '/').split('/');
  if (segments.includes('..')) {
    return reject('unsafe_path', 'App/package folder cannot contain parent-directory traversal.');
  }
  return segments.filter((segment) => segment && segment !== '.').join('/') || '.';
}

async function directory(input: string, missingReason: 'missing_source' | 'missing_app') {
  try {
    const canonical = await realpath(input);
    const info = await stat(canonical, { bigint: true });
    if (!info.isDirectory()) return reject(missingReason, 'The selected path is not a directory. Choose another folder.');
    // A read-only source is valid. Do not request write access or write probes.
    await access(canonical, constants.R_OK | constants.X_OK);
    const identity = info.ino === 0n ? null : `${info.dev}:${info.ino}:${info.birthtimeNs}`;
    return { canonical, identity };
  } catch (error) {
    if (error instanceof CodebaseBindingValidationError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return reject(missingReason, missingReason === 'missing_source'
        ? 'The connected source folder is missing or moved. Choose its new location to reconnect.'
        : 'The app/package folder is missing. Choose the source again and select an existing package.');
    }
    return reject('inaccessible_target', 'The selected folder cannot be read. Check access, then choose it again.');
  }
}

/** Resolve an as-yet-uncreated design directory without creating or repairing it. */
async function canonicalExistingAncestor(input: string): Promise<string> {
  try {
    return await realpath(input);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    // realpath also reports ENOENT for a dangling symlink. It is not a missing
    // ordinary directory: appending its name to the parent's canonical path
    // would hide where future design writes actually land.
    try {
      const entry = await lstat(input);
      if (entry.isSymbolicLink()) throw new Error('design storage contains an unresolved symlink');
    } catch (entryError) {
      if ((entryError as NodeJS.ErrnoException).code !== 'ENOENT') throw entryError;
    }
    const parent = path.dirname(input);
    if (parent === input) throw error;
    return path.join(await canonicalExistingAncestor(parent), path.basename(input));
  }
}

function designStoragePath(project: BindingProject, paths: CodebaseBindingPaths): string {
  try {
    return resolveProjectDir(paths.projectsRoot, project.id, project.metadata);
  } catch {
    // Only a display value on an unsupported imported project. Never use the
    // managed-root fallback as a replacement for its unavailable design store.
    return project.metadata?.baseDir ?? path.join(paths.projectsRoot, project.id);
  }
}

async function allowedRoot(source: string, paths: CodebaseBindingPaths, designPath: string): Promise<void> {
  let home = os.homedir();
  try { home = await realpath(home); } catch { /* No additional home access is granted. */ }
  if (isBlocked(source) || source === home) {
    reject('unsafe_path', 'System directories and the home directory cannot be connected. Choose a source folder.');
  }
  for (const name of ['.ssh', '.aws', '.gnupg', '.kube', '.docker']) {
    const literal = path.join(home, name);
    let canonical = literal;
    try { canonical = await realpath(literal); } catch { /* Missing credential directory. */ }
    if (contains(literal, source) || contains(canonical, source)) {
      reject('unsafe_path', 'Credential directories cannot be connected. Choose a source folder.');
    }
  }
  const sandboxReason = sandboxImportedProjectRootUnavailableReason(source);
  if (sandboxReason) reject('sandbox_unavailable', sandboxReason);
  let designRoot: string;
  let dataRoot: string;
  try {
    designRoot = await canonicalExistingAncestor(path.resolve(designPath));
    dataRoot = await canonicalExistingAncestor(path.resolve(paths.runtimeDataRoot));
  } catch {
    return reject('design_storage_unavailable', 'Design storage cannot be checked. Restore access before connecting a codebase.');
  }
  if (overlaps(source, designRoot)) {
    reject('design_storage_overlap', 'Source and design storage must be separate folders, with neither inside the other. Design files stay in their current location.');
  }
  if (overlaps(source, dataRoot)) {
    reject('runtime_data_overlap', 'The source folder cannot contain or be inside OpenDesign runtime data. Choose a separate source folder.');
  }
}

/** Filesystem validation only: no mkdir, recursive scan, Git, scripts or source writes. */
export async function validateCodebaseBinding(
  project: BindingProject,
  paths: CodebaseBindingPaths,
  input: Pick<PutProjectCodebaseBindingRequest, 'sourceRoot' | 'appRelativePath'>,
): Promise<ValidatedCodebaseBinding> {
  if (!input.sourceRoot.trim() || input.sourceRoot.includes('\0') || !path.isAbsolute(input.sourceRoot)) {
    return reject('unsafe_path', 'Source folder must be an absolute directory path.');
  }
  const relative = appRelativePath(input.appRelativePath ?? '.');
  const source = await directory(input.sourceRoot, 'missing_source');
  const designPath = designStoragePath(project, paths);
  // Also retain the imported-project sandbox failure rather than silently
  // validating against a managed design-root fallback.
  try { resolveProjectDir(paths.projectsRoot, project.id, project.metadata); }
  catch { return reject('design_storage_unavailable', 'This project’s design storage is unavailable in the current environment.'); }
  await allowedRoot(source.canonical, paths, designPath);
  const app = await directory(path.resolve(source.canonical, relative), 'missing_app');
  if (!contains(source.canonical, app.canonical)) {
    return reject('unsafe_path', 'App/package folder resolves outside the connected source. Choose a contained folder.');
  }
  // A package may be a symlink into a credential/system directory located
  // beneath a broad permitted source; enforce the same policy on both roots.
  await allowedRoot(app.canonical, paths, designPath);
  return {
    sourceRoot: source.canonical,
    appRelativePath: relative,
    appRoot: app.canonical,
    selectionFingerprint: createHash('sha256').update(JSON.stringify([
      source.canonical, source.identity, relative, app.canonical, app.identity,
    ])).digest('hex'),
    sourceIdentity: source.identity,
    appIdentity: app.identity,
  };
}

function validRecord(binding: StoredCodebaseBinding): boolean {
  return Number.isSafeInteger(binding.revision) && binding.revision > 0
    && typeof binding.sourceRoot === 'string' && path.isAbsolute(binding.sourceRoot)
    && typeof binding.appRelativePath === 'string'
    && Number.isFinite(binding.updatedAt)
    && [binding.sourceIdentity, binding.appIdentity].every((identity) =>
      identity === null || (typeof identity === 'string' && /^\d+:\d+:\d+$/.test(identity)));
}

export async function codebaseBindingStatus(
  db: Database.Database,
  project: BindingProject,
  paths: CodebaseBindingPaths,
  capabilities: ProjectCodebaseBindingResponse['capabilities'],
): Promise<ProjectCodebaseBindingResponse> {
  const stored = getCodebaseBinding(db, project.id);
  const binding = stored ? {
    schemaVersion: stored.schemaVersion,
    revision: stored.revision,
    sourceRoot: stored.sourceRoot,
    appRelativePath: stored.appRelativePath,
    updatedAt: stored.updatedAt,
  } : null;
  const response: ProjectCodebaseBindingResponse = {
    projectId: project.id, designStoragePath: designStoragePath(project, paths), binding,
    status: 'unbound', reason: null, message: null, capabilities: { ...capabilities },
  };
  if (isSandboxModeEnabled() && sandboxImportAllowedRoots().length === 0) {
    response.capabilities.canBind = false;
    if (!stored) {
      return { ...response, status: 'unsupported', reason: 'sandbox_unavailable',
        message: 'Connecting local source folders is unavailable in this environment. Configure an allowed source root before connecting.' };
    }
  }
  if (!stored) return response;
  if (stored.schemaVersion !== 1 || !validRecord(stored)) {
    return { ...response, status: 'unsupported',
      reason: stored.schemaVersion !== 1 ? 'unsupported_schema' : 'invalid_record',
      message: 'This saved connection cannot be used by this version. Update OpenDesign; the record has been kept.',
      capabilities: { ...response.capabilities, canBind: false } };
  }
  try {
    const current = await validateCodebaseBinding(project, paths, stored);
    if (current.sourceRoot !== stored.sourceRoot
      || current.appRelativePath !== stored.appRelativePath
      || (stored.sourceIdentity !== null && current.sourceIdentity !== stored.sourceIdentity)
      || (stored.appIdentity !== null && current.appIdentity !== stored.appIdentity)) {
      reject('identity_changed', 'The folder at this location has changed. Choose it explicitly to reconnect.');
    }
    return { ...response, status: 'connected' };
  } catch (error) {
    if (!(error instanceof CodebaseBindingValidationError)) throw error;
    return { ...response, status: 'unavailable', reason: error.reason, message: error.message };
  }
}
