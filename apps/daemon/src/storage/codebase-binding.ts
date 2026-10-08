import type Database from 'better-sqlite3';
import type { ProjectCodebaseBinding } from '@open-design/contracts';

export interface StoredCodebaseBinding extends ProjectCodebaseBinding {
  sourceIdentity: string | null;
  appIdentity: string | null;
}

/** Local-only table: intentionally absent from project metadata and sync/export DTOs. */
export function migrateCodebaseBindings(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_codebase_bindings (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      schema_version INTEGER NOT NULL,
      revision INTEGER NOT NULL,
      source_root TEXT NOT NULL,
      app_relative_path TEXT NOT NULL,
      source_identity TEXT,
      app_identity TEXT,
      updated_at INTEGER NOT NULL
    );
  `);
}

export function getCodebaseBinding(db: Database.Database, projectId: string): StoredCodebaseBinding | null {
  return db.prepare(`
    SELECT schema_version AS schemaVersion, revision, source_root AS sourceRoot,
      app_relative_path AS appRelativePath, source_identity AS sourceIdentity,
      app_identity AS appIdentity, updated_at AS updatedAt
    FROM project_codebase_bindings WHERE project_id = ?
  `).get(projectId) as StoredCodebaseBinding | undefined ?? null;
}

export class CodebaseBindingConflictError extends Error {
  constructor(public readonly unsupported = false) {
    super(unsupported
      ? 'This connection was saved by a newer version. Update OpenDesign before changing it.'
      : 'The codebase connection changed. Reload it before saving again.');
  }
}

export function saveCodebaseBinding(
  db: Database.Database,
  projectId: string,
  expectedRevision: number | null,
  selection: Pick<StoredCodebaseBinding, 'sourceRoot' | 'appRelativePath' | 'sourceIdentity' | 'appIdentity'>,
): StoredCodebaseBinding {
  return db.transaction(() => {
    const previous = getCodebaseBinding(db, projectId);
    if (previous && previous.schemaVersion !== 1) throw new CodebaseBindingConflictError(true);
    if ((previous?.revision ?? null) !== expectedRevision) throw new CodebaseBindingConflictError();
    if (previous && previous.sourceRoot === selection.sourceRoot
      && previous.appRelativePath === selection.appRelativePath
      && previous.sourceIdentity === selection.sourceIdentity
      && previous.appIdentity === selection.appIdentity) return previous;
    const revision = (previous?.revision ?? 0) + 1;
    if (!Number.isSafeInteger(revision)) throw new CodebaseBindingConflictError(true);
    const next: StoredCodebaseBinding = {
      sourceRoot: selection.sourceRoot, appRelativePath: selection.appRelativePath,
      sourceIdentity: selection.sourceIdentity, appIdentity: selection.appIdentity,
      schemaVersion: 1, revision, updatedAt: Date.now(),
    };
    db.prepare(`
      INSERT INTO project_codebase_bindings
        (project_id, schema_version, revision, source_root, app_relative_path, source_identity, app_identity, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET
        schema_version = excluded.schema_version, revision = excluded.revision,
        source_root = excluded.source_root, app_relative_path = excluded.app_relative_path,
        source_identity = excluded.source_identity, app_identity = excluded.app_identity,
        updated_at = excluded.updated_at
    `).run(projectId, next.schemaVersion, next.revision, next.sourceRoot,
      next.appRelativePath, next.sourceIdentity, next.appIdentity, next.updatedAt);
    return next;
  }).immediate();
}
