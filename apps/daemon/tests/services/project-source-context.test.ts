import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { projectSourceContextResolveRequestSchema } from '@open-design/contracts';
import {
  PROJECT_SOURCE_CONTEXT_LIMITS, PROJECT_SOURCE_CONTEXT_SCAN_LIMITS,
  readProjectSourceContext, resolveProjectSourceContext,
} from '../../src/services/project-source-context.js';
import { validateCodebaseBinding } from '../../src/services/codebase-binding.js';
import { migrateCodebaseBindings, saveCodebaseBinding } from '../../src/storage/codebase-binding.js';

let root: string;
let source: string;
let db: Database.Database;
let paths: { projectsRoot: string; runtimeDataRoot: string };
const project = { id: 'design-a', metadata: {} };
const app = 'apps/web';

async function file(relative: string, content: string | Buffer): Promise<void> {
  const absolute = path.join(source, relative);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, content);
}

async function bind(id = project.id, appRelativePath = app, sourceRoot = source) {
  db.prepare('INSERT OR IGNORE INTO projects (id) VALUES (?)').run(id);
  const selection = await validateCodebaseBinding({ id }, paths, { sourceRoot, appRelativePath });
  return saveCodebaseBinding(db, id, null, selection);
}

async function snapshot(directory: string): Promise<Record<string, unknown>> {
  const output: Record<string, unknown> = {};
  async function walk(current: string, relative: string): Promise<void> {
    const info = await fs.lstat(current, { bigint: true });
    output[relative] = {
      mode: String(info.mode), mtime: String(info.mtimeNs),
      bytes: info.isFile() ? (await fs.readFile(current)).toString('base64') : undefined,
      link: info.isSymbolicLink() ? await fs.readlink(current) : undefined,
    };
    if (info.isDirectory()) {
      for (const name of (await fs.readdir(current)).sort()) await walk(path.join(current, name), `${relative}/${name}`);
    }
  }
  await walk(directory, '.');
  return output;
}

beforeEach(async () => {
  vi.stubEnv('OD_SANDBOX_MODE', '0');
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'od-source-context-')));
  source = path.join(root, 'source');
  paths = { runtimeDataRoot: path.join(root, 'runtime'), projectsRoot: path.join(root, 'runtime/projects') };
  await fs.mkdir(paths.projectsRoot, { recursive: true });
  await file('AGENTS.md', 'Use the existing brand. Do not edit source files.');
  await file('CLAUDE.md', 'Prefer existing typography.');
  await file('apps/AGENTS.md', 'Keep packages isolated.');
  await file(`${app}/AGENTS.md`, 'Web package instructions.');
  await file(`${app}/package.json`, '{"name":"source-fixture","scripts":{"build":"never-run-this"}}');
  await file(`${app}/src/components/AGENTS.md`, 'Buttons use the shared radius.');
  await file(`${app}/src/components/Button.tsx`, 'export const Button = () => <button className="brand">Launch</button>;');
  await file(`${app}/src/tokens.css`, ':root { --brand-color: #5a39ff; --radius: 12px; }');
  await file('apps/other/AGENTS.md', 'SIBLING_INSTRUCTIONS');
  await file('apps/other/SecretComponent.tsx', 'SIBLING_SOURCE');
  await fs.writeFile(path.join(root, 'AGENTS.md'), 'OUTSIDE_INSTRUCTIONS');
  db = new Database(':memory:');
  db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY)');
  migrateCodebaseBindings(db);
  await bind();
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  db?.close();
  if (root) await fs.rm(root, { recursive: true, force: true });
});

