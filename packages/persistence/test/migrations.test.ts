import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import {
  openStudioDatabase,
  STUDIO_SCHEMA_VERSION,
  UnsupportedDatabaseVersionError,
} from '../src/index.js';

const temporaryDirectories: string[] = [];

function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'blog-studio-migration-'));
  temporaryDirectories.push(directory);
  return join(directory, 'studio.sqlite');
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function tableNames(database: DatabaseSync): readonly string[] {
  return (
    database
      .prepare(
        `SELECT name FROM sqlite_schema
          WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
          ORDER BY name`,
      )
      .all() as { readonly name: string }[]
  ).map((row) => row.name);
}

describe('Studio database migrations', () => {
  it('creates the current schema and records every version once', () => {
    const path = databasePath();
    const first = openStudioDatabase(path);

    expect(tableNames(first)).toEqual(
      expect.arrayContaining([
        'change_sets',
        'drafts',
        'owner_credentials',
        'owner_sessions',
        'schema_migrations',
        'site_audit_events',
        'sites',
      ]),
    );
    expect(
      first
        .prepare('SELECT version FROM schema_migrations ORDER BY version')
        .all(),
    ).toEqual(
      Array.from({ length: STUDIO_SCHEMA_VERSION }, (_, index) => ({
        version: index + 1,
      })),
    );
    first.close();

    const second = openStudioDatabase(path);
    expect(
      second.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get(),
    ).toEqual({ count: STUDIO_SCHEMA_VERSION });
    second.close();
  });

  it('upgrades the unversioned v0.1 shape without losing rows', () => {
    const path = databasePath();
    const legacy = new DatabaseSync(path);
    legacy.exec(`
      CREATE TABLE drafts (
        workspace_id TEXT NOT NULL,
        document_id TEXT NOT NULL,
        version INTEGER NOT NULL CHECK (version > 0),
        source_revision TEXT NOT NULL,
        front_matter_json TEXT NOT NULL,
        body TEXT NOT NULL,
        saved_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, document_id)
      ) STRICT;
      INSERT INTO drafts VALUES (
        'personal-blog', 'legacy-post', 3, 'sha256:legacy',
        '{"title":"Legacy"}', 'preserve me', '2026-08-03T00:00:00.000Z'
      );
      CREATE TABLE releases (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        stages_json TEXT NOT NULL,
        manifest_hash TEXT,
        previous_release_id TEXT,
        manifest_json TEXT
      ) STRICT;
      INSERT INTO releases VALUES (
        'legacy-release', 'personal-blog', 'production', 'succeeded',
        '2026-08-03T01:00:00.000Z', '2026-08-03T01:02:00.000Z',
        '[{"name":"verify","status":"succeeded"}]', 'sha256:manifest',
        NULL, '{"entries":[]}'
      );
      CREATE TABLE release_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        release_id TEXT NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
        at TEXT NOT NULL,
        stage TEXT NOT NULL,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        completed INTEGER,
        total INTEGER
      ) STRICT;
      INSERT INTO release_events (
        release_id, at, stage, level, message, completed, total
      ) VALUES (
        'legacy-release', '2026-08-03T01:02:00.000Z', 'verify', 'info',
        'Legacy release verified', 1, 1
      );
    `);
    legacy.close();

    const upgraded = openStudioDatabase(path);
    expect(
      upgraded
        .prepare(
          `SELECT workspace_id, document_id, version, body
             FROM drafts WHERE document_id = 'legacy-post'`,
        )
        .get(),
    ).toEqual({
      workspace_id: 'personal-blog',
      document_id: 'legacy-post',
      version: 3,
      body: 'preserve me',
    });
    expect(
      upgraded
        .prepare(
          `SELECT id, workspace_id, status, manifest_hash,
                  source_change_set_id, source_commit_id
             FROM releases WHERE id = 'legacy-release'`,
        )
        .get(),
    ).toEqual({
      id: 'legacy-release',
      workspace_id: 'personal-blog',
      status: 'succeeded',
      manifest_hash: 'sha256:manifest',
      source_change_set_id: null,
      source_commit_id: null,
    });
    expect(
      upgraded
        .prepare(
          `SELECT stage, level, message, completed, total
             FROM release_events WHERE release_id = 'legacy-release'`,
        )
        .get(),
    ).toEqual({
      stage: 'verify',
      level: 'info',
      message: 'Legacy release verified',
      completed: 1,
      total: 1,
    });
    expect(
      upgraded
        .prepare('SELECT MAX(version) AS version FROM schema_migrations')
        .get(),
    ).toEqual({ version: STUDIO_SCHEMA_VERSION });
    upgraded.close();
  });

  it('rejects a database produced by a newer application', () => {
    const path = databasePath();
    const future = new DatabaseSync(path);
    future.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY CHECK (version > 0),
        name TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL
      ) STRICT;
      INSERT INTO schema_migrations VALUES (999, 'future', '2030-01-01T00:00:00.000Z');
    `);
    future.close();

    expect(() => openStudioDatabase(path)).toThrow(
      UnsupportedDatabaseVersionError,
    );
  });

  it('backfills an immutable registration event for an existing v0.2 Site', () => {
    const path = databasePath();
    const previous = new DatabaseSync(path);
    previous.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY CHECK (version > 0),
        name TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL
      ) STRICT;
      INSERT INTO schema_migrations VALUES
        (1, 'v0.1-baseline', '2026-08-04T00:00:00.000Z'),
        (2, 'site-first-foundation', '2026-08-04T00:00:01.000Z'),
        (3, 'change-set-apply-journal', '2026-08-04T00:00:02.000Z'),
        (4, 'immutable-release-source', '2026-08-04T00:00:03.000Z');
      CREATE TABLE sites (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        canonical_url TEXT,
        configuration_path TEXT NOT NULL UNIQUE,
        capabilities_json TEXT NOT NULL CHECK (json_valid(capabilities_json)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      INSERT INTO sites VALUES (
        'site-existing', 'existing-blog', 'Existing Blog',
        'https://example.test/', '/config/existing.yml', '{}',
        '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z'
      );
    `);
    previous.close();

    const upgraded = openStudioDatabase(path);
    expect(
      upgraded
        .prepare(
          `SELECT event_type, actor, at, before_json, after_json
             FROM site_audit_events WHERE site_id = 'site-existing'`,
        )
        .get(),
    ).toEqual({
      event_type: 'registered',
      actor: 'migration',
      at: '2026-08-04T00:00:00.000Z',
      before_json: null,
      after_json:
        '{"displayName":"Existing Blog","canonicalUrl":"https://example.test/"}',
    });
    upgraded.close();
  });

  it('rolls back every statement when a migration is interrupted', () => {
    const path = databasePath();
    const damaged = new DatabaseSync(path);
    damaged.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY CHECK (version > 0),
        name TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL
      ) STRICT;
      INSERT INTO schema_migrations VALUES (1, 'v0.1-baseline', '2026-08-03T00:00:00.000Z');
      CREATE TABLE sites (id TEXT PRIMARY KEY) STRICT;
    `);
    damaged.close();

    expect(() => openStudioDatabase(path)).toThrow(/display_name/);
    const inspected = new DatabaseSync(path);
    expect(tableNames(inspected)).not.toContain('owner_credentials');
    expect(
      inspected
        .prepare('SELECT MAX(version) AS version FROM schema_migrations')
        .get(),
    ).toEqual({ version: 1 });
    inspected.close();
  });

  it('opens a closed database-file backup with all operational rows intact', () => {
    const path = databasePath();
    const original = openStudioDatabase(path);
    original
      .prepare(
        `INSERT INTO owner_credentials (
           owner_id, verifier, generation, created_at, updated_at
         ) VALUES (1, 'scrypt:backup', 1, '2026-08-04T00:00:00.000Z',
                   '2026-08-04T00:00:00.000Z')`,
      )
      .run();
    original.close();

    const backupPath = `${path}.backup`;
    copyFileSync(path, backupPath);
    const restored = openStudioDatabase(backupPath);
    expect(
      restored
        .prepare('SELECT verifier FROM owner_credentials WHERE owner_id = 1')
        .get(),
    ).toEqual({ verifier: 'scrypt:backup' });
    expect(restored.prepare('PRAGMA integrity_check').get()).toEqual({
      integrity_check: 'ok',
    });
    restored.close();
  });
});
