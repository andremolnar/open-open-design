import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  discoverProjectContext, PROJECT_CONTEXT_DISCOVERY_LIMITS,
  type ProjectContextDiscoveryProject,
} from '../../src/services/project-context-discovery.js';
import { validateCodebaseBinding } from '../../src/services/codebase-binding.js';
import { getCodebaseBinding, migrateCodebaseBindings, saveCodebaseBinding } from '../../src/storage/codebase-binding.js';

let root: string;
let source: string;
let db: Database.Database;
let paths: { projectsRoot: string; runtimeDataRoot: string };
const app = 'apps/web';
const scope = { workspaceId: 'team-a', workspaceMemberId: 'member-a', workspaceName: 'Design team', workspaceType: 'team' as const };
const project: ProjectContextDiscoveryProject = { id: 'design-a', name: 'Web design', metadata: {}, workspaceScope: scope };
const other: ProjectContextDiscoveryProject = { id: 'design-b', name: 'Other design', workspaceScope: null };

async function bind(candidate = project, relative = app, sourceRoot = source) {
  db.prepare('INSERT OR IGNORE INTO projects (id) VALUES (?)').run(candidate.id);
  const selection = await validateCodebaseBinding(candidate, paths, { sourceRoot, appRelativePath: relative });
  return saveCodebaseBinding(db, candidate.id, getCodebaseBinding(db, candidate.id)?.revision ?? null, selection);
}

function noFilesystemInspection() {
  return ['access', 'lstat', 'realpath', 'stat', 'open', 'readFile', 'readdir', 'opendir']
    .map((name) => vi.spyOn(fs, name as 'lstat'));
}

beforeEach(async () => {
  vi.stubEnv('OD_SANDBOX_MODE', '0');
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'od-context-discovery-')));
  source = path.join(root, 'source');
  paths = { runtimeDataRoot: path.join(root, 'runtime'), projectsRoot: path.join(root, 'runtime/projects') };
  await fs.mkdir(paths.projectsRoot, { recursive: true });
  await fs.mkdir(path.join(source, app, 'src/components'), { recursive: true });
  await fs.mkdir(path.join(source, 'apps/other/src'), { recursive: true });
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

