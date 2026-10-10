import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeDatabase,
  detachLocalOnlyPersonalProject,
  ensureWorkspaceProject,
  getProject,
  getWorkspaceProjectByProjectId,
  insertProject,
  isExplicitlyLocalProject,
  listUnboundProjects,
  openDatabase,
  shouldAdoptUnboundProject,
} from '../src/db.js';

describe('explicit local project recovery', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), 'od-explicit-local-'));
  });

  afterEach(() => {
    closeDatabase();
    rmSync(dataDir, { recursive: true, force: true });
  });

  function seed(visibility: 'personal' | 'team' = 'personal', syncState = 'local_only') {
    const db = openDatabase(dataDir, { dataDir });
    const now = Date.now();
    insertProject(db, { id: 'existing', name: 'Existing project', createdAt: now, updatedAt: now });
    ensureWorkspaceProject(db, {
      projectId: 'existing', workspaceId: 'previous-personal', visibility,
      resourceState: 'active', syncState, resourceHubResourceId: null,
      createdByWorkspaceMemberId: 'previous-member', updatedByWorkspaceMemberId: 'previous-member',
      cloudTombstonedAt: null, createdAt: now, updatedAt: now,
    });
    db.prepare('INSERT INTO conversations (id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('conversation-1', 'existing', 'Keep me', now, now);
    return db;
  }

  it('detaches only the exact local Personal owner without deleting project data', () => {
    const db = seed();
    expect(detachLocalOnlyPersonalProject(db, 'existing', 'wrong-workspace')).toBe(false);
    expect(getWorkspaceProjectByProjectId(db, 'existing')).toBeDefined();

    expect(detachLocalOnlyPersonalProject(db, 'existing', 'previous-personal')).toBe(true);
    expect(getWorkspaceProjectByProjectId(db, 'existing')).toBeUndefined();
    expect(isExplicitlyLocalProject(db, 'existing')).toBe(true);
    expect(shouldAdoptUnboundProject(db, 'existing')).toBe(false);
    expect(listUnboundProjects(db).map((project) => project.id)).toContain('existing');
    expect(getProject(db, 'existing')?.name).toBe('Existing project');
    expect(db.prepare('SELECT title FROM conversations WHERE id = ?').get('conversation-1'))
      .toMatchObject({ title: 'Keep me' });
    expect(detachLocalOnlyPersonalProject(db, 'existing', 'previous-personal')).toBe(false);

    closeDatabase();
    const reopened = openDatabase(dataDir, { dataDir });
    expect(isExplicitlyLocalProject(reopened, 'existing')).toBe(true);
    const now = Date.now();
    insertProject(reopened, { id: 'legacy-orphan', name: 'Legacy', createdAt: now, updatedAt: now });
    expect(shouldAdoptUnboundProject(reopened, 'legacy-orphan')).toBe(true);
  });

  it('refuses to detach Team or synchronized projects', () => {
    const db = seed('team');
    expect(detachLocalOnlyPersonalProject(db, 'existing', 'previous-personal')).toBe(false);
    expect(isExplicitlyLocalProject(db, 'existing')).toBe(false);

    db.prepare('UPDATE workspace_projects SET visibility = ?, sync_state = ? WHERE project_id = ?')
      .run('personal', 'synced', 'existing');
    expect(detachLocalOnlyPersonalProject(db, 'existing', 'previous-personal')).toBe(false);
    expect(getWorkspaceProjectByProjectId(db, 'existing')).toBeDefined();
  });
});
