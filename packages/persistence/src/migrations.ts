import type { DatabaseSync } from 'node:sqlite';

interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

const migrations: readonly Migration[] = [
  {
    version: 1,
    name: 'v0.1-baseline',
    sql: `
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
    `,
  },
  {
    version: 2,
    name: 'site-first-foundation',
    sql: `
      CREATE TABLE IF NOT EXISTS owner_credentials (
        owner_id INTEGER PRIMARY KEY CHECK (owner_id = 1),
        verifier TEXT NOT NULL,
        generation INTEGER NOT NULL CHECK (generation > 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS owner_sessions (
        token_hash TEXT PRIMARY KEY,
        credential_generation INTEGER NOT NULL CHECK (credential_generation > 0),
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS owner_sessions_expiry
        ON owner_sessions(expires_at);

      CREATE TABLE IF NOT EXISTS sites (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        canonical_url TEXT,
        configuration_path TEXT NOT NULL UNIQUE,
        capabilities_json TEXT NOT NULL CHECK (json_valid(capabilities_json)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS change_sets (
        id TEXT PRIMARY KEY,
        site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
        status TEXT NOT NULL CHECK (
          status IN ('prepared', 'applied', 'committed', 'superseded', 'invalidated')
        ),
        fingerprint TEXT NOT NULL,
        base_revision TEXT NOT NULL,
        payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        applied_at TEXT,
        commit_id TEXT
      ) STRICT;

      CREATE INDEX IF NOT EXISTS change_sets_site_created
        ON change_sets(site_id, created_at DESC);
    `,
  },
];

export const STUDIO_SCHEMA_VERSION = migrations.at(-1)?.version ?? 0;

export class UnsupportedDatabaseVersionError extends Error {
  public constructor(
    readonly foundVersion: number,
    readonly supportedVersion: number,
  ) {
    super(
      `Database schema version ${foundVersion} is newer than supported version ${supportedVersion}`,
    );
    this.name = 'UnsupportedDatabaseVersionError';
  }
}

function currentVersion(database: DatabaseSync): number {
  const row = database
    .prepare(
      'SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations',
    )
    .get() as { readonly version: number };
  return row.version;
}

export function migrateStudioDatabase(database: DatabaseSync): void {
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY CHECK (version > 0),
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);

  const foundVersion = currentVersion(database);
  if (foundVersion > STUDIO_SCHEMA_VERSION) {
    throw new UnsupportedDatabaseVersionError(
      foundVersion,
      STUDIO_SCHEMA_VERSION,
    );
  }

  for (const migration of migrations) {
    if (migration.version <= foundVersion) continue;
    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec(migration.sql);
      database
        .prepare(
          `INSERT INTO schema_migrations (version, name, applied_at)
           VALUES (?, ?, ?)`,
        )
        .run(migration.version, migration.name, new Date().toISOString());
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
}
