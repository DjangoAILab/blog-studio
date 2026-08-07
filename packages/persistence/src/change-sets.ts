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

export interface ChangeSetApplyAttempt {
  readonly id: string;
  readonly changeSetId: string;
  readonly status:
    'applying' | 'succeeded' | 'rolled-back' | 'recovery-required';
  readonly journal: unknown;
  readonly createdAt: string;
  readonly updatedAt: string;
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

  public beginApply(input: {
    readonly id: string;
    readonly changeSetId: string;
    readonly journal: unknown;
    readonly at: string;
  }): ChangeSetApplyAttempt {
    const record = this.get(input.changeSetId);
    if (!record || record.status !== 'prepared')
      throw new ChangeSetStateConflictError(input.changeSetId, 'prepared');
    this.database
      .prepare(
        `INSERT INTO change_set_apply_attempts (
           id, change_set_id, status, journal_json, created_at, updated_at
         ) VALUES (?, ?, 'applying', ?, ?, ?)`,
      )
      .run(
        input.id,
        input.changeSetId,
        JSON.stringify(input.journal),
        input.at,
        input.at,
      );
    return this.applyAttempt(input.id)!;
  }

  public finishApply(
    attemptId: string,
    changeSetId: string,
    at: string,
  ): ChangeSetRecord {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const attempt = this.database
        .prepare(
          `UPDATE change_set_apply_attempts
              SET status = 'succeeded', updated_at = ?
            WHERE id = ? AND change_set_id = ? AND status = 'applying'`,
        )
        .run(at, attemptId, changeSetId);
      const changeSet = this.database
        .prepare(
          `UPDATE change_sets
              SET status = 'applied', applied_at = ?, updated_at = ?
            WHERE id = ? AND status = 'prepared'`,
        )
        .run(at, at, changeSetId);
      if (attempt.changes !== 1 || changeSet.changes !== 1)
        throw new ChangeSetStateConflictError(changeSetId, 'prepared');
      this.database.exec('COMMIT');
      return this.get(changeSetId)!;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  public markApplyRecovery(
    attemptId: string,
    status: 'rolled-back' | 'recovery-required',
    at: string,
  ): ChangeSetApplyAttempt {
    const result = this.database
      .prepare(
        `UPDATE change_set_apply_attempts SET status = ?, updated_at = ?
          WHERE id = ? AND status = 'applying'`,
      )
      .run(status, at, attemptId);
    if (result.changes !== 1)
      throw new Error(`Apply attempt is not active: ${attemptId}`);
    return this.applyAttempt(attemptId)!;
  }

  public applying(): readonly ChangeSetApplyAttempt[] {
    return (
      this.database
        .prepare(
          `SELECT id, change_set_id, status, journal_json, created_at, updated_at
             FROM change_set_apply_attempts WHERE status = 'applying'
             ORDER BY created_at, id`,
        )
        .all() as unknown as Array<{
        id: string;
        change_set_id: string;
        status: ChangeSetApplyAttempt['status'];
        journal_json: string;
        created_at: string;
        updated_at: string;
      }>
    ).map((row) => ({
      id: row.id,
      changeSetId: row.change_set_id,
      status: row.status,
      journal: JSON.parse(row.journal_json) as unknown,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  private applyAttempt(id: string): ChangeSetApplyAttempt | null {
    const row = this.database
      .prepare(
        `SELECT id, change_set_id, status, journal_json, created_at, updated_at
           FROM change_set_apply_attempts WHERE id = ?`,
      )
      .get(id) as
      | {
          id: string;
          change_set_id: string;
          status: ChangeSetApplyAttempt['status'];
          journal_json: string;
          created_at: string;
          updated_at: string;
        }
      | undefined;
    return row
      ? {
          id: row.id,
          changeSetId: row.change_set_id,
          status: row.status,
          journal: JSON.parse(row.journal_json) as unknown,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }
      : null;
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
