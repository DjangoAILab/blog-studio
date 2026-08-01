import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createContentHash,
  createDocumentId,
  createWorkspaceId,
} from '@blog-studio/core';
import { afterEach, describe, expect, it } from 'vitest';

import {
  openStudioDatabase,
  RevisionConflictError,
  SqliteDraftRepository,
} from '../src/index.js';

const temporaryDirectories: string[] = [];

function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'blog-studio-drafts-'));
  temporaryDirectories.push(directory);
  return join(directory, 'studio.sqlite');
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('SQLite draft repository', () => {
  it('durably restores an acknowledged draft after reopening', () => {
    const path = databasePath();
    const workspaceId = createWorkspaceId('personal-blog');
    const documentId = createDocumentId('post-one');
    const sourceRevision = createContentHash(`sha256:${'a'.repeat(64)}`);
    const firstDatabase = openStudioDatabase(path);
    const firstRepository = new SqliteDraftRepository(firstDatabase);

    const saved = firstRepository.save({
      workspaceId,
      documentId,
      expectedVersion: 0,
      sourceRevision,
      frontMatter: { title: 'First post', tags: ['studio'] },
      body: '# Durable draft',
      savedAt: '2026-08-02T00:00:00.000Z',
    });
    firstDatabase.close();

    const secondDatabase = openStudioDatabase(path);
    const restored = new SqliteDraftRepository(secondDatabase).get(
      workspaceId,
      documentId,
    );
    secondDatabase.close();

    expect(saved.version).toBe(1);
    expect(restored).toEqual(saved);
  });

  it('rejects a stale optimistic revision without overwriting', () => {
    const database = openStudioDatabase(databasePath());
    const repository = new SqliteDraftRepository(database);
    const workspaceId = createWorkspaceId('personal-blog');
    const documentId = createDocumentId('post-one');
    const sourceRevision = createContentHash(`sha256:${'a'.repeat(64)}`);

    repository.save({
      workspaceId,
      documentId,
      expectedVersion: 0,
      sourceRevision,
      frontMatter: { title: 'First' },
      body: 'one',
      savedAt: '2026-08-02T00:00:00.000Z',
    });
    repository.save({
      workspaceId,
      documentId,
      expectedVersion: 1,
      sourceRevision,
      frontMatter: { title: 'Second' },
      body: 'two',
      savedAt: '2026-08-02T00:00:01.000Z',
    });

    expect(() =>
      repository.save({
        workspaceId,
        documentId,
        expectedVersion: 1,
        sourceRevision,
        frontMatter: { title: 'Stale' },
        body: 'stale',
        savedAt: '2026-08-02T00:00:02.000Z',
      }),
    ).toThrow(RevisionConflictError);
    expect(repository.get(workspaceId, documentId)?.body).toBe('two');
    database.close();
  });
});
