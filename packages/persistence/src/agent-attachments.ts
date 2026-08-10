import type { StudioDatabase } from './database.js';

export type AgentAttachmentStatus =
  'uploaded' | 'processing' | 'ready' | 'failed';

export interface AgentAttachmentRecord {
  readonly id: string;
  readonly sessionId: string;
  readonly messageEntryId?: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly byteSize: number;
  readonly sha256: string;
  readonly storageKey: string;
  readonly status: AgentAttachmentStatus;
  readonly visionModel?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type CreateAgentAttachmentInput = Omit<
  AgentAttachmentRecord,
  'messageEntryId' | 'status' | 'visionModel'
>;

interface AgentAttachmentRow {
  readonly id: string;
  readonly session_id: string;
  readonly message_entry_id: string | null;
  readonly filename: string;
  readonly mime_type: string;
  readonly byte_size: number;
  readonly sha256: string;
  readonly storage_key: string;
  readonly status: AgentAttachmentStatus;
  readonly vision_model: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export class AgentAttachmentNotFoundError extends Error {
  public constructor(readonly attachmentId: string) {
    super(`Agent attachment ${attachmentId} was not found`);
    this.name = 'AgentAttachmentNotFoundError';
  }
}

function fromRow(row: AgentAttachmentRow): AgentAttachmentRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    ...(row.message_entry_id === null
      ? {}
      : { messageEntryId: row.message_entry_id }),
    filename: row.filename,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    sha256: row.sha256,
    storageKey: row.storage_key,
    status: row.status,
    ...(row.vision_model === null ? {} : { visionModel: row.vision_model }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const selectAttachment = `SELECT id, session_id, message_entry_id, filename,
                                 mime_type, byte_size, sha256, storage_key,
                                 status, vision_model, created_at, updated_at
                            FROM agent_attachments`;

export class SqliteAgentAttachmentRepository {
  public constructor(private readonly database: StudioDatabase) {}

  public create(input: CreateAgentAttachmentInput): AgentAttachmentRecord {
    this.database
      .prepare(
        `INSERT INTO agent_attachments (
           id, session_id, message_entry_id, filename, mime_type, byte_size,
           sha256, storage_key, status, vision_model, created_at, updated_at
         ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 'uploaded', NULL, ?, ?)`,
      )
      .run(
        input.id,
        input.sessionId,
        input.filename,
        input.mimeType,
        input.byteSize,
        input.sha256,
        input.storageKey,
        input.createdAt,
        input.updatedAt,
      );
    return this.require(input.id);
  }

  public get(id: string): AgentAttachmentRecord | null {
    const row = this.database
      .prepare(`${selectAttachment} WHERE id = ?`)
      .get(id) as AgentAttachmentRow | undefined;
    return row ? fromRow(row) : null;
  }

  public list(sessionId: string): readonly AgentAttachmentRecord[] {
    const rows = this.database
      .prepare(
        `${selectAttachment}
          WHERE session_id = ?
          ORDER BY created_at, id`,
      )
      .all(sessionId) as unknown as AgentAttachmentRow[];
    return rows.map(fromRow);
  }

  public bindToMessage(
    id: string,
    messageEntryId: string,
    updatedAt: string,
  ): AgentAttachmentRecord {
    const result = this.database
      .prepare(
        `UPDATE agent_attachments
            SET message_entry_id = ?, updated_at = ?
          WHERE id = ? AND message_entry_id IS NULL`,
      )
      .run(messageEntryId, updatedAt, id);
    if (result.changes !== 1) throw new AgentAttachmentNotFoundError(id);
    return this.require(id);
  }

  public setVisionState(input: {
    readonly id: string;
    readonly status: AgentAttachmentStatus;
    readonly visionModel?: string;
    readonly updatedAt: string;
  }): AgentAttachmentRecord {
    const result = this.database
      .prepare(
        `UPDATE agent_attachments
            SET status = ?, vision_model = ?, updated_at = ?
          WHERE id = ?`,
      )
      .run(input.status, input.visionModel ?? null, input.updatedAt, input.id);
    if (result.changes !== 1) {
      throw new AgentAttachmentNotFoundError(input.id);
    }
    return this.require(input.id);
  }

  private require(id: string): AgentAttachmentRecord {
    const attachment = this.get(id);
    if (!attachment) throw new AgentAttachmentNotFoundError(id);
    return attachment;
  }
}
