import { BlogStudioError } from './errors.js';
import type { ContentHash, ReleaseId, WorkspaceId } from './identifiers.js';

export type ReleaseStatus =
  | 'queued'
  | 'preflight'
  | 'building'
  | 'planning'
  | 'uploading-assets'
  | 'uploading-pages'
  | 'invalidating-cache'
  | 'verifying'
  | 'succeeded'
  | 'failed'
  | 'rollback-required'
  | 'rolling-back'
  | 'rolled-back'
  | 'canceled';

export type ReleaseStageStatus =
  'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';

export interface ReleaseStage {
  readonly name: string;
  readonly status: ReleaseStageStatus;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly summary?: string;
}

export interface ReleaseRecord {
  readonly id: ReleaseId;
  readonly workspaceId: WorkspaceId;
  readonly targetId: string;
  readonly status: ReleaseStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly stages: readonly ReleaseStage[];
  readonly manifestHash?: ContentHash;
  readonly previousReleaseId?: ReleaseId;
}

export interface ManifestEntry {
  readonly path: string;
  readonly contentHash: ContentHash;
  readonly byteLength: number;
  readonly mediaType: string;
  readonly cacheClass: 'immutable' | 'page' | 'metadata';
}

export interface PublishPlan {
  readonly releaseId: ReleaseId;
  readonly targetId: string;
  readonly additions: readonly ManifestEntry[];
  readonly changes: readonly ManifestEntry[];
  readonly deletions: readonly ManifestEntry[];
  readonly protectedPrefixes: readonly string[];
}

const allowedTransitions: Readonly<
  Record<ReleaseStatus, readonly ReleaseStatus[]>
> = {
  queued: ['preflight', 'canceled'],
  preflight: ['building', 'failed', 'canceled'],
  building: ['planning', 'failed', 'canceled'],
  planning: ['uploading-assets', 'succeeded', 'failed', 'canceled'],
  'uploading-assets': ['uploading-pages', 'failed', 'canceled'],
  'uploading-pages': ['invalidating-cache', 'failed'],
  'invalidating-cache': ['verifying', 'failed'],
  verifying: ['succeeded', 'rollback-required', 'failed'],
  'rollback-required': ['rolling-back', 'failed'],
  'rolling-back': ['rolled-back', 'failed'],
  succeeded: [],
  failed: [],
  'rolled-back': [],
  canceled: [],
};

export class InvalidReleaseTransitionError extends BlogStudioError {
  public constructor(from: ReleaseStatus, to: ReleaseStatus) {
    super(
      'INVALID_RELEASE_TRANSITION',
      `Release cannot transition from ${from} to ${to}`,
      { from, to },
    );
    this.name = 'InvalidReleaseTransitionError';
  }
}

export function transitionRelease(
  release: ReleaseRecord,
  to: ReleaseStatus,
  at: string,
): ReleaseRecord {
  if (!allowedTransitions[release.status].includes(to)) {
    throw new InvalidReleaseTransitionError(release.status, to);
  }

  return { ...release, status: to, updatedAt: at };
}

export function isTerminalReleaseStatus(status: ReleaseStatus): boolean {
  return allowedTransitions[status].length === 0;
}
