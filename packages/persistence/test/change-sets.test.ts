import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  ChangeSetStateConflictError,
  openStudioDatabase,
  SqliteChangeSetRepository,
  SqliteSiteRepository,
} from '../src/index.js';

const temporaryDirectories: string[] = [];

function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'blog-studio-change-set-'));
  temporaryDirectories.push(directory);
  return join(directory, 'studio.sqlite');
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function repositories() {
  const database = openStudioDatabase(databasePath());
  new SqliteSiteRepository(database).create({
    id: 'site-one',
    workspaceId: 'workspace-one',
    displayName: 'Site One',
    configurationPath: '/config/one.yaml',
    capabilities: {},
    createdAt: '2026-08-04T00:00:00.000Z',
    updatedAt: '2026-08-04T00:00:00.000Z',
  });
  return { database, changes: new SqliteChangeSetRepository(database) };
}

describe('SQLite ChangeSet repository', () => {
  it('prepares idempotently and keeps the frozen payload immutable', () => {
    const { database, changes } = repositories();
    const first = changes.prepare({
      id: 'change-one',
      siteId: 'site-one',
      fingerprint: 'sha256:first',
      baseRevision: 'commit-before',
      payload: { files: [{ path: 'post.md', revision: 'sha256:body' }] },
      at: '2026-08-04T00:00:01.000Z',
    });
    const repeated = changes.prepare({
      id: 'ignored-new-id',
      siteId: 'site-one',
      fingerprint: 'sha256:first',
      baseRevision: 'ignored-new-base',
      payload: { files: [] },
      at: '2026-08-04T00:00:02.000Z',
    });
    expect(repeated).toEqual(first);
    expect(repeated.id).toBe('change-one');
    expect(repeated.baseRevision).toBe('commit-before');
    database.close();
  });

  it('supersedes stale prepared review when the exact inputs change', () => {
    const { database, changes } = repositories();
    changes.prepare({
      id: 'change-one',
      siteId: 'site-one',
      fingerprint: 'sha256:first',
      baseRevision: 'commit-one',
      payload: { files: ['one'] },
      at: '2026-08-04T00:00:01.000Z',
    });
    const next = changes.prepare({
      id: 'change-two',
      siteId: 'site-one',
      fingerprint: 'sha256:second',
      baseRevision: 'commit-two',
      payload: { files: ['two'] },
      at: '2026-08-04T00:00:02.000Z',
    });
    expect(changes.get('change-one')?.status).toBe('superseded');
    expect(next.status).toBe('prepared');
    expect(changes.listForSite('site-one')).toHaveLength(2);
    database.close();
  });

  it('enforces reviewed apply then commit transitions', () => {
    const { database, changes } = repositories();
    changes.prepare({
      id: 'change-one',
      siteId: 'site-one',
      fingerprint: 'sha256:first',
      baseRevision: 'commit-one',
      payload: { files: ['one'] },
      at: '2026-08-04T00:00:01.000Z',
    });
    expect(() =>
      changes.markCommitted(
        'change-one',
        'commit-after',
        '2026-08-04T00:00:02.000Z',
      ),
    ).toThrow(ChangeSetStateConflictError);
    expect(
      changes.markApplied('change-one', '2026-08-04T00:00:03.000Z').status,
    ).toBe('applied');
    const committed = changes.markCommitted(
      'change-one',
      'commit-after',
      '2026-08-04T00:00:04.000Z',
    );
    expect(committed.status).toBe('committed');
    expect(committed.commitId).toBe('commit-after');
    expect(committed.payload).toEqual({ files: ['one'] });
    database.close();
  });

  it('rejects a ChangeSet whose Site does not exist', () => {
    const database = openStudioDatabase(databasePath());
    const changes = new SqliteChangeSetRepository(database);
    expect(() =>
      changes.prepare({
        id: 'orphan',
        siteId: 'missing',
        fingerprint: 'sha256:orphan',
        baseRevision: 'commit-one',
        payload: {},
        at: '2026-08-04T00:00:01.000Z',
      }),
    ).toThrow(/FOREIGN KEY constraint failed/);
    database.close();
  });
});