describe('read-only project source context', () => {
  it('returns stable IDs/revision and applicable instructions, component and tokens without touching source', async () => {
    await fs.chmod(path.join(source, app, 'src/tokens.css'), 0o444);
    const before = await snapshot(source);
    const commands = ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']
      .map((name) => vi.spyOn(childProcess, name as 'spawn'));
    const context = await readProjectSourceContext(db, project, paths, { query: 'Button brand color' });
    expect(context).toMatchObject({ status: 'ready', projectId: project.id, bindingRevision: 1, reason: null });
    expect(context.evidence.map((item) => item.path)).toEqual(expect.arrayContaining([
      'AGENTS.md', 'CLAUDE.md', 'apps/AGENTS.md', `${app}/AGENTS.md`, `${app}/package.json`,
      `${app}/src/components/AGENTS.md`, `${app}/src/components/Button.tsx`, `${app}/src/tokens.css`,
    ]));
    expect(context.evidence.find((item) => item.kind === 'component')?.content).toContain('Launch');
    expect(context.evidence.find((item) => item.kind === 'tokens')?.content).toContain('--brand-color');
    expect(context.evidence[0]?.content).toContain('Do not edit source files');
    expect(JSON.stringify(context)).not.toMatch(/SIBLING_|OUTSIDE_INSTRUCTIONS/);
    expect(await readProjectSourceContext(db, project, paths, { query: 'Button brand color' })).toEqual(context);
    expect(await snapshot(source)).toEqual(before);
    for (const command of commands) expect(command).not.toHaveBeenCalled();
  });

  it('excludes hidden, secret, generated, dependency, binary, oversized and hard-linked content', async () => {
    const excluded = [
      '.env', '.env.local', '.git/config', 'node_modules/lib/Widget.tsx', 'dist/Widget.tsx',
      'build/Widget.tsx', '__generated__/Widget.tsx', 'src/secrets.ts', 'src/credentials.json',
      'src/service-account.json', 'src/Widget.generated.tsx', 'src/Widget.min.js',
      'src/private-key.pem', 'package-lock.json',
    ];
    for (const name of excluded) await file(`${app}/${name}`, 'EXCLUDED_CONTENT');
    await file(`${app}/src/normal.ts`, 'export const apiKey = "should-never-be-disclosed";');
    await file(`${app}/src/config.yaml`, 'api_key: live-secret-material\n');
    await file(`${app}/src/settings.yml`, 'password: unquoted-secret\n');
    await file(`${app}/src/config.json`, '{"refresh_token":"refresh-material","token":"token-material","secret_key":"key-material"}');
    await file(`${app}/src/request.ts`, 'export const headers = { Authorization: "Bearer bearer-material" };');
    await file(`${app}/src/compiled.ts`, '// AUTO-GENERATED FILE\nexport const value = "EXCLUDED_CONTENT";');
    await file(`${app}/src/nul.ts`, Buffer.from([65, 0, 66]));
    await file(`${app}/src/invalid-utf8.ts`, Buffer.from([0xff, 0xfe]));
    await file(`${app}/src/huge.ts`, 'x'.repeat(PROJECT_SOURCE_CONTEXT_LIMITS.maxFileBytes + 1));
    await fs.writeFile(path.join(root, 'outside.ts'), 'HARDLINK_SECRET');
    await fs.link(path.join(root, 'outside.ts'), path.join(source, app, 'src/linked.ts'));
    const context = await readProjectSourceContext(db, project, paths, { query: 'EXCLUDED_CONTENT normal compiled huge linked' });
    expect(context.status).toBe('ready');
    expect(context.truncated).toBe(true);
    expect(JSON.stringify(context.evidence)).not.toMatch(/EXCLUDED_CONTENT|should-never|HARDLINK_SECRET|live-secret-material|unquoted-secret|refresh-material|bearer-material/);
    const returned = context.evidence.map((item) => item.path);
    for (const name of [...excluded, 'src/normal.ts', 'src/config.yaml', 'src/settings.yml', 'src/config.json', 'src/request.ts', 'src/compiled.ts', 'src/nul.ts', 'src/invalid-utf8.ts', 'src/huge.ts', 'src/linked.ts']) {
      expect(returned).not.toContain(`${app}/${name}`);
    }
  });

  it('skips file and directory symlinks, including symlink instructions and same-source aliases', async () => {
    await fs.writeFile(path.join(root, 'outside.tsx'), 'OUTSIDE_LINK');
    await fs.symlink(path.join(root, 'outside.tsx'), path.join(source, app, 'outside.tsx'));
    await fs.symlink(path.join(source, 'apps/other'), path.join(source, app, 'alias'), 'dir');
    await fs.symlink(root, path.join(source, app, 'outside-directory'), 'dir');
    await fs.rm(path.join(source, app, 'src/components/AGENTS.md'));
    await fs.symlink(path.join(root, 'AGENTS.md'), path.join(source, app, 'src/components/AGENTS.md'));
    const context = await readProjectSourceContext(db, project, paths);
    expect(context.status).toBe('ready');
    expect(JSON.stringify(context.evidence)).not.toMatch(/OUTSIDE_|SIBLING_|\/alias\//);
  });

  it('refuses a bound package reached through an internal symlink', async () => {
    await fs.symlink(path.join(source, app), path.join(source, 'alias'), 'dir');
    await bind('alias-design', 'alias');
    expect(await readProjectSourceContext(db, { id: 'alias-design' }, paths)).toMatchObject({
      status: 'unavailable', reason: 'unsafe_path', evidence: [],
    });
  });

  it.each(['.git', 'node_modules/library', 'bower_components/library', '.aws/configs', '.next/cache'])('does not let a directly selected source under %s bypass exclusions', async (relative) => {
    await file(`${relative}/Component.tsx`, 'DIRECT_ROOT_SECRET');
    await bind('excluded-root', '.', path.join(source, relative));
    const reads = vi.spyOn(fs, 'open');
    expect(await readProjectSourceContext(db, { id: 'excluded-root' }, paths)).toMatchObject({
      status: 'unavailable', reason: 'unsafe_path', evidence: [],
    });
    expect(reads).not.toHaveBeenCalled();
  });

  it.each(['build/app', 'dist/app', 'vendor/app', 'cache/app', 'tmp/app'])('permits explicitly selected ordinary source beneath a generic %s ancestor', async (relative) => {
    await file(`${relative}/Component.tsx`, 'export const Component = () => <div>Selected source</div>;');
    await bind('ordinary-root', '.', path.join(source, relative));
    const context = await readProjectSourceContext(db, { id: 'ordinary-root' }, paths);
    expect(context.status).toBe('ready');
    expect(context.evidence.map((item) => item.path)).toContain('Component.tsx');
  });

  it('rejects a parent-directory symlink swap between checking a file and opening it', async () => {
    const outside = path.join(root, 'outside-components');
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'Button.tsx'), 'RACE_OUTSIDE_SECRET');
    const originalOpen = fs.open.bind(fs);
    let swapped = false;
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      if (!swapped && String(args[0]).endsWith('/components/Button.tsx')) {
        swapped = true;
        const componentDirectory = path.join(source, app, 'src/components');
        await fs.rename(componentDirectory, `${componentDirectory}-old`);
        await fs.symlink(outside, componentDirectory, 'dir');
      }
      return originalOpen(...args);
    });
    const context = await readProjectSourceContext(db, project, paths);
    expect(swapped).toBe(true);
    expect(JSON.stringify(context.evidence)).not.toContain('RACE_OUTSIDE_SECRET');
    expect(context.evidence.map((item) => item.path)).not.toContain(`${app}/src/components/Button.tsx`);
  });

  it('bounds returned files and UTF-8 bytes and prioritizes a query-matching component', async () => {
    for (let index = 0; index < 35; index += 1) {
      await file(`${app}/src/components/Card${index}.tsx`, `// ${'色'.repeat(2_000)}\nexport const Card${index} = 1;`);
    }
    const context = await readProjectSourceContext(db, project, paths, { query: 'Card34' });
    expect(context.evidence.some((item) => item.path.endsWith('Card34.tsx'))).toBe(true);
    expect(context.truncated).toBe(true);
    expect(context.evidence.length).toBeLessThanOrEqual(PROJECT_SOURCE_CONTEXT_LIMITS.maxFiles);
    expect(context.evidence.reduce((total, item) => total + Buffer.byteLength(item.content), 0))
      .toBeLessThanOrEqual(PROJECT_SOURCE_CONTEXT_LIMITS.maxTotalBytes);
    expect(context.evidence.every((item) => Buffer.byteLength(item.content) <= PROJECT_SOURCE_CONTEXT_LIMITS.maxFileBytes)).toBe(true);
  });

  it('bounds directory entries, directory count and traversal depth without unbounded readdir', async () => {
    // Files with irrelevant extensions still consume the enumeration budget.
    const many = path.join(source, app, 'many');
    await fs.mkdir(many);
    await Promise.all(Array.from({ length: PROJECT_SOURCE_CONTEXT_SCAN_LIMITS.maxEntries + 2 }, (_, index) =>
      fs.writeFile(path.join(many, `${index}.txt`), 'irrelevant')));
    const readDirectory = vi.spyOn(fs, 'readdir');
    const context = await readProjectSourceContext(db, project, paths);
    expect(context.truncated).toBe(true);
    expect(readDirectory).not.toHaveBeenCalled();
    readDirectory.mockRestore();
    await fs.rm(many, { recursive: true });
    const deep = Array.from({ length: PROJECT_SOURCE_CONTEXT_SCAN_LIMITS.maxDepth + 1 }, (_, index) => `level${index}`).join('/');
    await file(`${app}/${deep}/Deep.tsx`, 'TOO_DEEP');
    const deepContext = await readProjectSourceContext(db, project, paths);
    expect(deepContext.truncated).toBe(true);
    expect(JSON.stringify(deepContext.evidence)).not.toContain('TOO_DEEP');
  });

  it('caps total enumerated directories independently of file and byte budgets', async () => {
    for (let index = 0; index < PROJECT_SOURCE_CONTEXT_SCAN_LIMITS.maxDirectories + 1; index += 1) {
      await fs.mkdir(path.join(source, app, `empty-${index}`));
    }
    const directories = vi.spyOn(fs, 'opendir');
    const context = await readProjectSourceContext(db, project, paths);
    expect(context.truncated).toBe(true);
    expect(directories.mock.calls.length).toBeLessThanOrEqual(PROJECT_SOURCE_CONTEXT_SCAN_LIMITS.maxDirectories);
  });

  it('caps returned tiny files and attempts to read filtered binary files independently', async () => {
    for (let index = 0; index < PROJECT_SOURCE_CONTEXT_LIMITS.maxFiles + 1; index += 1) {
      await file(`${app}/src/Tiny${index}.ts`, 'export {};');
    }
    const tiny = await readProjectSourceContext(db, project, paths);
    expect(tiny.evidence).toHaveLength(PROJECT_SOURCE_CONTEXT_LIMITS.maxFiles);
    expect(tiny.truncated).toBe(true);
    for (let index = 0; index < PROJECT_SOURCE_CONTEXT_SCAN_LIMITS.maxReadFiles + 1; index += 1) {
      await file(`${app}/src/Binary${index}.ts`, Buffer.from([0]));
    }
    const reads = vi.spyOn(fs, 'open');
    const binary = await readProjectSourceContext(db, project, paths, { query: 'Binary' });
    expect(binary.truncated).toBe(true);
    expect(reads.mock.calls.length).toBeLessThanOrEqual(PROJECT_SOURCE_CONTEXT_SCAN_LIMITS.maxReadFiles);
    expect(binary.evidence.every((item) => !item.path.includes('Binary'))).toBe(true);
  });

  it.each(['missing', 'moved', 'replaced'] as const)('clears evidence for a %s source root', async (change) => {
    if (change === 'missing') await fs.rm(source, { recursive: true });
    else await fs.rename(source, `${source}-old`);
    if (change === 'replaced') await fs.mkdir(path.join(source, app), { recursive: true });
    const context = await readProjectSourceContext(db, project, paths);
    expect(context).toMatchObject({ status: 'unavailable', reason: change === 'replaced' ? 'identity_changed' : 'missing_source', evidence: [] });
  });

  it('clears evidence for a replaced package and unsupported binding schema', async () => {
    await fs.rename(path.join(source, app), path.join(source, 'apps/old-web'));
    await fs.mkdir(path.join(source, app));
    expect(await readProjectSourceContext(db, project, paths)).toMatchObject({ status: 'unavailable', reason: 'identity_changed', evidence: [] });
    db.prepare('UPDATE project_codebase_bindings SET schema_version = 99 WHERE project_id = ?').run(project.id);
    expect(await readProjectSourceContext(db, project, paths)).toMatchObject({ status: 'unavailable', reason: 'unsupported_schema', evidence: [] });
  });

  it('reports missing package and unbound projects without evidence', async () => {
    await fs.rm(path.join(source, app), { recursive: true });
    expect(await readProjectSourceContext(db, project, paths)).toMatchObject({ status: 'unavailable', reason: 'missing_app', evidence: [] });
    expect(await readProjectSourceContext(db, { id: 'unbound-project' }, paths)).toMatchObject({
      status: 'needs_selection', projectId: 'unbound-project', bindingRevision: null, reason: 'unbound', evidence: [],
    });
  });

  it('discards evidence when a binding changes during an asynchronous file read', async () => {
    const originalOpen = fs.open.bind(fs);
    let changed = false;
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await originalOpen(...args);
      if (!changed) {
        changed = true;
        db.prepare('UPDATE project_codebase_bindings SET revision = revision + 1 WHERE project_id = ?').run(project.id);
      }
      return handle;
    });
    expect(await readProjectSourceContext(db, project, paths)).toMatchObject({ status: 'unavailable', reason: 'binding_changed', evidence: [] });
    expect(changed).toBe(true);
  });

  it('discards evidence when a source identity changes during collection', async () => {
    const originalOpen = fs.open.bind(fs);
    let changed = false;
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await originalOpen(...args);
      if (!changed) {
        changed = true;
        await fs.rename(source, `${source}-old`);
        await fs.mkdir(path.join(source, app), { recursive: true });
      }
      return handle;
    });
    expect(await readProjectSourceContext(db, project, paths)).toMatchObject({ status: 'unavailable', reason: 'identity_changed', evidence: [] });
  });
});

