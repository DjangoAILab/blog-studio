import type { StudioDatabase } from './database.js';

export type ChangeSetStatus =
  'prepared' | 'applied' | 'committed' | 'superseded' | 'invalidated';

export interface ChangeSetRecord {
  readonly id: string;
  readonly siteId: string;
  readonly status: ChangeSetStatus;
  readonly fingerprint: string;
  readonly baseRevision: string;
  readonly payload: unknown;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly appliedAt?: string;
  readonly commitId?: string;
}

interface ChangeSetRow {
  readonly id: string;
  readonly site_id: string;
  readonly status: ChangeSetStatus;
  readonly fingerprint: string;
  readonly base_revision: string;
  readonly payload_json: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly applied_at: string | null;
  readonly commit_id: string | null;
}

export class ChangeSetStateConflictError extends Error {
  public constructor(
    readonly id: string,
    readonly expectedStatus: ChangeSetStatus,
  ) {
    super(`ChangeSet ${id} is no longer ${expectedStatus}`);
    this.name = 'ChangeSetStateConflictError';
  }
}

function changeSetFromRow(row: ChangeSetRow): ChangeSetRecord {
  return {
    id: row.id,
    siteId: row.site_id,
    status: row.status,
    fingerprint: row.fingerprint,
    baseRevision: row.base_revision,
    payload: JSON.parse(row.payload_json) as unknown,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.applied_at === null ? {} : { appliedAt: row.applied_at }),
    ...(row.commit_id === null ? {} : { commitId: row.commit_id }),
  };
}

const selectChangeSet = `SELECT id, site_id, status, fingerprint, base_revision,
                                 payload_json, created_at, updated_at, applied_at,
                                 commit_id
                            FROM change_sets`;

export class SqliteChangeSetRepository {
  public constructor(private readonly database: StudioDatabase) {}

  public prepare(input: {
    readonly id: string;
    readonly siteId: string;
    readonly fingerprint: string;
    readonly baseRevision: string;
    readonly payload: unknown;
    readonly at: string;
  }): ChangeSetRecord {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const identical = this.database
        .prepare(
          `${selectChangeSet}
            WHERE site_id = ? AND fingerprint = ? AND status = 'prepared'`,
        )
        .get(input.siteId, input.fingerprint) as ChangeSetRow | undefined;
      if (identical) {
        this.database.exec('COMMIT');
        return changeSetFromRow(identical);
      }
      this.database
        .prepare(
          `UPDATE change_sets SET status = 'superseded', updated_at = ?
            WHERE site_id = ? AND status = 'prepared'`,
        )
        .run(input.at, input.siteId);
      this.database
        .prepare(
          `INSERT INTO change_sets (
             id, site_id, status, fingerprint, base_revision, payload_json,
             created_at, updated_at, applied_at, commit_id
           ) VALUES (?, ?, 'prepared', ?, ?, ?, ?, ?, NULL, NULL)`,
        )
        .run(
          input.id,
          input.siteId,
          input.fingerprint,
          input.baseRevision,
          JSON.stringify(input.payload),
          input.at,
          input.at,
        );
      this.database.exec('COMMIT');
      return this.get(input.id)!;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  public get(id: string): ChangeSetRecord | null {
    const row = this.database
      .prepare(`${selectChangeSet} WHERE id = ?`)
      .get(id) as ChangeSetRow | undefined;
    return row ? changeSetFromRow(row) : null;
  }

  public listForSite(siteId: string): readonly ChangeSetRecord[] {
    return (
      this.database
        .prepare(
          `${selectChangeSet}
            WHERE site_id = ? ORDER BY created_at DESC, id DESC`,
        )
        .all(siteId) as unknown as ChangeSetRow[]
    ).map(changeSetFromRow);
  }

  public markApplied(id: string, at: string): ChangeSetRecord {
    return this.transition({
      id,
      from: 'prepared',
      to: 'applied',
      updatedAt: at,
      appliedAt: at,
    });
  }

  public markCommitted(
    id: string,
    commitId: string,
    at: string,
  ): ChangeSetRecord {
    return this.transition({
      id,
      from: 'applied',
      to: 'committed',
      updatedAt: at,
      commitId,
    });
  }

  public invalidate(id: string, at: string): ChangeSetRecord {
    return this.transition({
      id,
      from: 'prepared',
      to: 'invalidated',
      updatedAt: at,
    });
  }

  private transition(input: {
    readonly id: string;
    readonly from: ChangeSetStatus;
    readonly to: ChangeSetStatus;
    readonly updatedAt: string;
    readonly appliedAt?: string;
    readonly commitId?: string;
  }): ChangeSetRecord {
    const result = this.database
      .prepare(
        `UPDATE change_sets
            SET status = ?, updated_at = ?, applied_at = COALESCE(?, applied_at),
                commit_id = COALESCE(?, commit_id)
          WHERE id = ? AND status = ?`,
      )
      .run(
        input.to,
        input.updatedAt,
        input.appliedAt ?? null,
        input.commitId ?? null,
        input.id,
        input.from,
      );
    if (result.changes !== 1) {
      throw new ChangeSetStateConflictError(input.id, input.from);
    }
    return this.get(input.id)!;
  }
}
