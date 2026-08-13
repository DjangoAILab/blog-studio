import type { StudioDatabase } from './database.js';

export type AgentApprovalMode = 'approval' | 'yolo';
export type AgentSessionState = 'active' | 'archived';

export interface AgentSessionRecord {
  readonly id: string;
  readonly siteId: string;
  readonly piSessionId: string;
  readonly transcriptKey: string;
  readonly displayName: string;
  readonly documentId?: string;
  readonly collectionId?: string;
  readonly state: AgentSessionState;
  readonly approvalMode?: AgentApprovalMode;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt?: string;
}

export type CreateAgentSessionInput = Omit<
  AgentSessionRecord,
  'state' | 'approvalMode' | 'archivedAt'
> & {
  readonly approvalMode?: AgentApprovalMode;
};

interface AgentSessionRow {
  readonly id: string;
  readonly site_id: string;
  readonly pi_session_id: string;
  readonly transcript_key: string;
  readonly display_name: string;
  readonly document_id: string | null;
  readonly collection_id: string | null;
  readonly state: AgentSessionState;
  readonly approval_mode: AgentApprovalMode | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly archived_at: string | null;
}

export class AgentSessionNotFoundError extends Error {
  public constructor(readonly sessionId: string) {
    super(`Agent Session ${sessionId} was not found`);
    this.name = 'AgentSessionNotFoundError';
  }
}

function fromRow(row: AgentSessionRow): AgentSessionRecord {
  return {
    id: row.id,
    siteId: row.site_id,
    piSessionId: row.pi_session_id,
    transcriptKey: row.transcript_key,
    displayName: row.display_name,
    ...(row.document_id && row.collection_id
      ? { documentId: row.document_id, collectionId: row.collection_id }
      : {}),
    state: row.state,
    ...(row.approval_mode === null ? {} : { approvalMode: row.approval_mode }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.archived_at === null ? {} : { archivedAt: row.archived_at }),
  };
}

const selectSession = `SELECT id, site_id, pi_session_id, transcript_key,
                               display_name, document_id, collection_id, state,
                               approval_mode, created_at, updated_at, archived_at
                          FROM agent_sessions`;

export class SqliteAgentSessionRepository {
  public constructor(private readonly database: StudioDatabase) {}

  public create(input: CreateAgentSessionInput): AgentSessionRecord {
    this.database
      .prepare(
        `INSERT INTO agent_sessions (
           id, site_id, pi_session_id, transcript_key, display_name,
           document_id, collection_id, state, approval_mode,
           created_at, updated_at, archived_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, NULL)`,
      )
      .run(
        input.id,
        input.siteId,
        input.piSessionId,
        input.transcriptKey,
        input.displayName,
        input.documentId ?? null,
        input.collectionId ?? null,
        input.approvalMode ?? null,
        input.createdAt,
        input.updatedAt,
      );
    return this.require(input.id);
  }

  public get(id: string): AgentSessionRecord | null {
    const row = this.database
      .prepare(`${selectSession} WHERE id = ?`)
      .get(id) as AgentSessionRow | undefined;
    return row ? fromRow(row) : null;
  }

  public list(
    siteId: string,
    options: { readonly includeArchived?: boolean } = {},
  ): readonly AgentSessionRecord[] {
    const rows = this.database
      .prepare(
        `${selectSession}
          WHERE site_id = ? ${options.includeArchived ? '' : "AND state = 'active'"}
          ORDER BY updated_at DESC, id`,
      )
      .all(siteId) as unknown as AgentSessionRow[];
    return rows.map(fromRow);
  }

  public rename(
    id: string,
    displayName: string,
    updatedAt: string,
  ): AgentSessionRecord {
    this.updateRequired(
      `UPDATE agent_sessions SET display_name = ?, updated_at = ? WHERE id = ?`,
      [displayName, updatedAt, id],
      id,
    );
    return this.require(id);
  }

  public archive(id: string, at: string): AgentSessionRecord {
    this.updateRequired(
      `UPDATE agent_sessions
          SET state = 'archived', archived_at = ?, updated_at = ?
        WHERE id = ?`,
      [at, at, id],
      id,
    );
    return this.require(id);
  }

  public restore(id: string, at: string): AgentSessionRecord {
    this.updateRequired(
      `UPDATE agent_sessions
          SET state = 'active', archived_at = NULL, updated_at = ?
        WHERE id = ?`,
      [at, id],
      id,
    );
    return this.require(id);
  }

  private require(id: string): AgentSessionRecord {
    const session = this.get(id);
    if (!session) throw new AgentSessionNotFoundError(id);
    return session;
  }

  private updateRequired(
    sql: string,
    values: readonly (string | null)[],
    id: string,
  ): void {
    const result = this.database.prepare(sql).run(...values);
    if (result.changes !== 1) throw new AgentSessionNotFoundError(id);
  }
}
