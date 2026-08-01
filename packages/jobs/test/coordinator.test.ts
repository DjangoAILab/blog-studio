import {
  createJobId,
  createWorkspaceId,
  type JobRecord,
} from '@blog-studio/core';
import {
  openStudioDatabase,
  SqliteJobRepository,
} from '@blog-studio/persistence';
import { describe, expect, it, vi } from 'vitest';

import { JobCoordinator, redactLogMessage } from '../src/index.js';

const job = (): JobRecord => ({
  id: createJobId('job-one'),
  workspaceId: createWorkspaceId('personal-blog'),
  type: 'preview',
  idempotencyKey: 'preview:personal-blog:one',
  status: 'queued',
  createdAt: '2026-08-02T00:00:00.000Z',
  updatedAt: '2026-08-02T00:00:00.000Z',
});

describe('job coordinator', () => {
  it('leases, executes, and completes one job', async () => {
    const database = openStudioDatabase(':memory:');
    const repository = new SqliteJobRepository(database);
    repository.create(job());
    const handler = vi.fn().mockResolvedValue(undefined);
    const coordinator = new JobCoordinator(
      repository,
      () => new Date('2026-08-02T00:00:01.000Z'),
    );

    const result = await coordinator.workOnce('worker-one', 10_000, {
      preview: handler,
    });

    expect(result).toEqual({ jobId: job().id, status: 'succeeded' });
    expect(handler).toHaveBeenCalledOnce();
    expect(repository.get(job().id)?.status).toBe('succeeded');
    database.close();
  });

  it('marks a failed handler without leaking its error through the worker', async () => {
    const database = openStudioDatabase(':memory:');
    const repository = new SqliteJobRepository(database);
    repository.create(job());
    const coordinator = new JobCoordinator(
      repository,
      () => new Date('2026-08-02T00:00:01.000Z'),
    );

    const result = await coordinator.workOnce('worker-one', 10_000, {
      preview: () => Promise.reject(new Error('build failed')),
    });

    expect(result).toEqual({
      jobId: job().id,
      status: 'failed',
      error: 'build failed',
    });
    expect(repository.get(job().id)?.status).toBe('failed');
    database.close();
  });
});

describe('log redaction', () => {
  it('redacts configured values and authorization headers', () => {
    expect(
      redactLogMessage('Authorization: Bearer abc123; secret=very-secret', [
        'very-secret',
        'abc123',
      ]),
    ).toBe('Authorization: [REDACTED]; secret=[REDACTED]');
  });
});
