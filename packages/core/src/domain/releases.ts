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
  readonly sourceChangeSetId?: string;
  readonly sourceCommitId?: string;
}

export interface ManifestEntry {
  readonly path: string;
  readonly contentHash: ContentHash;
  readonly byteLength: number;
  readonly mediaType: string;
  readonly cacheClass: 'immutable' | 'page' | 'metadata';
}

export interface ReleaseManifest {
  readonly version: 1;
  readonly releaseId: ReleaseId;
  readonly targetId: string;
  readonly createdAt: string;
  readonly verificationToken: string;
  readonly entries: readonly ManifestEntry[];
}

export interface PublishPlan {
  readonly releaseId: ReleaseId;
  readonly targetId: string;
  readonly sourceDirectory: string;
  readonly manifest: ReleaseManifest;
  readonly previousManifest?: ReleaseManifest;
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
  'uploading-assets': [
    'uploading-pages',
    'rollback-required',
    'failed',
    'canceled',
  ],
  'uploading-pages': ['invalidating-cache', 'rollback-required', 'failed'],
  'invalidating-cache': ['verifying', 'rollback-required', 'failed'],
  verifying: ['succeeded', 'rollback-required', 'failed'],
  'rollback-required': ['rolling-back', 'failed'],
  'rolling-back': ['rolled-back', 'failed'],
  succeeded: ['rollback-required'],
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
  return ['succeeded', 'failed', 'rolled-back', 'canceled'].includes(status);
}
