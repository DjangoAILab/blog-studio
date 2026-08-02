import {
  createContentHash,
  createReleaseId,
  createWorkspaceId,
  type PublishEvent,
  type ReleaseManifest,
  type ReleaseRecord,
  type ReleaseStatus,
} from '@blog-studio/core';

import type { StudioDatabase } from './database.js';

const statuses = new Set<ReleaseStatus>([
  'queued',
  'preflight',
  'building',
  'planning',
  'uploading-assets',
  'uploading-pages',
  'invalidating-cache',
  'verifying',
  'succeeded',
  'failed',
  'rollback-required',
  'rolling-back',
  'rolled-back',
  'canceled',
]);

interface ReleaseRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly target_id: string;
  readonly status: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly stages_json: string;
  readonly manifest_hash: string | null;
  readonly previous_release_id: string | null;
  readonly manifest_json: string | null;
}

interface EventRow {
  readonly at: string;
  readonly stage: string;
  readonly level: PublishEvent['level'];
  readonly message: string;
  readonly completed: number | null;
  readonly total: number | null;
}

export interface StoredRelease {
  readonly release: ReleaseRecord;
  readonly manifest?: ReleaseManifest;
}

export class ActiveReleaseConflictError extends Error {
  public constructor(workspaceId: string, targetId: string) {
    super(`A release is already active for ${workspaceId}/${targetId}`);
    this.name = 'ActiveReleaseConflictError';
  }
}

function decode(row: ReleaseRow): StoredRelease {
  if (!statuses.has(row.status as ReleaseStatus))
    throw new Error(`Stored release has invalid status: ${row.status}`);
  const release: ReleaseRecord = {
    id: createReleaseId(row.id),
    workspaceId: createWorkspaceId(row.workspace_id),
    targetId: row.target_id,
    status: row.status as ReleaseStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    stages: JSON.parse(row.stages_json) as ReleaseRecord['stages'],
    ...(row.manifest_hash === null
      ? {}
      : { manifestHash: createContentHash(row.manifest_hash) }),
    ...(row.previous_release_id === null
      ? {}
      : { previousReleaseId: createReleaseId(row.previous_release_id) }),
  };
  return {
    release,
    ...(row.manifest_json === null
      ? {}
      : { manifest: JSON.parse(row.manifest_json) as ReleaseManifest }),
  };
}

export class SqliteReleaseRepository {
  public constructor(private readonly database: StudioDatabase) {}

  public create(release: ReleaseRecord): StoredRelease {
    try {
      this.database
        .prepare(
          `INSERT INTO releases (
             id, workspace_id, target_id, status, created_at, updated_at,
             stages_json, manifest_hash, previous_release_id, manifest_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        )
        .run(
          release.id,
          release.workspaceId,
          release.targetId,
          release.status,
          release.createdAt,
          release.updatedAt,
          JSON.stringify(release.stages),
          release.manifestHash ?? null,
          release.previousReleaseId ?? null,
        );
    } catch (error) {
      if (
        error instanceof Error &&
        /UNIQUE constraint failed: releases\.workspace_id, releases\.target_id/.test(
          error.message,
        )
      )
        throw new ActiveReleaseConflictError(
          release.workspaceId,
          release.targetId,
        );
      throw error;
    }
    return this.get(release.id)!;
  }

  public get(id: ReleaseRecord['id']): StoredRelease | null {
    const row = this.database
      .prepare('SELECT * FROM releases WHERE id = ?')
      .get(id) as ReleaseRow | undefined;
    return row ? decode(row) : null;
  }

  public list(
    workspaceId: ReleaseRecord['workspaceId'],
  ): readonly StoredRelease[] {
    return (
      this.database
        .prepare(
          'SELECT * FROM releases WHERE workspace_id = ? ORDER BY created_at DESC, id DESC',
        )
        .all(workspaceId) as unknown as ReleaseRow[]
    ).map(decode);
  }

  public update(
    release: ReleaseRecord,
    expectedStatus: ReleaseStatus,
  ): boolean {
    const result = this.database
      .prepare(
        `UPDATE releases
            SET status = ?, updated_at = ?, stages_json = ?, manifest_hash = ?,
                previous_release_id = ?
          WHERE id = ? AND status = ?`,
      )
      .run(
        release.status,
        release.updatedAt,
        JSON.stringify(release.stages),
        release.manifestHash ?? null,
        release.previousReleaseId ?? null,
        release.id,
        expectedStatus,
      );
    return result.changes === 1;
  }

  public saveManifest(
    id: ReleaseRecord['id'],
    manifest: ReleaseManifest,
  ): void {
    const result = this.database
      .prepare('UPDATE releases SET manifest_json = ? WHERE id = ?')
      .run(JSON.stringify(manifest), id);
    if (result.changes !== 1) throw new Error(`Unknown release: ${id}`);
  }

  public latestSucceededManifest(
    workspaceId: ReleaseRecord['workspaceId'],
    targetId: string,
  ): ReleaseManifest | undefined {
    const row = this.database
      .prepare(
        `SELECT * FROM releases
          WHERE workspace_id = ? AND target_id = ? AND status = 'succeeded'
            AND manifest_json IS NOT NULL
          ORDER BY updated_at DESC, id DESC LIMIT 1`,
      )
      .get(workspaceId, targetId) as ReleaseRow | undefined;
    return row ? decode(row).manifest : undefined;
  }

  public latestSucceeded(
    workspaceId: ReleaseRecord['workspaceId'],
    targetId: string,
  ): StoredRelease | undefined {
    const row = this.database
      .prepare(
        `SELECT * FROM releases
          WHERE workspace_id = ? AND target_id = ? AND status = 'succeeded'
            AND manifest_json IS NOT NULL
          ORDER BY updated_at DESC, id DESC LIMIT 1`,
      )
      .get(workspaceId, targetId) as ReleaseRow | undefined;
    return row ? decode(row) : undefined;
  }

  public active(): readonly StoredRelease[] {
    return (
      this.database
        .prepare(
          `SELECT * FROM releases WHERE status IN (
             'queued', 'preflight', 'building', 'planning', 'uploading-assets',
             'uploading-pages', 'invalidating-cache', 'verifying',
             'rollback-required', 'rolling-back'
           ) ORDER BY created_at, id`,
        )
        .all() as unknown as ReleaseRow[]
    ).map(decode);
  }

  public appendEvent(id: ReleaseRecord['id'], event: PublishEvent): void {
    this.database
      .prepare(
        `INSERT INTO release_events (
           release_id, at, stage, level, message, completed, total
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        event.at,
        event.stage,
        event.level,
        event.message,
        event.completed ?? null,
        event.total ?? null,
      );
  }

  public events(id: ReleaseRecord['id']): readonly PublishEvent[] {
    const rows = this.database
      .prepare(
        `SELECT at, stage, level, message, completed, total
           FROM release_events WHERE release_id = ? ORDER BY sequence`,
      )
      .all(id) as unknown as EventRow[];
    return rows.map((row) => ({
      at: row.at,
      stage: row.stage,
      level: row.level,
      message: row.message,
      ...(row.completed === null ? {} : { completed: row.completed }),
      ...(row.total === null ? {} : { total: row.total }),
    }));
  }
}
