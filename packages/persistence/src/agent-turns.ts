import { randomUUID } from 'node:crypto';

import type { StudioDatabase } from './database.js';

export type AgentTurnStatus =
  | 'queued'
  | 'running'
  | 'waiting-approval'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'interrupted';

export interface AgentTurnRecord {
  readonly id: string;
  readonly siteId: string;
  readonly sessionId: string;
  readonly approvalMode: 'approval' | 'yolo';
  readonly status: AgentTurnStatus;
  readonly cancelRequestedAt?: string;
  readonly errorCode?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
}

export interface AgentEventRecord {
  readonly sequence: number;
  readonly id: string;
  readonly siteId: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly type: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly at: string;
}

interface AgentTurnRow {
  readonly id: string;
  readonly site_id: string;
  readonly session_id: string;
  readonly approval_mode: 'approval' | 'yolo';
  readonly status: AgentTurnStatus;
  readonly cancel_requested_at: string | null;
  readonly error_code: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly started_at: string | null;
  readonly finished_at: string | null;
}

interface AgentEventRow {
  readonly sequence: number;
  readonly id: string;
  readonly site_id: string;
  readonly session_id: string;
  readonly turn_id: string;
  readonly event_type: string;
  readonly payload_json: string;
  readonly at: string;
}

const terminalStatuses: readonly AgentTurnStatus[] = [
  'completed',
  'failed',
  'canceled',
  'interrupted',
];

const allowedTransitions: Readonly<
  Record<AgentTurnStatus, readonly AgentTurnStatus[]>
> = {
  queued: ['running', 'failed', 'canceled', 'interrupted'],
  running: [
    'waiting-approval',
    'completed',
    'failed',
    'canceled',
    'interrupted',
  ],
  'waiting-approval': ['running', 'failed', 'canceled', 'interrupted'],
  completed: [],
  failed: [],
  canceled: [],
  interrupted: [],
};

export class AgentTurnNotFoundError extends Error {
  public constructor(readonly turnId: string) {
    super(`Agent turn ${turnId} was not found`);
    this.name = 'AgentTurnNotFoundError';
  }
}

export class AgentTurnStateConflictError extends Error {
  public constructor(
    readonly turnId: string,
    readonly from: AgentTurnStatus,
    readonly to: AgentTurnStatus,
  ) {
    super(`Agent turn ${turnId} cannot transition from ${from} to ${to}`);
    this.name = 'AgentTurnStateConflictError';
  }
}

function turnFromRow(row: AgentTurnRow): AgentTurnRecord {
  return {
    id: row.id,
    siteId: row.site_id,
    sessionId: row.session_id,
    approvalMode: row.approval_mode,
    status: row.status,
    ...(row.cancel_requested_at === null
      ? {}
      : { cancelRequestedAt: row.cancel_requested_at }),
    ...(row.error_code === null ? {} : { errorCode: row.error_code }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.started_at === null ? {} : { startedAt: row.started_at }),
    ...(row.finished_at === null ? {} : { finishedAt: row.finished_at }),
  };
}

function eventFromRow(row: AgentEventRow): AgentEventRecord {
  const payload: unknown = JSON.parse(row.payload_json);
  if (
    payload === null ||
    typeof payload !== 'object' ||
    Array.isArray(payload)
  ) {
    throw new Error('Stored Agent event payload must be an object');
  }
  return {
    sequence: row.sequence,
    id: row.id,
    siteId: row.site_id,
    sessionId: row.session_id,
    turnId: row.turn_id,
    type: row.event_type,
    payload: payload as Readonly<Record<string, unknown>>,
    at: row.at,
  };
}

const selectTurn = `SELECT id, site_id, session_id, approval_mode, status,
                           cancel_requested_at, error_code, created_at,
                           updated_at, started_at, finished_at
                      FROM agent_turns`;
const selectEvent = `SELECT sequence, id, site_id, session_id, turn_id,
                            event_type, payload_json, at
                       FROM agent_events`;

export class SqliteAgentTurnRepository {
  public constructor(private readonly database: StudioDatabase) {}

  public create(input: {
    readonly id: string;
    readonly siteId: string;
    readonly sessionId: string;
    readonly approvalMode: 'approval' | 'yolo';
    readonly at: string;
  }): AgentTurnRecord {
    this.database
      .prepare(
        `INSERT INTO agent_turns (
           id, site_id, session_id, approval_mode, status,
           cancel_requested_at, error_code, created_at, updated_at,
           started_at, finished_at
         ) VALUES (?, ?, ?, ?, 'queued', NULL, NULL, ?, ?, NULL, NULL)`,
      )
      .run(
        input.id,
        input.siteId,
        input.sessionId,
        input.approvalMode,
        input.at,
        input.at,
      );
    return this.require(input.id);
  }

