import { mkdtempSync, rmSync } from 'node:fs';
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
        'sites',
      ]),
    );
    expect(
      first
        .prepare('SELECT version FROM schema_migrations ORDER BY version')
        .all(),
    ).toEqual([{ version: 1 }, { version: STUDIO_SCHEMA_VERSION }]);
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
});
