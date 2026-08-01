import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createJobId,
  createWorkspaceId,
  type JobRecord,
} from '@blog-studio/core';
import { afterEach, describe, expect, it } from 'vitest';

import { openStudioDatabase, SqliteJobRepository } from '../src/index.js';

const temporaryDirectories: string[] = [];

function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'blog-studio-jobs-'));
  temporaryDirectories.push(directory);
  return join(directory, 'studio.sqlite');
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

const queuedJob = (): JobRecord => ({
  id: createJobId('job-release-one'),
  workspaceId: createWorkspaceId('personal-blog'),
  type: 'release',
  idempotencyKey: 'release:personal-blog:abc123',
  status: 'queued',
  createdAt: '2026-08-02T00:00:00.000Z',
  updatedAt: '2026-08-02T00:00:00.000Z',
});

describe('SQLite job repository', () => {
  it('deduplicates creation by idempotency key', () => {
    const database = openStudioDatabase(databasePath());
    const repository = new SqliteJobRepository(database);

    expect(repository.create(queuedJob()).created).toBe(true);
    const duplicate = repository.create({
      ...queuedJob(),
      id: createJobId('job-release-two'),
    });

    expect(duplicate.created).toBe(false);
    expect(duplicate.job.id).toBe('job-release-one');
    database.close();
  });

  it('leases once and permits recovery only after expiry', () => {
    const database = openStudioDatabase(databasePath());
    const repository = new SqliteJobRepository(database);
    repository.create(queuedJob());

    const first = repository.acquire(
      'worker-one',
      '2026-08-02T00:00:01.000Z',
      '2026-08-02T00:00:11.000Z',
    );
    const blocked = repository.acquire(
      'worker-two',
      '2026-08-02T00:00:02.000Z',
      '2026-08-02T00:00:12.000Z',
    );
    const recovered = repository.acquire(
      'worker-two',
      '2026-08-02T00:00:12.000Z',
      '2026-08-02T00:00:22.000Z',
    );

    expect(first?.leaseOwner).toBe('worker-one');
    expect(blocked).toBeNull();
    expect(recovered?.leaseOwner).toBe('worker-two');
    database.close();
  });

  it('persists a completed job across restart', () => {
    const path = databasePath();
    const firstDatabase = openStudioDatabase(path);
    const firstRepository = new SqliteJobRepository(firstDatabase);
    firstRepository.create(queuedJob());
    firstRepository.acquire(
      'worker-one',
      '2026-08-02T00:00:01.000Z',
      '2026-08-02T00:00:11.000Z',
    );
    expect(
      firstRepository.complete(
        queuedJob().id,
        'worker-one',
        'succeeded',
        '2026-08-02T00:00:02.000Z',
      ),
    ).toBe(true);
    firstDatabase.close();

    const secondDatabase = openStudioDatabase(path);
    const restored = new SqliteJobRepository(secondDatabase).get(
      queuedJob().id,
    );
    secondDatabase.close();

    expect(restored?.status).toBe('succeeded');
    expect(restored?.leaseOwner).toBeUndefined();
  });
});
