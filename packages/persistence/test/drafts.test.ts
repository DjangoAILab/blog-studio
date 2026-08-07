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
      frontMatterSource: '# title note\ntitle: "First post"\ntags: [studio]\n',
      body: '# Durable draft',
      savedAt: '2026-08-02T00:00:00.000Z',
    });
    firstDatabase.close();

    const secondDatabase = openStudioDatabase(path);
    const secondRepository = new SqliteDraftRepository(secondDatabase);
    const restored = secondRepository.get(workspaceId, documentId);
    const listed = secondRepository.listMetadataForWorkspace(workspaceId);
    secondDatabase.close();

    const { body, ...metadata } = saved;
    expect(saved.version).toBe(1);
    expect(body).toBe('# Durable draft');
    expect(restored).toEqual(saved);
    expect(listed).toEqual([metadata]);
  });

  it('retains raw front-matter source separately from structured values', () => {
    const database = openStudioDatabase(databasePath());
    const repository = new SqliteDraftRepository(database);
    const workspaceId = createWorkspaceId('personal-blog');
    const documentId = createDocumentId('lossless-post');
    const saved = repository.save({
      workspaceId,
      documentId,
      expectedVersion: 0,
      sourceRevision: createContentHash(`sha256:${'b'.repeat(64)}`),
      frontMatter: { title: 'Edited', categories: 'single' },
      frontMatterSource:
        '# preserve\ntitle: "Edited"\ncategories: single\n',
      body: 'body',
      savedAt: '2026-08-02T00:00:00.000Z',
    });
    expect(saved.frontMatterSource).toBe(
      '# preserve\ntitle: "Edited"\ncategories: single\n',
    );
    database.close();
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

  it('deletes only the expected acknowledged version', () => {
    const database = openStudioDatabase(databasePath());
    const repository = new SqliteDraftRepository(database);
    const workspaceId = createWorkspaceId('personal-blog');
    const documentId = createDocumentId('post-one');
    repository.save({
      workspaceId,
      documentId,
      expectedVersion: 0,
      sourceRevision: createContentHash(`sha256:${'a'.repeat(64)}`),
      frontMatter: { title: 'First' },
      body: 'one',
      savedAt: '2026-08-02T00:00:00.000Z',
    });
    expect(repository.delete(workspaceId, documentId, 2)).toBe(false);
    expect(repository.delete(workspaceId, documentId, 1)).toBe(true);
    expect(repository.get(workspaceId, documentId)).toBeNull();
    database.close();
  });
});
