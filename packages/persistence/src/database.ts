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
