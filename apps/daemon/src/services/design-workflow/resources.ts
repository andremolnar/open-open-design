import { createHash } from 'node:crypto';
import fs, { constants, type Stats } from 'node:fs';
import path from 'node:path';
import { DESIGN_WORKFLOW_LIMITS, type DesignResourceManifestEntry } from '@open-design/contracts';

export interface DesignResourceRoot {
  root: string;
  prefix: string;
  role: 'design_system' | 'skill_sidefile' | 'project_asset';
  provenance: string;
}

export interface FrozenResource {
  manifest: DesignResourceManifestEntry;
  base64: string;
}

// Independent scan limits bound work even when every entry is excluded.
export const RESOURCE_SCAN_LIMITS = { maxRoots: 32, maxEntries: 4096, maxDepth: 12, maxWarnings: 128, maxReadBytes: 32 * 1024 * 1024 } as const;
const excludedAncestors = new Set(['.ssh', '.aws', '.gnupg', '.kube', '.git', '.hg', '.svn', '.docker', 'node_modules', 'bower_components']);
const excluded = new Set(['node_modules', 'vendor', 'dist', 'build', 'coverage', 'target', 'secrets', 'credentials', 'private', '__pycache__']);
const secretName = /(?:^|[-_.])(?:secret|secrets|credential|credentials|password|passwords|token|tokens?[-_]private|private[-_]key)(?:[-_.]|$)|^(?:id_rsa|id_ed25519|id_ecdsa|known_hosts|authorized_keys)$|\.(?:pem|key|p12|pfx|keystore|sqlite|sqlite3|db)$/i;
const textMimes: Record<string, string> = {
  '.md': 'text/markdown', '.mdx': 'text/markdown', '.txt': 'text/plain', '.json': 'application/json',
  '.css': 'text/css', '.scss': 'text/plain', '.yaml': 'application/yaml', '.yml': 'application/yaml',
  '.html': 'text/html', '.htm': 'text/html', '.svg': 'image/svg+xml', '.csv': 'text/csv',
  '.ts': 'text/plain', '.tsx': 'text/plain', '.js': 'text/javascript', '.jsx': 'text/plain',
  '.mjs': 'text/javascript', '.cjs': 'text/javascript', '.py': 'text/x-python', '.sh': 'text/x-shellscript',
  '.toml': 'text/plain', '.xml': 'application/xml', '.ini': 'text/plain', '.sass': 'text/plain', '.less': 'text/plain',
};

export function sha256(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

// Conservative credential filtering mirrors source-context's read boundary;
// ordinary design tokens (tokens.css, colors, spacing) remain eligible.
const credentialFields = '(?:api[_-]?key|(?:access|refresh|auth|id)[_-]?token|token|client[_-]?secret|secret[_-]?key|password|passwd|secret|credentials?)';
const quotedCredential = new RegExp(`["']?${credentialFields}["']?\\s*[:=]\\s*["'][^"'\\r\\n]+["']`, 'i');
const yamlCredential = new RegExp(`(?:^|\\n)\\s*(?:-\\s*)?["']?${credentialFields}["']?\\s*:\\s*[^\\s#][^\\r\\n]*`, 'i');
function containsCredentials(content: string): boolean {
  return /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(content)
    || /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/.test(content)
    || /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/.test(content)
    || quotedCredential.test(content) || yamlCredential.test(content)
    || /\b(?:authorization|proxy-authorization)["']?\s*[:=]\s*["']?(?:Bearer|Basic)\s+[-A-Za-z0-9+/_=.]{8,}/i.test(content)
    || (content.includes('://') && /[a-z][a-z0-9+.-]{0,31}:\/\/[^\s/:]{1,256}:[^\s/@]{1,256}@/i.test(content));
}

function safeComponent(name: string): boolean {
  return name.length > 0 && !name.startsWith('.') && !excluded.has(name.toLowerCase()) && !secretName.test(name)
    && !/[\0-\x1f\x7f\\:]/.test(name);
}

function safeRelative(value: string): boolean {
  return value.length > 0 && value.length <= 1024 && !path.isAbsolute(value) && !path.win32.isAbsolute(value)
    && value.split('/').every(safeComponent);
}

function sameFile(a: Stats, b: Stats): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs
    && a.ctimeMs === b.ctimeMs && a.mode === b.mode && a.nlink === b.nlink;
}

/** Check all components, including ancestors of a callback-supplied root. */
function checkedComponents(target: string, trustedRoot: string): Array<{ name: string; stat: Stats }> {
  if (!path.isAbsolute(target) || path.resolve(target) !== target) throw new Error('noncanonical root');
  let current = path.parse(target).root;
  const result: Array<{ name: string; stat: Stats }> = [];
  const parts = target.slice(current.length).split(path.sep).filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    current = path.join(current, part);
    if (excludedAncestors.has(part.toLowerCase())) throw new Error('sensitive or dependency ancestor');
    const relative = path.relative(trustedRoot, current);
    // The callback owns the root; hidden ancestors (for example a managed data
    // directory) are legitimate. Hidden/secret entries *inside* it are not.
    if (relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !safeComponent(part)) throw new Error('excluded path component');
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || (i < parts.length - 1 && !stat.isDirectory())) throw new Error('unsafe path component');
    result.push({ name: current, stat });
  }
  return result;
}

