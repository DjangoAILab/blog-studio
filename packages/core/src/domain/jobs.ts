import type { JobId, WorkspaceId } from './identifiers.js';

export type JobStatus =
  'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

export interface JobRecord {
  readonly id: JobId;
  readonly workspaceId: WorkspaceId;
  readonly type: string;
  readonly idempotencyKey: string;
  readonly status: JobStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly leaseOwner?: string;
  readonly leaseExpiresAt?: string;
}