describe('authorized reverse source lookup', () => {
  it('resolves unique or explicitly selected stable IDs with exact normalized package semantics', async () => {
    expect(await resolveProjectSourceContext(db, [project], paths, { sourceRoot: source, appRelativePath: 'apps/./web/' }))
      .toMatchObject({ status: 'ready', projectId: project.id, bindingRevision: 1 });
    expect(await resolveProjectSourceContext(db, [project], paths, { sourceRoot: source }))
      .toMatchObject({ status: 'needs_selection', reason: 'no_match', evidence: [] });
    await bind('design-b');
    expect(await resolveProjectSourceContext(db, [project, { id: 'design-b' }], paths, { sourceRoot: source, appRelativePath: app, projectId: 'design-b' }))
      .toMatchObject({ status: 'ready', projectId: 'design-b' });
  });

  it('never guesses between ambiguous, absent, mismatched or unauthorized projects', async () => {
    await bind('design-b');
    const request = { sourceRoot: source, appRelativePath: app };
    expect(await resolveProjectSourceContext(db, [project, { id: 'design-b' }], paths, request))
      .toMatchObject({ status: 'needs_selection', projectId: null, reason: 'ambiguous', evidence: [] });
    const sourceRead = vi.spyOn(fs, 'lstat');
    expect(await resolveProjectSourceContext(db, [], paths, request))
      .toMatchObject({ status: 'needs_selection', projectId: null, reason: 'no_match', binding: null, evidence: [] });
    expect(await resolveProjectSourceContext(db, [project], paths, { ...request, projectId: 'design-b' }))
      .toMatchObject({ status: 'needs_selection', projectId: null, reason: 'no_match', binding: null, evidence: [] });
    expect(await resolveProjectSourceContext(db, [project], paths, { ...request, sourceRoot: path.join(root, 'unknown'), projectId: project.id }))
      .toMatchObject({ status: 'needs_selection', reason: 'project_mismatch', binding: null, evidence: [] });
    expect(sourceRead).not.toHaveBeenCalled();
  });

  it('does not guess around stale associations and does not inspect a new caller-supplied location', async () => {
    await fs.rename(source, `${source}-moved`);
    expect(await resolveProjectSourceContext(db, [project], paths, { sourceRoot: source, appRelativePath: app }))
      .toMatchObject({ status: 'unavailable', reason: 'missing_source', evidence: [] });
    const sourceRead = vi.spyOn(fs, 'lstat');
    expect(await resolveProjectSourceContext(db, [project], paths, { sourceRoot: `${source}-moved`, appRelativePath: app, projectId: project.id }))
      .toMatchObject({ status: 'needs_selection', reason: 'project_mismatch', evidence: [] });
    expect(sourceRead).not.toHaveBeenCalled();
  });

  it.each(['../other', 'apps/../../outside', 'apps\\..\\other', '/absolute', 'C:\\outside', 'C:outside', '\0'])('rejects unsafe package selection %j before source inspection', async (appRelativePath) => {
    const sourceRead = vi.spyOn(fs, 'lstat');
    expect(await resolveProjectSourceContext(db, [project], paths, { sourceRoot: source, appRelativePath }))
      .toMatchObject({ status: 'unavailable', reason: 'unsafe_path', evidence: [] });
    expect(sourceRead).not.toHaveBeenCalled();
  });

  it('keeps the wire schema bounded and rejects arbitrary read paths and execution fields', () => {
    expect(projectSourceContextResolveRequestSchema.safeParse({ sourceRoot: source, appRelativePath: app }).success).toBe(true);
    expect(projectSourceContextResolveRequestSchema.safeParse({ sourceRoot: source, query: 'x'.repeat(2_001) }).success).toBe(false);
    expect(projectSourceContextResolveRequestSchema.safeParse({ sourceRoot: source, paths: ['/etc/passwd'] }).success).toBe(false);
    expect(projectSourceContextResolveRequestSchema.safeParse({ sourceRoot: source, command: 'npm install' }).success).toBe(false);
  });
});
