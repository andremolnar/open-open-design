import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type {
  ProjectSourceContextReason, ProjectSourceContextResolveRequest,
  ProjectSourceContextResponse, ProjectSourceEvidence,
} from '@open-design/contracts';
import { getCodebaseBinding } from '../storage/codebase-binding.js';
import { codebaseBindingStatus, type CodebaseBindingPaths } from './codebase-binding.js';

/** Callers must authorize these projects before invoking either entry point. */
export interface ProjectSourceContextProject {
  id: string;
  metadata?: { baseDir?: string };
}

export const PROJECT_SOURCE_CONTEXT_LIMITS = Object.freeze({
  maxFiles: 24, maxFileBytes: 16_384, maxTotalBytes: 65_536,
});
export const PROJECT_SOURCE_CONTEXT_SCAN_LIMITS = Object.freeze({
  maxEntries: 2_048, maxDirectories: 128, maxDepth: 8, maxReadFiles: 96, maxAncestorDepth: 32,
});

const INSTRUCTIONS = ['AGENTS.md', 'CLAUDE.md'] as const;
const EXCLUDED_DIRECTORIES = new Set([
  'node_modules', 'bower_components', 'vendor', 'dist', 'build', 'out', 'coverage',
  'target', 'generated', '__generated__', 'gen', 'cache', 'tmp', 'temp',
]);
// An explicit selection cannot turn an unambiguous dependency/credential tree
// into source evidence. Generic build/dist/vendor/cache ancestors remain valid.
const EXCLUDED_SOURCE_ANCESTORS = new Set([
  'node_modules', 'bower_components',
  '.git', '.hg', '.svn', '.ssh', '.aws', '.gnupg', '.kube', '.docker',
  '.next', '.nuxt',
]);
const CREDENTIAL_NAME = /(?:^|[._-])(?:secrets?|credentials?|passwords?|private[._-]?key|service[._-]?account|id_rsa|id_ed25519)(?:[._-]|$)/i;
const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte', '.astro',
  '.css', '.scss', '.sass', '.less', '.html', '.json', '.yaml', '.yml',
]);
const CREDENTIAL_FIELDS = '(?:api[_-]?key|(?:access|refresh|auth|id)[_-]?token|token|client[_-]?secret|secret[_-]?key|password|passwd|secret|credentials?)';
const QUOTED_CREDENTIAL = new RegExp(`["']?${CREDENTIAL_FIELDS}["']?\\s*[:=]\\s*["'][^"'\\r\\n]+["']`, 'i');
const YAML_CREDENTIAL = new RegExp(`(?:^|\\n)\\s*(?:-\\s*)?["']?${CREDENTIAL_FIELDS}["']?\\s*:\\s*[^\\s#][^\\r\\n]*`, 'i');