  public get(id: string): AgentTurnRecord | null {
    const row = this.database.prepare(`${selectTurn} WHERE id = ?`).get(id) as
      AgentTurnRow | undefined;
    return row ? turnFromRow(row) : null;
  }

  public list(sessionId: string): readonly AgentTurnRecord[] {
    const rows = this.database
      .prepare(`${selectTurn} WHERE session_id = ? ORDER BY created_at, id`)
      .all(sessionId) as unknown as AgentTurnRow[];
    return rows.map(turnFromRow);
  }

  public active(sessionId: string): AgentTurnRecord | null {
    const row = this.database
      .prepare(
        `${selectTurn}
          WHERE session_id = ?
            AND status IN ('queued', 'running', 'waiting-approval')`,
      )
      .get(sessionId) as AgentTurnRow | undefined;
    return row ? turnFromRow(row) : null;
  }

  public transition(input: {
    readonly id: string;
    readonly status: AgentTurnStatus;
    readonly at: string;
    readonly errorCode?: string;
  }): AgentTurnRecord {
    const current = this.require(input.id);
    if (!allowedTransitions[current.status].includes(input.status)) {
      throw new AgentTurnStateConflictError(
        input.id,
        current.status,
        input.status,
      );
    }
    const terminal = terminalStatuses.includes(input.status);
    const startedAt =
      input.status === 'running' && !current.startedAt ? input.at : null;
    this.database
      .prepare(
        `UPDATE agent_turns
            SET status = ?, updated_at = ?,
                started_at = COALESCE(started_at, ?),
                finished_at = ?, error_code = ?
          WHERE id = ? AND status = ?`,
      )
      .run(
        input.status,
        input.at,
        startedAt,
        terminal ? input.at : null,
        input.errorCode ?? null,
        input.id,
        current.status,
      );
    return this.require(input.id);
  }

  public requestCancel(id: string, at: string): AgentTurnRecord {
    const result = this.database
      .prepare(
        `UPDATE agent_turns
            SET cancel_requested_at = COALESCE(cancel_requested_at, ?),
                updated_at = ?
          WHERE id = ?
            AND status IN ('queued', 'running', 'waiting-approval')`,
      )
      .run(at, at, id);
    if (result.changes !== 1) {
      const current = this.get(id);
      if (!current) throw new AgentTurnNotFoundError(id);
      throw new AgentTurnStateConflictError(id, current.status, 'canceled');
    }
    return this.require(id);
  }

  public recoverInterrupted(at: string): readonly AgentTurnRecord[] {
    const active = this.database
      .prepare(
        `${selectTurn}
          WHERE status IN ('queued', 'running', 'waiting-approval')
          ORDER BY created_at, id`,
      )
      .all() as unknown as AgentTurnRow[];
    return active.map((row) =>
      this.transition({ id: row.id, status: 'interrupted', at }),
    );
  }

  public appendEvent(input: {
    readonly id?: string;
    readonly siteId: string;
    readonly sessionId: string;
    readonly turnId: string;
    readonly type: string;
    readonly payload?: Readonly<Record<string, unknown>>;
    readonly at: string;
  }): AgentEventRecord {
    const id = input.id ?? `agent-event-${randomUUID()}`;
    const result = this.database
      .prepare(
        `INSERT INTO agent_events (
           id, site_id, session_id, turn_id, event_type, payload_json, at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.siteId,
        input.sessionId,
        input.turnId,
        input.type,
        JSON.stringify(input.payload ?? {}),
        input.at,
      );
    return this.event(Number(result.lastInsertRowid));
  }

  public events(input: {
    readonly sessionId: string;
    readonly afterSequence?: number;
    readonly limit?: number;
  }): readonly AgentEventRecord[] {
    const after = input.afterSequence ?? 0;
    const limit = input.limit ?? 500;
    if (!Number.isSafeInteger(after) || after < 0) {
      throw new Error('Agent event cursor must be a non-negative integer');
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
      throw new Error('Agent event limit must be between 1 and 1000');
    }
    const rows = this.database
      .prepare(
        `${selectEvent}
          WHERE session_id = ? AND sequence > ?
          ORDER BY sequence LIMIT ?`,
      )
      .all(input.sessionId, after, limit) as unknown as AgentEventRow[];
    return rows.map(eventFromRow);
  }

  private require(id: string): AgentTurnRecord {
    const turn = this.get(id);
    if (!turn) throw new AgentTurnNotFoundError(id);
    return turn;
  }

  private event(sequence: number): AgentEventRecord {
    const row = this.database
      .prepare(`${selectEvent} WHERE sequence = ?`)
      .get(sequence) as AgentEventRow | undefined;
    if (!row) throw new Error(`Agent event ${sequence} was not found`);
    return eventFromRow(row);
  }
}
