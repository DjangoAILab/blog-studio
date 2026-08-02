import {
  createContentHash,
  createReleaseId,
  createWorkspaceId,
  type ReleaseManifest,
  type ReleaseRecord,
} from '@blog-studio/core';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ActiveReleaseConflictError,
  SqliteReleaseRepository,
  openStudioDatabase,
  type StudioDatabase,
} from '../src/index.js';

const databases: StudioDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function release(id: string, targetId = 'production'): ReleaseRecord {
  return {
    id: createReleaseId(id),
    workspaceId: createWorkspaceId('personal-blog'),
    targetId,
    status: 'queued',
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    stages: [],
  };
}

describe('SqliteReleaseRepository', () => {
  it('enforces one active release per workspace and target', () => {
    const database = openStudioDatabase(':memory:');
    databases.push(database);
    const repository = new SqliteReleaseRepository(database);
    repository.create(release('release-one'));
    expect(() => repository.create(release('release-two'))).toThrow(
      ActiveReleaseConflictError,
    );
    expect(() =>
      repository.create(release('release-staging', 'staging')),
    ).not.toThrow();
  });

  it('persists transitions, manifests, and ordered events', () => {
    const database = openStudioDatabase(':memory:');
    databases.push(database);
    const repository = new SqliteReleaseRepository(database);
    const initial = release('release-one');
    repository.create(initial);
    const running: ReleaseRecord = {
      ...initial,
      status: 'preflight',
      updatedAt: '2026-08-02T00:01:00.000Z',
      manifestHash: createContentHash(`sha256:${'a'.repeat(64)}`),
    };
    expect(repository.update(running, 'queued')).toBe(true);
    expect(repository.update(running, 'queued')).toBe(false);
    const manifest: ReleaseManifest = {
      version: 1,
      releaseId: initial.id,
      targetId: initial.targetId,
      createdAt: initial.createdAt,
      verificationToken: 'token',
      entries: [],
    };
    repository.saveManifest(initial.id, manifest);
    repository.appendEvent(initial.id, {
      at: '2026-08-02T00:01:00.000Z',
      stage: 'preflight',
      level: 'info',
      message: 'ready',
    });
    expect(repository.get(initial.id)).toMatchObject({
      release: { status: 'preflight' },
      manifest,
    });
    expect(repository.events(initial.id)).toEqual([
      expect.objectContaining({ message: 'ready' }),
    ]);
  });

  it('returns only the latest succeeded manifest as the next baseline', () => {
    const database = openStudioDatabase(':memory:');
    databases.push(database);
    const repository = new SqliteReleaseRepository(database);
    const first = release('release-one');
    repository.create(first);
    const succeeded = { ...first, status: 'succeeded' as const };
    repository.update(succeeded, 'queued');
    const manifest: ReleaseManifest = {
      version: 1,
      releaseId: first.id,
      targetId: first.targetId,
      createdAt: first.createdAt,
      verificationToken: 'token',
      entries: [],
    };
    repository.saveManifest(first.id, manifest);
    expect(
      repository.latestSucceededManifest(first.workspaceId, first.targetId),
    ).toEqual(manifest);
  });
});
