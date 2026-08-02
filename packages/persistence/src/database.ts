import { DatabaseSync } from 'node:sqlite';

const migration = `
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = FULL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS drafts (
    workspace_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    version INTEGER NOT NULL CHECK (version > 0),
    source_revision TEXT NOT NULL,
    front_matter_json TEXT NOT NULL,
    body TEXT NOT NULL,
    saved_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, document_id)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    type TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK (
      status IN ('queued', 'running', 'succeeded', 'failed', 'canceled')
    ),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    lease_owner TEXT,
    lease_expires_at TEXT,
    CHECK (
      (status = 'running' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
      OR status != 'running'
    )
  ) STRICT;

  CREATE INDEX IF NOT EXISTS jobs_acquire_index
    ON jobs(status, lease_expires_at, created_at);

  CREATE TABLE IF NOT EXISTS releases (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (
      status IN (
        'queued', 'preflight', 'building', 'planning', 'uploading-assets',
        'uploading-pages', 'invalidating-cache', 'verifying', 'succeeded',
        'failed', 'rollback-required', 'rolling-back', 'rolled-back', 'canceled'
      )
    ),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    stages_json TEXT NOT NULL,
    manifest_hash TEXT,
    previous_release_id TEXT,
    manifest_json TEXT
  ) STRICT;

  CREATE UNIQUE INDEX IF NOT EXISTS releases_one_active_target
    ON releases(workspace_id, target_id)
    WHERE status IN (
      'queued', 'preflight', 'building', 'planning', 'uploading-assets',
      'uploading-pages', 'invalidating-cache', 'verifying',
      'rollback-required', 'rolling-back'
    );

  CREATE TABLE IF NOT EXISTS release_events (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    release_id TEXT NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
    at TEXT NOT NULL,
    stage TEXT NOT NULL,
    level TEXT NOT NULL CHECK (level IN ('info', 'warning', 'error')),
    message TEXT NOT NULL,
    completed INTEGER,
    total INTEGER
  ) STRICT;

  CREATE INDEX IF NOT EXISTS release_events_release
    ON release_events(release_id, sequence);
`;

export type StudioDatabase = DatabaseSync;

export function openStudioDatabase(path: string): StudioDatabase {
  const database = new DatabaseSync(path, {
    enableForeignKeyConstraints: true,
    timeout: 5_000,
  });
  database.exec(migration);
  return database;
}
