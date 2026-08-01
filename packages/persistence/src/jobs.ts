import {
  createJobId,
  createWorkspaceId,
  type JobId,
  type JobRecord,
  type JobStatus,
} from '@blog-studio/core';

import type { StudioDatabase } from './database.js';

interface JobRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly type: string;
  readonly idempotency_key: string;
  readonly status: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly lease_owner: string | null;
  readonly lease_expires_at: string | null;
}

export interface CreateJobResult {
  readonly job: JobRecord;
  readonly created: boolean;
}

const jobStatuses = new Set<JobStatus>([
  'queued',
  'running',
  'succeeded',
  'failed',
  'canceled',
]);

function decodeJob(row: JobRow): JobRecord {
  if (!jobStatuses.has(row.status as JobStatus)) {
    throw new Error(`Stored job has invalid status ${row.status}`);
  }
  return {
    id: createJobId(row.id),
    workspaceId: createWorkspaceId(row.workspace_id),
    type: row.type,
    idempotencyKey: row.idempotency_key,
    status: row.status as JobStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.lease_owner === null ? {} : { leaseOwner: row.lease_owner }),
    ...(row.lease_expires_at === null
      ? {}
      : { leaseExpiresAt: row.lease_expires_at }),
  };
}

export class SqliteJobRepository {
  public constructor(private readonly database: StudioDatabase) {}

  public create(job: JobRecord): CreateJobResult {
    const result = this.database
      .prepare(
        `INSERT OR IGNORE INTO jobs (
           id, workspace_id, type, idempotency_key, status,
           created_at, updated_at, lease_owner, lease_expires_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        job.id,
        job.workspaceId,
        job.type,
        job.idempotencyKey,
        job.status,
        job.createdAt,
        job.updatedAt,
        job.leaseOwner ?? null,
        job.leaseExpiresAt ?? null,
      );
    const stored = this.getByIdempotencyKey(job.idempotencyKey);
    if (stored === null) {
      throw new Error('Job insert did not return a stored job');
    }
    return { job: stored, created: result.changes === 1 };
  }

  public get(id: JobId): JobRecord | null {
    const row = this.database
      .prepare('SELECT * FROM jobs WHERE id = ?')
      .get(id) as JobRow | undefined;
    return row === undefined ? null : decodeJob(row);
  }

  public acquire(
    owner: string,
    now: string,
    leaseExpiresAt: string,
  ): JobRecord | null {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const candidate = this.database
        .prepare(
          `SELECT * FROM jobs
            WHERE status = 'queued'
               OR (status = 'running' AND lease_expires_at <= ?)
            ORDER BY created_at, id
            LIMIT 1`,
        )
        .get(now) as JobRow | undefined;
      if (candidate === undefined) {
        this.database.exec('COMMIT');
        return null;
      }

      this.database
        .prepare(
          `UPDATE jobs
              SET status = 'running', lease_owner = ?, lease_expires_at = ?,
                  updated_at = ?
            WHERE id = ?`,
        )
        .run(owner, leaseExpiresAt, now, candidate.id);
      this.database.exec('COMMIT');
      return this.get(createJobId(candidate.id));
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  public complete(
    id: JobId,
    owner: string,
    status: Extract<JobStatus, 'succeeded' | 'failed' | 'canceled'>,
    at: string,
  ): boolean {
    const result = this.database
      .prepare(
        `UPDATE jobs
            SET status = ?, updated_at = ?, lease_owner = NULL,
                lease_expires_at = NULL
          WHERE id = ? AND status = 'running' AND lease_owner = ?`,
      )
      .run(status, at, id, owner);
    return result.changes === 1;
  }

  private getByIdempotencyKey(idempotencyKey: string): JobRecord | null {
    const row = this.database
      .prepare('SELECT * FROM jobs WHERE idempotency_key = ?')
      .get(idempotencyKey) as JobRow | undefined;
    return row === undefined ? null : decodeJob(row);
  }
}