function unchangedComponents(components: Array<{ name: string; stat: Stats }>): boolean {
  return components.every(({ name, stat }) => {
    const now = fs.lstatSync(name);
    // Directory size/times change when unrelated siblings change; identity cannot.
    return !now.isSymbolicLink() && now.dev === stat.dev && now.ino === stat.ino && now.mode === stat.mode;
  });
}

/** O_NOFOLLOW plus inode/size/time checks prevents substituted or changing files. */
function readOriginal(target: string, root: string, maxBytes: number): Buffer {
  const components = checkedComponents(target, root);
  const before = components.at(-1)?.stat;
  if (!before?.isFile() || before.nlink !== 1 || before.size > Math.min(DESIGN_WORKFLOW_LIMITS.maxResourceBytes, maxBytes)) throw new Error('unsafe or oversized file');
  const fd = fs.openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.nlink !== 1 || !sameFile(before, opened)) throw new Error('file changed before reading');
    // Never readFile here: a growing file must not allocate past the budget.
    const bytes = Buffer.alloc(opened.size + 1);
    let count = 0;
    while (count < bytes.length) {
      const read = fs.readSync(fd, bytes, count, bytes.length - count, count);
      if (read === 0) break;
      count += read;
    }
    if (count !== opened.size || !sameFile(opened, fs.fstatSync(fd)) || !sameFile(opened, fs.lstatSync(target))
      || !unchangedComponents(components)) throw new Error('file changed during reading');
    return bytes.subarray(0, count);
  } finally {
    fs.closeSync(fd);
  }
}

/** Actual image/font signatures take precedence over misleading extensions. */
function mimeType(bytes: Buffer, name: string): string | null {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    && bytes.toString('ascii', 12, 16) === 'IHDR') return 'image/png';
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.length >= 10 && ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) return 'image/gif';
  if (bytes.length >= 16 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
    && ['VP8 ', 'VP8L', 'VP8X'].includes(bytes.toString('ascii', 12, 16))) return 'image/webp';
  const signature = bytes.toString('ascii', 0, 4);
  if (signature === 'wOFF') return 'font/woff';
  if (signature === 'wOF2') return 'font/woff2';
  if (signature === 'OTTO') return 'font/otf';
  if (bytes.length >= 12 && bytes.subarray(0, 4).equals(Buffer.from([0, 1, 0, 0]))) return 'font/ttf';
  const type = textMimes[path.extname(name).toLowerCase()];
  if (!type || bytes.includes(0)) return null;
  try {
    const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return containsCredentials(content) ? null : type;
  } catch {
    return null;
  }
}