function contains(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function safeSegment(name: string): boolean {
  return Boolean(name) && !name.startsWith('.') && !name.includes('\\') && !name.includes('\0')
    && !EXCLUDED_DIRECTORIES.has(name.toLowerCase())
    && !CREDENTIAL_NAME.test(name);
}

function allowedFile(name: string): boolean {
  return safeSegment(name)
    && !/(?:\.min\.|\.generated\.|\.gen\.|\.d\.ts$|\.map$|\.lock$|(?:^|-)lock\.json$|^pnpm-lock\.|^yarn\.lock$|\.(?:pem|key|p12|pfx|crt|cer)$)/i.test(name);
}

function kindFor(relative: string): ProjectSourceEvidence['kind'] | null {
  const name = path.posix.basename(relative);
  if (!allowedFile(name)) return null;
  if (INSTRUCTIONS.includes(name as typeof INSTRUCTIONS[number])) return 'instruction';
  if (name === 'package.json') return 'manifest';
  if (name === 'README.md' || name === 'DESIGN.md') return 'instruction';
  if (!SOURCE_EXTENSIONS.has(path.posix.extname(name).toLowerCase())) return null;
  if (/(?:^|[/._-])(?:tokens?|theme|palette|colors?|typography)(?:[/._-]|$)/i.test(relative)) return 'tokens';
  if (/(?:^|\/)(?:components?|ui)\//i.test(relative) || /\.(?:tsx|jsx|vue|svelte|astro)$/i.test(name)) return 'component';
  return 'source';
}

function sensitiveOrGenerated(content: string): boolean {
  return /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(content)
    || /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/.test(content)
    || /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/.test(content)
    || QUOTED_CREDENTIAL.test(content) || YAML_CREDENTIAL.test(content)
    || /\b(?:authorization|proxy-authorization)["']?\s*[:=]\s*["']?(?:Bearer|Basic)\s+[-A-Za-z0-9+/_=.]{8,}/i.test(content)
    || /[a-z][a-z0-9+.-]*:\/\/[^\s/:]+:[^\s/@]+@/i.test(content)
    || /(?:^|\n)\s*(?:\/\/|\/\*+|\*|#|<!--)?\s*(?:@generated\b|(?:this (?:file|code) (?:is |was )?)?(?:auto[- ]?generated|generated (?:file|by))\b|do not edit[.!]?\s*(?:\*\/|-->)?\s*(?:\n|$))/i.test(content.slice(0, 2_048));
}

/** Reject every symlink component, not only the final entry, on every file read. */
async function checkedPath(root: string, relative: string, directory: boolean) {
  const segments = relative === '.' ? [] : relative.split('/');
  if (segments.some((segment) => !safeSegment(segment))) return null;
  let current = root;
  try {
    const rootInfo = await fs.lstat(root, { bigint: true });
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || await fs.realpath(root) !== root) return null;
    let info = rootInfo;
    for (const [index, segment] of segments.entries()) {
      current = path.join(current, segment);
      if (!contains(root, current)) return null;
      info = await fs.lstat(current, { bigint: true });
      if (info.isSymbolicLink() || (index < segments.length - 1 && !info.isDirectory())) return null;
    }
    if (directory ? !info.isDirectory() : !info.isFile()) return null;
    if (await fs.realpath(current) !== current) return null;
    return { absolute: current, info };
  } catch { return null; }
}

type FileIdentity = { dev: bigint; ino: bigint; birthtimeNs: bigint; size: bigint; mtimeNs: bigint; ctimeNs: bigint };
function sameFile(first: FileIdentity, second: FileIdentity): boolean {
  return first.dev === second.dev && first.ino === second.ino && first.birthtimeNs === second.birthtimeNs
    && first.size === second.size && first.mtimeNs === second.mtimeNs && first.ctimeNs === second.ctimeNs;
}

async function readEvidence(root: string, relative: string): Promise<{ content?: string; oversized?: boolean }> {
  if (!allowedFile(path.posix.basename(relative))) return {};
  const checked = await checkedPath(root, relative, false);
  // Hard links can alias secrets outside the source just as symlinks can.
  if (!checked || checked.info.nlink !== 1n) return {};
  if (checked.info.size > BigInt(PROJECT_SOURCE_CONTEXT_LIMITS.maxFileBytes)) return { oversized: true };
  let handle;
  try {
    handle = await fs.open(checked.absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || !sameFile(checked.info, opened)) return {};
    const beforeRead = await checkedPath(root, relative, false);
    if (!beforeRead || !sameFile(opened, beforeRead.info)) return {};
    // Bounded even if the file grows after stat; never use an unbounded readFile.
    const buffer = Buffer.alloc(PROJECT_SOURCE_CONTEXT_LIMITS.maxFileBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = await handle.read(buffer, length, buffer.length - length, length);
      if (read.bytesRead === 0) break;
      length += read.bytesRead;
    }
    if (length > PROJECT_SOURCE_CONTEXT_LIMITS.maxFileBytes) return { oversized: true };
    const afterRead = await checkedPath(root, relative, false);
    if (!afterRead || !sameFile(opened, afterRead.info) || !sameFile(opened, await handle.stat({ bigint: true }))) return {};
    const bytes = buffer.subarray(0, length);
    if (bytes.includes(0)) return {};
    let content: string;
    try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return {}; }
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(content) || sensitiveOrGenerated(content)) return {};
    return { content };
  } catch { return {}; }
  finally { await handle?.close().catch(() => undefined); }
}

interface ScanCandidate { relative: string; kind: ProjectSourceEvidence['kind'] }

async function scanPackage(root: string, app: string): Promise<{ candidates: ScanCandidate[]; truncated: boolean }> {
  const queue = [{ relative: app, depth: 0 }];
  const candidates: ScanCandidate[] = [];
  let entries = 0;
  let directories = 0;
  let truncated = false;
  for (let index = 0; index < queue.length; index += 1) {
    if (directories >= PROJECT_SOURCE_CONTEXT_SCAN_LIMITS.maxDirectories || entries >= PROJECT_SOURCE_CONTEXT_SCAN_LIMITS.maxEntries) {
      truncated = true;
      break;
    }
    const current = queue[index]!;
    const checked = await checkedPath(root, current.relative, true);
    if (!checked) continue;
    directories += 1;
    try {
      const directory = await fs.opendir(checked.absolute, { bufferSize: 16 });
      // Iteration closes the directory also on budget exhaustion.
      for await (const entry of directory) {
        entries += 1;
        if (entries > PROJECT_SOURCE_CONTEXT_SCAN_LIMITS.maxEntries) { truncated = true; break; }
        if (!safeSegment(entry.name) || entry.isSymbolicLink()) continue;
        const relative = current.relative === '.' ? entry.name : `${current.relative}/${entry.name}`;
        if (entry.isDirectory()) {
          if (current.depth >= PROJECT_SOURCE_CONTEXT_SCAN_LIMITS.maxDepth
            || queue.length >= PROJECT_SOURCE_CONTEXT_SCAN_LIMITS.maxDirectories) truncated = true;
          else queue.push({ relative, depth: current.depth + 1 });
        } else if (entry.isFile()) {
          const kind = kindFor(relative);
          // Scoped instruction files are added only for selected evidence files.
          if (kind && kind !== 'instruction' && (kind !== 'manifest' || current.relative === app)) {
            candidates.push({ relative, kind });
          }
        }
      }
    } catch { /* An unreadable subtree does not authorize reading elsewhere. */ }
  }
  return { candidates, truncated };
}

function ancestors(relative: string): string[] {
  const segments = relative === '.' ? [] : relative.split('/');
  return ['.', ...segments.map((_, index) => segments.slice(0, index + 1).join('/'))];
}

async function collectEvidence(root: string, app: string, query: string) {
  const scan = await scanPackage(root, app);
  const evidence: ProjectSourceEvidence[] = [];
  const attempted = new Set<string>();
  let bytes = 0;
  let truncated = scan.truncated;
  const add = async (relative: string, kind: ProjectSourceEvidence['kind']): Promise<void> => {
    if (attempted.has(relative)) return;
    if (evidence.length >= PROJECT_SOURCE_CONTEXT_LIMITS.maxFiles
      || attempted.size >= PROJECT_SOURCE_CONTEXT_SCAN_LIMITS.maxReadFiles) { truncated = true; return; }
    attempted.add(relative);
    const read = await readEvidence(root, relative);
    if (read.oversized) truncated = true;
    if (read.content === undefined) return;
    const size = Buffer.byteLength(read.content, 'utf8');
    if (bytes + size > PROJECT_SOURCE_CONTEXT_LIMITS.maxTotalBytes) { truncated = true; return; }
    evidence.push({ path: relative, kind, content: read.content });
    bytes += size;
  };
  const addInstructions = async (directory: string): Promise<void> => {
    for (const ancestor of ancestors(directory)) {
      for (const name of INSTRUCTIONS) await add(ancestor === '.' ? name : `${ancestor}/${name}`, 'instruction');
    }
  };
  await addInstructions(app);
  for (const name of ['README.md', 'DESIGN.md']) await add(app === '.' ? name : `${app}/${name}`, 'instruction');
  const terms = query.slice(0, 2_000).toLowerCase().match(/[a-z0-9_-]{3,}/g)?.slice(0, 32) ?? [];
  const score = (candidate: ScanCandidate): number => {
    const base = { instruction: 50, manifest: 40, tokens: 30, component: 20, source: 10 }[candidate.kind];
    return base + terms.reduce((total, term) => total + (candidate.relative.toLowerCase().includes(term) ? 50 : 0), 0);
  };
  scan.candidates.sort((a, b) => score(b) - score(a) || a.relative.localeCompare(b.relative));
  for (const candidate of scan.candidates) {
    if (evidence.length >= PROJECT_SOURCE_CONTEXT_LIMITS.maxFiles
      || attempted.size >= PROJECT_SOURCE_CONTEXT_SCAN_LIMITS.maxReadFiles) { truncated = true; break; }
    await addInstructions(path.posix.dirname(candidate.relative));
    await add(candidate.relative, candidate.kind);
  }
  return { evidence, truncated };
}

function emptyContext(
  projectId: string | null, status: ProjectSourceContextResponse['status'],
  reason: ProjectSourceContextReason, message: string,
  binding: ProjectSourceContextResponse['binding'] = null,
): ProjectSourceContextResponse {
  return { projectId, status, reason, message, binding, bindingRevision: binding?.revision ?? null,
    evidence: [], truncated: false, limits: { ...PROJECT_SOURCE_CONTEXT_LIMITS } };
}

/** No target writes, subprocesses, Git reads, cwd changes, or permission changes. */
export async function readProjectSourceContext(
  db: Database.Database, project: ProjectSourceContextProject, paths: CodebaseBindingPaths,
  options: { query?: string } = {},
): Promise<ProjectSourceContextResponse> {
  const capabilities = { canBind: false, requiresTrustedPicker: false };
  const initial = await codebaseBindingStatus(db, project, paths, capabilities);
  if (initial.status !== 'connected' || !initial.binding) {
    return emptyContext(project.id, initial.status === 'unbound' ? 'needs_selection' : 'unavailable',
      initial.reason ?? 'unbound', initial.message ?? 'Connect a source folder to use source context.', initial.binding);
  }
  const binding = initial.binding;
  const storedSnapshot = getCodebaseBinding(db, project.id);
  if (!storedSnapshot || Object.entries(binding).some(([key, value]) => storedSnapshot[key as keyof typeof storedSnapshot] !== value)) {
    return emptyContext(project.id, 'unavailable', 'binding_changed', 'The source connection changed while reading. Request context again.');
  }
  if (binding.sourceRoot.split(path.sep).some((name) => EXCLUDED_SOURCE_ANCESTORS.has(name.toLowerCase()))
    || ancestors(binding.appRelativePath).length > PROJECT_SOURCE_CONTEXT_SCAN_LIMITS.maxAncestorDepth
    || !await checkedPath(binding.sourceRoot, binding.appRelativePath, true)) {
    return emptyContext(project.id, 'unavailable', 'unsafe_path',
      'The package path cannot be inspected safely. Select an ordinary source folder without symlinks or excluded directories.', binding);
  }
  const collected = await collectEvidence(binding.sourceRoot, binding.appRelativePath, options.query ?? '');
  const final = await codebaseBindingStatus(db, project, paths, capabilities);
  // Rebinding while an asynchronous scan is running must never mix identities.
  if (JSON.stringify(final.binding) !== JSON.stringify(binding)) {
    return emptyContext(project.id, 'unavailable', 'binding_changed',
      'The source connection changed while reading. Request context again.', final.binding);
  }
  if (final.status !== 'connected') {
    return emptyContext(project.id, 'unavailable', final.reason ?? 'binding_changed',
      final.message ?? 'The source connection became unavailable. Reconnect before requesting context.', final.binding);
  }
  if (!await checkedPath(binding.sourceRoot, binding.appRelativePath, true)) {
    return emptyContext(project.id, 'unavailable', 'unsafe_path', 'The package path changed while reading. Reconnect before requesting context.', binding);
  }
  // No await between this last database check and returning the evidence.
  if (JSON.stringify(getCodebaseBinding(db, project.id)) !== JSON.stringify(storedSnapshot)) {
    return emptyContext(project.id, 'unavailable', 'binding_changed', 'The source connection changed while reading. Request context again.');
  }
  return { status: 'ready', projectId: project.id, bindingRevision: binding.revision, binding,
    reason: null, message: null, ...collected, limits: { ...PROJECT_SOURCE_CONTEXT_LIMITS } };
}

function normalizedLocation(request: ProjectSourceContextResolveRequest): { sourceRoot: string; appRelativePath: string } | null {
  if (!request.sourceRoot.trim() || request.sourceRoot.includes('\0') || !path.isAbsolute(request.sourceRoot)) return null;
  const app = request.appRelativePath ?? '.';
  if (!app || app.includes('\0') || path.posix.isAbsolute(app) || path.win32.isAbsolute(app) || /^[a-z]:/i.test(app)) return null;
  const segments = app.replace(/\\/g, '/').split('/');
  if (segments.includes('..')) return null;
  return { sourceRoot: path.resolve(request.sourceRoot), appRelativePath: segments.filter((part) => part && part !== '.').join('/') || '.' };
}

/**
 * Resolve only exact saved source/package locations among authorized candidates.
 * No filesystem lookup of caller-supplied paths precedes association selection.
 * Symlink aliases or moved locations require explicit reconnection, not guessing.
 */
export async function resolveProjectSourceContext(
  db: Database.Database, authorizedProjects: readonly ProjectSourceContextProject[], paths: CodebaseBindingPaths,
  request: ProjectSourceContextResolveRequest,
): Promise<ProjectSourceContextResponse> {
  const location = normalizedLocation(request);
  if (!location) return emptyContext(null, 'unavailable', 'unsafe_path', 'Supply an absolute source root and a contained relative app/package path.');
  const candidates = [...new Map(authorizedProjects.map((project) => [project.id, project])).values()];
  const matches = candidates.filter((project) => {
    if (request.projectId && project.id !== request.projectId) return false;
    const binding = getCodebaseBinding(db, project.id);
    return binding?.sourceRoot === location.sourceRoot && binding.appRelativePath === location.appRelativePath;
  });
  if (matches.length === 0) {
    const explicit = request.projectId ? candidates.find((project) => project.id === request.projectId) : undefined;
    return emptyContext(explicit?.id ?? null, 'needs_selection', explicit ? 'project_mismatch' : 'no_match',
      'No authorized project is connected to this exact source/package location. Select a project and connect its source.');
  }
  if (matches.length !== 1) return emptyContext(null, 'needs_selection', 'ambiguous',
    'Multiple authorized projects use this source/package location. Supply an explicitly selected project ID.');
  return readProjectSourceContext(db, matches[0]!, paths, request.query === undefined ? {} : { query: request.query });
}