describe('caller cwd binding discovery', () => {
  it.each(['', '/src', '/src/components'])('selects a unique app or nested cwd %s with verified scope and no source evidence', async (suffix) => {
    const result = await discoverProjectContext(db, [project], paths, { cwd: `${path.join(source, app)}${suffix}` });
    expect(result).toMatchObject({
      status: 'ready', reason: null, truncated: false,
      selected: { projectId: project.id, projectName: project.name, workspaceScope: scope,
        sourceRoot: source, appRelativePath: app, bindingRevision: 1, status: 'ready', match: 'within_app' },
      coverage: { scope: 'authorized_projects', scannedProjects: 1, scanTruncated: false, candidatesTruncated: false },
      limits: PROJECT_CONTEXT_DISCOVERY_LIMITS,
    });
    expect(result.candidates).toEqual([result.selected]);
    expect(result).not.toHaveProperty('evidence');
    expect(result).not.toHaveProperty('cwd');
    expect(result.selected).not.toHaveProperty('evidence');
  });

  it.each(['.', 'apps'])('finds a bound package from a contained ancestor %s', async (relative) => {
    expect(await discoverProjectContext(db, [project], paths, { cwd: path.join(source, relative) }))
      .toMatchObject({ status: 'ready', selected: { match: 'ancestor_of_app' } });
  });

  it('returns all matching monorepo packages at the source root and does not guess', async () => {
    await bind(other, 'apps/other');
    const result = await discoverProjectContext(db, [project, other], paths, { cwd: source });
    expect(result).toMatchObject({ status: 'needs_selection', reason: 'ambiguous', selected: null, truncated: false });
    expect(result.candidates.map((candidate) => [candidate.projectId, candidate.match])).toEqual([
      [project.id, 'ancestor_of_app'], [other.id, 'ancestor_of_app'],
    ]);
    expect(result.candidates[1]?.workspaceScope).toBeNull();
    expect(await discoverProjectContext(db, [project, other], paths, { cwd: path.join(source, app) }))
      .toMatchObject({ status: 'ready', selected: { projectId: project.id } });
  });

  it('keeps overlapping whole-repository and package bindings ambiguous even for deeply nested cwd', async () => {
    await bind(other, '.');
    const request = { cwd: path.join(source, app, 'src/components') };
    expect(await discoverProjectContext(db, [project, other], paths, request))
      .toMatchObject({ status: 'needs_selection', reason: 'ambiguous', selected: null, candidates: [{ match: 'within_app' }, { match: 'within_app' }] });
    expect(await discoverProjectContext(db, [project, other], paths, { ...request, projectId: project.id }))
      .toMatchObject({ status: 'ready', selected: { projectId: project.id } });
  });

  it('deduplicates identical authority entries but retains distinct exact scopes', async () => {
    expect(await discoverProjectContext(db, [project, project], paths, { cwd: source }))
      .toMatchObject({ status: 'ready', candidates: [{ projectId: project.id }] });
    const secondScope = { ...project, workspaceScope: { ...scope, workspaceMemberId: 'member-b' } };
    expect(await discoverProjectContext(db, [project, secondScope], paths, { cwd: source }))
      .toMatchObject({ status: 'needs_selection', reason: 'ambiguous', selected: null });
  });

  it('defensively restricts exact explicit membership and preserves caller coverage', async () => {
    await bind(other, '.');
    const request = { cwd: source, workspaceId: scope.workspaceId, workspaceMemberId: scope.workspaceMemberId };
    expect(await discoverProjectContext(db, [other, project], paths, request, { coverageScope: 'explicit_workspace' }))
      .toMatchObject({ status: 'ready', selected: { workspaceScope: scope }, coverage: { scope: 'explicit_workspace' } });
    const inspection = noFilesystemInspection();
    expect(await discoverProjectContext(db, [project, other], paths, { ...request, workspaceMemberId: 'denied-member' }))
      .toMatchObject({ status: 'needs_selection', reason: 'no_match', candidates: [], selected: null });
    for (const operation of inspection) expect(operation).not.toHaveBeenCalled();
  });

  it('uses only supplied authorized projects, without disclosing an excluded matching record', async () => {
    await bind(other, '.');
    const result = await discoverProjectContext(db, [other], paths, { cwd: source }, { coverageScope: 'unbound_local' });
    expect(result).toMatchObject({ status: 'ready', selected: { projectId: other.id, workspaceScope: null }, coverage: { scope: 'unbound_local' } });
    expect(JSON.stringify(result)).not.toMatch(/design-a|Design team|team-a|member-a/);
    const inspection = noFilesystemInspection();
    const denied = await discoverProjectContext(db, [other], paths, { cwd: source, projectId: project.id });
    expect(denied).toMatchObject({ status: 'needs_selection', reason: 'no_match', candidates: [], selected: null });
    expect(JSON.stringify(denied)).not.toContain(project.id);
    for (const operation of inspection) expect(operation).not.toHaveBeenCalled();
  });

  it('distinguishes an authorized explicit project mismatch from an unknown project without inspecting cwd', async () => {
    const inspection = noFilesystemInspection();
    expect(await discoverProjectContext(db, [project], paths, { cwd: path.join(source, 'apps/other'), projectId: project.id }))
      .toMatchObject({ status: 'needs_selection', reason: 'project_mismatch', candidates: [] });
    for (const operation of inspection) expect(operation).not.toHaveBeenCalled();
  });

  it.each(['ancestor', 'prefix-sibling', 'package-prefix-sibling', 'other-package', 'outside-missing'])('does not inspect unmatched %s caller paths', async (kind) => {
    const cwd = {
      ancestor: root,
      'prefix-sibling': `${source}-other`,
      'package-prefix-sibling': path.join(source, `${app}-extra`),
      'other-package': path.join(source, 'apps/other'),
      'outside-missing': path.join(root, 'missing/source'),
    }[kind]!;
    const inspection = noFilesystemInspection();
    expect(await discoverProjectContext(db, [project], paths, { cwd }))
      .toMatchObject({ status: 'needs_selection', reason: 'no_match', candidates: [] });
    for (const operation of inspection) expect(operation).not.toHaveBeenCalled();
  });

  it.each(['relative', '/tmp/../repo', '/tmp/./../repo', '/tmp/control\npath', '/tmp/control\u007fpath', 'C:\\repo\\app', 'C:/repo/app', '\\\\server\\repo', '//server/repo', '/tmp/windows\\shape'])('rejects unsafe or foreign-host cwd without filesystem I/O: %j', async (cwd) => {
    if (process.platform === 'win32') return;
    const inspection = noFilesystemInspection();
    expect(await discoverProjectContext(db, [project], paths, { cwd }))
      .toMatchObject({ status: 'unavailable', reason: 'unsafe_path', candidates: [], selected: null });
    for (const operation of inspection) expect(operation).not.toHaveBeenCalled();
  });

  it.each(['node_modules/lib', 'bower_components/lib', '.git/worktrees', '.aws/configs', '.env.local', 'private-key', 'service-account', 'my-secrets'])('rejects excluded dependency or secret cwd segments %s before inspection', async (relative) => {
    const inspection = noFilesystemInspection();
    expect(await discoverProjectContext(db, [project], paths, { cwd: path.join(source, app, relative) }))
      .toMatchObject({ status: 'unavailable', reason: 'unsafe_path', candidates: [] });
    for (const operation of inspection) expect(operation).not.toHaveBeenCalled();
  });

  it('rejects an excluded bound package even when cwd is its ordinary ancestor', async () => {
    await fs.mkdir(path.join(source, 'node_modules/library'), { recursive: true });
    await bind(project, 'node_modules/library');
    const inspection = noFilesystemInspection();
    expect(await discoverProjectContext(db, [project], paths, { cwd: source }))
      .toMatchObject({ status: 'unavailable', reason: 'unsafe_path', candidates: [{ status: 'unavailable' }] });
    for (const operation of inspection) expect(operation).not.toHaveBeenCalled();
  });

  it('does not follow a source alias to infer an association', async () => {
    const alias = path.join(root, 'source-alias');
    await fs.symlink(source, alias, 'dir');
    const inspection = noFilesystemInspection();
    expect(await discoverProjectContext(db, [project], paths, { cwd: path.join(alias, app) }))
      .toMatchObject({ status: 'needs_selection', reason: 'no_match', candidates: [] });
    for (const operation of inspection) expect(operation).not.toHaveBeenCalled();
  });

  it('rejects a matching cwd containing an internal symlink even if it points into the same app', async () => {
    await fs.symlink(path.join(source, app, 'src'), path.join(source, app, 'alias'), 'dir');
    expect(await discoverProjectContext(db, [project], paths, { cwd: path.join(source, app, 'alias/components') }))
      .toMatchObject({ status: 'unavailable', reason: 'unsafe_path', selected: null, candidates: [{ status: 'unavailable' }] });
  });

  it('rejects a saved app reached through an internal symlink', async () => {
    await fs.symlink(path.join(source, app), path.join(source, 'alias'), 'dir');
    await bind(project, 'alias');
    expect(await discoverProjectContext(db, [project], paths, { cwd: source }))
      .toMatchObject({ status: 'unavailable', reason: 'unsafe_path', selected: null });
  });

  it.each(['missing', 'file'])('reports %s matched cwd without leaking filesystem errors', async (kind) => {
    const cwd = path.join(source, app, 'unavailable');
    if (kind === 'file') await fs.writeFile(cwd, 'DO_NOT_READ');
    expect(await discoverProjectContext(db, [project], paths, { cwd }))
      .toMatchObject({ status: 'unavailable', reason: 'missing_cwd', selected: null, candidates: [{ reason: 'missing_cwd' }] });
  });

  it('reports inaccessible matched cwd with a bounded diagnostic', async () => {
    const cwd = path.join(source, app, 'src');
    const original = fs.lstat.bind(fs);
    vi.spyOn(fs, 'lstat').mockImplementation(async (...args) => {
      if (String(args[0]) === cwd) throw Object.assign(new Error('credential=DO_NOT_LEAK'), { code: 'EACCES' });
      return original(...args);
    });
    const result = await discoverProjectContext(db, [project], paths, { cwd });
    expect(result).toMatchObject({ status: 'unavailable', reason: 'inaccessible_cwd', selected: null });
    expect(JSON.stringify(result)).not.toContain('DO_NOT_LEAK');
  });

  it.each(['source', 'app'])('reports moved %s bindings and never searches for their new location', async (kind) => {
    const target = kind === 'source' ? source : path.join(source, app);
    await fs.rename(target, `${target}-moved`);
    const result = await discoverProjectContext(db, [project], paths, { cwd: path.join(source, app) });
    expect(result).toMatchObject({ status: 'unavailable', reason: kind === 'source' ? 'missing_source' : 'missing_app', selected: null });
    expect(result.candidates).toHaveLength(1);
  });

  it.each(['source', 'app'])('fails closed on replacement of the saved %s directory identity', async (kind) => {
    const target = kind === 'source' ? source : path.join(source, app);
    await fs.rename(target, `${target}-old`);
    await fs.mkdir(path.join(source, app, 'src'), { recursive: true });
    expect(await discoverProjectContext(db, [project], paths, { cwd: path.join(source, app) }))
      .toMatchObject({ status: 'unavailable', reason: 'identity_changed', selected: null });
  });

  it('does not auto-select a ready candidate when another total match is stale', async () => {
    await bind(other, 'apps/other');
    await fs.rename(path.join(source, 'apps/other'), path.join(source, 'apps/other-moved'));
    const result = await discoverProjectContext(db, [project, other], paths, { cwd: source });
    expect(result).toMatchObject({ status: 'needs_selection', reason: 'ambiguous', selected: null });
    expect(result.candidates.map((candidate) => candidate.status)).toEqual(['ready', 'unavailable']);
  });

  it('reports an unsupported saved schema without selecting it', async () => {
    db.prepare('UPDATE project_codebase_bindings SET schema_version = 2 WHERE project_id = ?').run(project.id);
    expect(await discoverProjectContext(db, [project], paths, { cwd: source }))
      .toMatchObject({ status: 'unavailable', reason: 'unsupported_schema', selected: null });
  });

  it('rejects a rebind during asynchronous cwd checking', async () => {
    const cwd = path.join(source, app, 'src');
    const replacement = await validateCodebaseBinding(project, paths, { sourceRoot: source, appRelativePath: 'apps/other' });
    const original = fs.lstat.bind(fs);
    let changed = false;
    vi.spyOn(fs, 'lstat').mockImplementation(async (...args) => {
      if (!changed && String(args[0]) === cwd) {
        changed = true;
        saveCodebaseBinding(db, project.id, 1, replacement);
      }
      return original(...args);
    });
    expect(await discoverProjectContext(db, [project], paths, { cwd }))
      .toMatchObject({ status: 'unavailable', reason: 'binding_changed', selected: null, candidates: [{ bindingRevision: 1 }] });
    expect(changed).toBe(true);
  });

  it('rechecks saved identity after a source replacement during cwd checking', async () => {
    const cwd = path.join(source, app, 'src');
    const original = fs.lstat.bind(fs);
    let changed = false;
    vi.spyOn(fs, 'lstat').mockImplementation(async (...args) => {
      if (!changed && String(args[0]) === cwd) {
        changed = true;
        await fs.rename(source, `${source}-old`);
        await fs.mkdir(cwd, { recursive: true });
      }
      return original(...args);
    });
    expect(await discoverProjectContext(db, [project], paths, { cwd }))
      .toMatchObject({ status: 'unavailable', reason: 'identity_changed', selected: null });
    expect(changed).toBe(true);
  });

  it('does not leave earlier candidate revisions ready after inspecting a later candidate', async () => {
    await bind(other, 'apps/other');
    const original = fs.lstat.bind(fs);
    let changed = false;
    vi.spyOn(fs, 'lstat').mockImplementation(async (...args) => {
      if (!changed && String(args[0]) === path.join(source, 'apps/other')) {
        changed = true;
        db.prepare('UPDATE project_codebase_bindings SET revision = 2 WHERE project_id = ?').run(project.id);
      }
      return original(...args);
    });
    const result = await discoverProjectContext(db, [project, other], paths, { cwd: source });
    expect(result).toMatchObject({ status: 'needs_selection', reason: 'ambiguous', selected: null });
    expect(result.candidates[0]).toMatchObject({ status: 'unavailable', reason: 'binding_changed' });
    expect(changed).toBe(true);
  });

  it('bounds path depth before any lookup, without exposing the rejected cwd', async () => {
    const cwd = `/${Array.from({ length: PROJECT_CONTEXT_DISCOVERY_LIMITS.maxPathDepth + 1 }, () => 'nested').join('/')}`;
    const inspection = noFilesystemInspection();
    expect(await discoverProjectContext(db, [project], paths, { cwd }))
      .toMatchObject({ status: 'unavailable', reason: 'path_depth_exceeded', candidates: [], selected: null });
    for (const operation of inspection) expect(operation).not.toHaveBeenCalled();
  });

  it('bounds candidate output and leaves truncated matches unselected', async () => {
    const binding = getCodebaseBinding(db, project.id)!;
    const projects = [project];
    for (let index = 1; index <= PROJECT_CONTEXT_DISCOVERY_LIMITS.maxCandidates; index += 1) {
      const candidate = { ...project, id: `design-${index}` };
      db.prepare('INSERT INTO projects (id) VALUES (?)').run(candidate.id);
      saveCodebaseBinding(db, candidate.id, null, binding);
      projects.push(candidate);
    }
    const result = await discoverProjectContext(db, projects, paths, { cwd: source });
    expect(result).toMatchObject({ status: 'needs_selection', reason: 'selection_incomplete', selected: null,
      truncated: true, coverage: { candidatesTruncated: true } });
    expect(result.candidates).toHaveLength(PROJECT_CONTEXT_DISCOVERY_LIMITS.maxCandidates);
  });

  it('never auto-selects a lone known match when the authorized project scan is truncated', async () => {
    const projects = [project, ...Array.from({ length: PROJECT_CONTEXT_DISCOVERY_LIMITS.maxScannedProjects }, (_, index) => ({ ...other, id: `absent-${index}` }))];
    const result = await discoverProjectContext(db, projects, paths, { cwd: source });
    expect(result).toMatchObject({ status: 'needs_selection', reason: 'selection_incomplete', selected: null,
      truncated: true, coverage: { scanTruncated: true, scannedProjects: PROJECT_CONTEXT_DISCOVERY_LIMITS.maxScannedProjects } });
    expect(result.candidates).toHaveLength(1);
  });

  it('honors upstream authority/catalog truncation even with one matching project', async () => {
    expect(await discoverProjectContext(db, [project], paths, { cwd: source }, { scanTruncated: true, coverageScope: 'authorized_projects' }))
      .toMatchObject({ status: 'needs_selection', reason: 'selection_incomplete', selected: null,
        truncated: true, candidates: [{ status: 'ready' }], coverage: { scanTruncated: true } });
  });

  it.each(['projectId', 'projectName', 'workspaceId', 'workspaceMemberId', 'workspaceName', 'control', 'workspaceType'])('fails closed on malformed or oversized authority %s without disclosing it', async (field) => {
    const invalid = { ...other, workspaceScope: { ...scope } };
    if (field === 'projectId') invalid.id = 'x'.repeat(257);
    if (field === 'projectName') invalid.name = 'x'.repeat(1_025);
    if (field === 'workspaceId') invalid.workspaceScope.workspaceId = 'x'.repeat(257);
    if (field === 'workspaceMemberId') invalid.workspaceScope.workspaceMemberId = 'x'.repeat(257);
    if (field === 'workspaceName') invalid.workspaceScope.workspaceName = 'x'.repeat(1_025);
    if (field === 'control') invalid.name = 'control\nDO_NOT_LEAK';
    if (field === 'workspaceType') Object.assign(invalid.workspaceScope, { workspaceType: 'unverified' });
    const result = await discoverProjectContext(db, [project, invalid], paths, { cwd: source });
    expect(result).toMatchObject({ status: 'needs_selection', reason: 'selection_incomplete', selected: null,
      truncated: true, candidates: [{ projectId: project.id }], coverage: { scanTruncated: true } });
    expect(result.candidates).toHaveLength(1);
    expect(JSON.stringify(result)).not.toMatch(/x{257}|DO_NOT_LEAK|unverified/);
  });

  it('honors the synchronous authority fence before reading a saved binding or inspecting paths', async () => {
    const inspection = noFilesystemInspection();
    const reads = vi.spyOn(db, 'prepare');
    const result = await discoverProjectContext(db, [project], paths, { cwd: source }, { isProjectAuthorized: () => false });
    expect(result).toMatchObject({ status: 'needs_selection', reason: 'no_match', candidates: [], selected: null });
    expect(reads).not.toHaveBeenCalled();
    for (const operation of inspection) expect(operation).not.toHaveBeenCalled();
  });

  it('does not inspect a later candidate whose authorization was revoked during an earlier inspection', async () => {
    await bind(other, 'apps/other');
    let revoked = false;
    const original = fs.lstat.bind(fs);
    const inspection = vi.spyOn(fs, 'lstat').mockImplementation(async (...args) => {
      if (String(args[0]) === path.join(source, app)) revoked = true;
      return original(...args);
    });
    const result = await discoverProjectContext(db, [project, other], paths, { cwd: source }, {
      isProjectAuthorized: (candidate) => candidate.id !== other.id || !revoked,
    });
    expect(result).toMatchObject({ status: 'ready', selected: { projectId: project.id } });
    expect(result.candidates).toHaveLength(1);
    expect(inspection.mock.calls.map((args) => String(args[0]))).not.toContain(path.join(source, 'apps/other'));
    expect(JSON.stringify(result)).not.toContain(other.id);
  });

  it.each([false, true])('drops all metadata, including explicit project existence (%s), when access is revoked during cwd inspection', async (explicit) => {
    const cwd = path.join(source, app, 'src');
    let revoked = false;
    const original = fs.lstat.bind(fs);
    vi.spyOn(fs, 'lstat').mockImplementation(async (...args) => {
      if (String(args[0]) === cwd) revoked = true;
      return original(...args);
    });
    const result = await discoverProjectContext(db, [project], paths, { cwd, ...(explicit ? { projectId: project.id } : {}) }, { isProjectAuthorized: () => !revoked });
    expect(result).toMatchObject({ status: 'needs_selection', reason: 'no_match', candidates: [], selected: null });
    expect(JSON.stringify(result)).not.toMatch(/design-a|team-a|member-a/);
    expect(JSON.stringify(result)).not.toContain(source);
  });

  it('drops an earlier candidate when access is revoked while inspecting a later one', async () => {
    await bind(other, 'apps/other');
    let revoked = false;
    const original = fs.lstat.bind(fs);
    vi.spyOn(fs, 'lstat').mockImplementation(async (...args) => {
      if (String(args[0]) === path.join(source, 'apps/other')) revoked = true;
      return original(...args);
    });
    const result = await discoverProjectContext(db, [project, other], paths, { cwd: source }, {
      isProjectAuthorized: (candidate) => candidate.id !== project.id || !revoked,
    });
    expect(result).toMatchObject({ status: 'ready', selected: { projectId: other.id } });
    expect(result.candidates).toHaveLength(1);
    expect(JSON.stringify(result)).not.toMatch(/design-a|team-a|member-a/);
  });

  it('checks the saved snapshot before inspecting a later candidate rebound to an unrelated root', async () => {
    await bind(other, 'apps/other');
    const unrelated = path.join(root, 'unrelated');
    await fs.mkdir(unrelated);
    const selection = await validateCodebaseBinding(other, paths, { sourceRoot: unrelated, appRelativePath: '.' });
    const original = fs.lstat.bind(fs);
    let changed = false;
    vi.spyOn(fs, 'lstat').mockImplementation(async (...args) => {
      if (!changed && String(args[0]) === path.join(source, app)) {
        changed = true;
        saveCodebaseBinding(db, other.id, 1, selection);
      }
      return original(...args);
    });
    const realpaths = vi.spyOn(fs, 'realpath');
    const result = await discoverProjectContext(db, [project, other], paths, { cwd: source });
    expect(result.candidates[1]).toMatchObject({ status: 'unavailable', reason: 'binding_changed', sourceRoot: source });
    expect(realpaths.mock.calls.map((args) => String(args[0]))).not.toContain(unrelated);
  });

  it('checks the saved snapshot before the final status call can inspect a rebound unrelated root', async () => {
    const unrelated = path.join(root, 'unrelated');
    await fs.mkdir(unrelated);
    const selection = await validateCodebaseBinding(project, paths, { sourceRoot: unrelated, appRelativePath: '.' });
    const cwd = path.join(source, app, 'src');
    const original = fs.lstat.bind(fs);
    let changed = false;
    vi.spyOn(fs, 'lstat').mockImplementation(async (...args) => {
      if (!changed && String(args[0]) === cwd) {
        changed = true;
        saveCodebaseBinding(db, project.id, 1, selection);
      }
      return original(...args);
    });
    const realpaths = vi.spyOn(fs, 'realpath');
    expect(await discoverProjectContext(db, [project], paths, { cwd }))
      .toMatchObject({ status: 'unavailable', reason: 'binding_changed', selected: null });
    expect(realpaths.mock.calls.map((args) => String(args[0]))).not.toContain(unrelated);
  });

  it('fails closed when a nested cwd is replaced with an ordinary directory after its first check', async () => {
    const cwd = path.join(source, app, 'src/components');
    const original = fs.access.bind(fs);
    let changed = false;
    vi.spyOn(fs, 'access').mockImplementation(async (...args) => {
      if (!changed && String(args[0]) === cwd) {
        changed = true;
        await fs.rename(cwd, `${cwd}-old`);
        await fs.mkdir(cwd);
      }
      return original(...args);
    });
    expect(await discoverProjectContext(db, [project], paths, { cwd }))
      .toMatchObject({ status: 'unavailable', reason: 'identity_changed', selected: null });
    expect(changed).toBe(true);
  });

  it('does not read evidence, write files/SQLite, change cwd, or launch processes', async () => {
    await fs.writeFile(path.join(source, app, 'AGENTS.md'), 'SOURCE_CONTENT_MUST_NOT_BE_READ');
    const before = db.serialize();
    const fileInfo = await fs.stat(path.join(source, app, 'AGENTS.md'), { bigint: true });
    const filesystem = ['open', 'readFile', 'readdir', 'opendir', 'writeFile', 'appendFile', 'mkdir', 'rm', 'rename', 'chmod']
      .map((name) => vi.spyOn(fs, name as 'readFile'));
    const processes = ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']
      .map((name) => vi.spyOn(childProcess, name as 'spawn'));
    const changeDirectory = vi.spyOn(process, 'chdir');
    const result = await discoverProjectContext(db, [project], paths, { cwd: path.join(source, app, 'src') });
    expect(result.status).toBe('ready');
    expect(JSON.stringify(result)).not.toContain('SOURCE_CONTENT_MUST_NOT_BE_READ');
    for (const operation of [...filesystem, ...processes, changeDirectory]) expect(operation).not.toHaveBeenCalled();
    expect(db.serialize()).toEqual(before);
    expect(await fs.stat(path.join(source, app, 'AGENTS.md'), { bigint: true })).toMatchObject({ mtimeNs: fileInfo.mtimeNs, mode: fileInfo.mode, size: fileInfo.size });
  });
});