export function captureResources(roots: readonly DesignResourceRoot[], maxBytes = DESIGN_WORKFLOW_LIMITS.maxPackageBytes): {
  resources: FrozenResource[]; warnings: string[]; truncated: boolean;
} {
  const resources: FrozenResource[] = [];
  const warnings: string[] = [];
  const names = new Set<string>();
  let total = 0;
  let readBytes = 0;
  let entries = 0;
  let truncated = false;
  let omissions = 0;
  function skip(message: string): void {
    truncated = true;
    omissions++;
    if (warnings.length < RESOURCE_SCAN_LIMITS.maxWarnings) warnings.push(message.slice(0, 1024));
    else warnings[RESOURCE_SCAN_LIMITS.maxWarnings - 1] = `Additional resource diagnostics were bounded; ${omissions} omissions or exhausted budgets were reported.`;
  }
  function add(root: DesignResourceRoot, relative: string, file: string): void {
    const name = `${root.prefix}/${relative}`;
    if (!safeRelative(name) || names.has(name)) { skip(`Skipped unsafe or duplicate resource name: ${name}`); return; }
    try {
      if (resources.length >= DESIGN_WORKFLOW_LIMITS.maxResources || total >= maxBytes || readBytes >= RESOURCE_SCAN_LIMITS.maxReadBytes) {
        skip(`Resource package or read budget exhausted: ${name}`); return;
      }
      const bytes = readOriginal(file, root.root, Math.min(maxBytes - total, RESOURCE_SCAN_LIMITS.maxReadBytes - readBytes));
      readBytes += bytes.length;
      const type = mimeType(bytes, file);
      if (!type) { skip(`Skipped unsupported or credential-bearing resource: ${name}`); return; }
      if (resources.length >= DESIGN_WORKFLOW_LIMITS.maxResources || total + bytes.length > maxBytes) {
        skip(`Resource package budget exhausted: ${name}`); return;
      }
      const hash = sha256(bytes);
      const required = root.role === 'skill_sidefile' || /^(?:SKILL|USAGE|DESIGN|README)(?:\..+)?$/i.test(path.basename(relative));
      const manifest: DesignResourceManifestEntry = {
        id: sha256(`${root.provenance}\0${name}\0${hash}`), name, role: root.role,
        provenance: root.provenance, mimeType: type, bytes: bytes.length, sha256: hash,
        required, transformed: false,
        representations: ['original', ...(['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(type) ? ['image' as const] : [])],
      };
      resources.push({ manifest, base64: bytes.toString('base64') });
      names.add(name);
      total += bytes.length;
    } catch {
      skip(`Skipped unsafe, changed, unreadable, or oversized resource: ${name}`);
    }
  }
  function walk(root: DesignResourceRoot, directory: string, relative: string, depth: number): void {
    if (depth > RESOURCE_SCAN_LIMITS.maxDepth) { skip(`Resource depth budget exhausted: ${root.prefix}/${relative}`); return; }
    if (entries >= RESOURCE_SCAN_LIMITS.maxEntries) { skip('Resource entry scan budget exhausted.'); return; }
    let handle: fs.Dir | undefined;
    try {
      const components = checkedComponents(directory, root.root);
      if (!components.at(-1)?.stat.isDirectory()) throw new Error('not a directory');
      handle = fs.opendirSync(directory);
      const children: fs.Dirent[] = [];
      for (;;) {
        const entry = handle.readSync();
        if (!entry) break;
        if (++entries > RESOURCE_SCAN_LIMITS.maxEntries) { skip('Resource entry scan budget exhausted.'); break; }
        children.push(entry);
      }
      if (!unchangedComponents(components)) throw new Error('directory changed');
      // Required guidance comes first, then deterministic ordering within the bounded scan.
      children.sort((a, b) => Number(!/^(SKILL|USAGE|DESIGN|README)\b/i.test(a.name)) - Number(!/^(SKILL|USAGE|DESIGN|README)\b/i.test(b.name)) || a.name.localeCompare(b.name));
      for (const entry of children) {
        const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
        if (!safeComponent(entry.name) || entry.isSymbolicLink()) { skip(`Excluded unsafe resource: ${root.prefix}/${childRelative}`); continue; }
        const child = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(root, child, childRelative, depth + 1);
        else if (entry.isFile()) add(root, childRelative, child);
        else skip(`Excluded non-regular resource: ${root.prefix}/${childRelative}`);
      }
    } catch {
      skip(`Skipped unsafe or unreadable resource directory: ${root.prefix}/${relative}`);
    } finally {
      handle?.closeSync();
    }
  }
  if (roots.length > RESOURCE_SCAN_LIMITS.maxRoots) skip('Resource root budget exhausted.');
  for (const root of roots.slice(0, RESOURCE_SCAN_LIMITS.maxRoots)) {
    if (!safeRelative(root.prefix) || !root.provenance || root.provenance.length > 2048) {
      skip('Skipped resource root with unsafe metadata.'); continue;
    }
    walk(root, root.root, '', 0);
  }
  return { resources, warnings, truncated };
}

/** Reusable bounded reader for the caller's trusted managed-artifact directory. */
export async function readDesignWorkflowFile(root: string, relative: string): Promise<Buffer> {
  if (!safeRelative(relative) || !path.isAbsolute(root) || path.resolve(root) !== root) throw new Error('Unsafe managed resource path');
  return readOriginal(path.join(root, ...relative.split('/')), root, DESIGN_WORKFLOW_LIMITS.maxResourceBytes);
}
