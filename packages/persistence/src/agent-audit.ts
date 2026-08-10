import type { StudioDatabase } from './database.js';

export type AgentToolApprovalDecision =
  'not-required' | 'pending' | 'approved' | 'rejected' | 'auto-approved';

export type AgentToolAuditStatus =
  'requested' | 'running' | 'succeeded' | 'failed' | 'canceled';

export interface AgentToolAuditRecord {
  readonly sequence: number;
  readonly siteId: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly toolCallId: string;
  readonly piEntryId?: string;
  readonly toolName: string;
  readonly mutation: boolean;
  readonly approvalDecision: AgentToolApprovalDecision;
  readonly status: AgentToolAuditStatus;
  readonly paths: readonly string[];
  readonly requestedAt: string;
  readonly updatedAt: string;
  readonly decisionAt?: string;
}

export type CreateAgentToolAuditInput = Omit<
  AgentToolAuditRecord,
  'sequence' | 'piEntryId'
>;

interface AgentToolAuditRow {
  readonly sequence: number;
  readonly site_id: string;
  readonly session_id: string;
  readonly turn_id: string;
  readonly tool_call_id: string;
  readonly pi_entry_id: string | null;
  readonly tool_name: string;
  readonly is_mutation: number;
  readonly approval_decision: AgentToolApprovalDecision;
  readonly status: AgentToolAuditStatus;
  readonly paths_json: string;
  readonly requested_at: string;
  readonly updated_at: string;
  readonly decision_at: string | null;
}

export class AgentToolAuditNotFoundError extends Error {
  public constructor(readonly toolCallId: string) {
    super(`Agent tool audit ${toolCallId} was not found`);
    this.name = 'AgentToolAuditNotFoundError';
  }
}

function parsePaths(value: string): readonly string[] {
  const parsed: unknown = JSON.parse(value);
  if (
    !Array.isArray(parsed) ||
    !parsed.every((path): path is string => typeof path === 'string')
  ) {
    throw new Error('Stored Agent tool paths must be a string array');
  }
  return parsed;
}

function fromRow(row: AgentToolAuditRow): AgentToolAuditRecord {
  return {
    sequence: row.sequence,
    siteId: row.site_id,
    sessionId: row.session_id,
    turnId: row.turn_id,
    toolCallId: row.tool_call_id,
    ...(row.pi_entry_id === null ? {} : { piEntryId: row.pi_entry_id }),
    toolName: row.tool_name,
    mutation: row.is_mutation === 1,
    approvalDecision: row.approval_decision,
    status: row.status,
    paths: parsePaths(row.paths_json),
    requestedAt: row.requested_at,
    updatedAt: row.updated_at,
    ...(row.decision_at === null ? {} : { decisionAt: row.decision_at }),
  };
}

const selectAudit = `SELECT sequence, site_id, session_id, turn_id,
                            tool_call_id, pi_entry_id, tool_name, is_mutation,
                            approval_decision, status, paths_json,
                            requested_at, updated_at, decision_at
                       FROM agent_tool_audit`;

export class SqliteAgentToolAuditRepository {
  public constructor(private readonly database: StudioDatabase) {}

  public create(input: CreateAgentToolAuditInput): AgentToolAuditRecord {
    this.database
      .prepare(
        `INSERT INTO agent_tool_audit (
           site_id, session_id, turn_id, tool_call_id, pi_entry_id,
           tool_name, is_mutation, approval_decision, status, paths_json,
           requested_at, updated_at, decision_at
         ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.siteId,
        input.sessionId,
        input.turnId,
        input.toolCallId,
        input.toolName,
        input.mutation ? 1 : 0,
        input.approvalDecision,
        input.status,
        JSON.stringify(input.paths),
        input.requestedAt,
        input.updatedAt,
        ['approved', 'rejected', 'auto-approved'].includes(
          input.approvalDecision,
        )
          ? input.updatedAt
          : null,
      );
    return this.require(input.sessionId, input.toolCallId);
  }

  public update(input: {
    readonly sessionId: string;
    readonly toolCallId: string;
    readonly piEntryId?: string;
    readonly approvalDecision: AgentToolApprovalDecision;
    readonly status: AgentToolAuditStatus;
    readonly updatedAt: string;
    readonly decisionAt?: string;
  }): AgentToolAuditRecord {
    const result = this.database
      .prepare(
        `UPDATE agent_tool_audit
            SET pi_entry_id = COALESCE(?, pi_entry_id),
                approval_decision = ?, status = ?, updated_at = ?,
                decision_at = COALESCE(?, decision_at)
          WHERE session_id = ? AND tool_call_id = ?`,
      )
      .run(
        input.piEntryId ?? null,
        input.approvalDecision,
        input.status,
        input.updatedAt,
        input.decisionAt ?? null,
        input.sessionId,
        input.toolCallId,
      );
    if (result.changes !== 1) {
      throw new AgentToolAuditNotFoundError(input.toolCallId);
    }
    return this.require(input.sessionId, input.toolCallId);
  }

  public list(sessionId: string): readonly AgentToolAuditRecord[] {
    const rows = this.database
      .prepare(`${selectAudit} WHERE session_id = ? ORDER BY sequence`)
      .all(sessionId) as unknown as AgentToolAuditRow[];
    return rows.map(fromRow);
  }

  public get(
    sessionId: string,
    toolCallId: string,
  ): AgentToolAuditRecord | null {
    const row = this.database
      .prepare(`${selectAudit} WHERE session_id = ? AND tool_call_id = ?`)
      .get(sessionId, toolCallId) as AgentToolAuditRow | undefined;
    return row ? fromRow(row) : null;
  }

  public decide(input: {
    readonly sessionId: string;
    readonly toolCallId: string;
    readonly decision: 'approved' | 'rejected';
    readonly at: string;
  }): AgentToolAuditRecord {
    const result = this.database
      .prepare(
        `UPDATE agent_tool_audit
            SET approval_decision = ?, decision_at = ?, updated_at = ?
          WHERE session_id = ? AND tool_call_id = ?
            AND approval_decision = 'pending'
            AND status = 'requested'`,
      )
      .run(
        input.decision,
        input.at,
        input.at,
        input.sessionId,
        input.toolCallId,
      );
    if (result.changes !== 1) {
      throw new AgentToolAuditNotFoundError(input.toolCallId);
    }
    return this.require(input.sessionId, input.toolCallId);
  }

  public interruptTurn(turnId: string, at: string): number {
    const result = this.database
      .prepare(
        `UPDATE agent_tool_audit
            SET approval_decision = CASE
                  WHEN approval_decision = 'pending' THEN 'rejected'
                  ELSE approval_decision
                END,
                status = 'canceled',
                decision_at = CASE
                  WHEN approval_decision = 'pending' THEN ?
                  ELSE decision_at
                END,
                updated_at = ?
          WHERE turn_id = ? AND status IN ('requested', 'running')`,
      )
      .run(at, at, turnId);
    return Number(result.changes);
  }

  private require(sessionId: string, toolCallId: string): AgentToolAuditRecord {
    const record = this.get(sessionId, toolCallId);
    if (!record) throw new AgentToolAuditNotFoundError(toolCallId);
    return record;
  }
}
