import {
  BlogStudioError,
  createContentHash,
  createDocumentId,
  createWorkspaceId,
  type ContentHash,
  type DocumentId,
  type FrontMatterValue,
  type WorkspaceId,
} from '@blog-studio/core';

import type { StudioDatabase } from './database.js';

export interface DraftSnapshot {
  readonly workspaceId: WorkspaceId;
  readonly documentId: DocumentId;
  readonly version: number;
  readonly sourceRevision: ContentHash;
  readonly frontMatter: Readonly<Record<string, FrontMatterValue>>;
  readonly body: string;
  readonly savedAt: string;
}

export interface SaveDraftInput {
  readonly workspaceId: WorkspaceId;
  readonly documentId: DocumentId;
  readonly expectedVersion: number;
  readonly sourceRevision: ContentHash;
  readonly frontMatter: Readonly<Record<string, FrontMatterValue>>;
  readonly body: string;
  readonly savedAt: string;
}

interface DraftRow {
  readonly workspace_id: string;
  readonly document_id: string;
  readonly version: number;
  readonly source_revision: string;
  readonly front_matter_json: string;
  readonly body: string;
  readonly saved_at: string;
}

export class RevisionConflictError extends BlogStudioError {
  public constructor(expectedVersion: number, actualVersion: number) {
    super(
      'REVISION_CONFLICT',
      `Draft revision conflict: expected ${expectedVersion}, found ${actualVersion}`,
      { actualVersion, expectedVersion },
    );
    this.name = 'RevisionConflictError';
  }
}

function decodeFrontMatter(
  source: string,
): Readonly<Record<string, FrontMatterValue>> {
  const value = JSON.parse(source) as unknown;
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new Error('Stored draft front matter is not an object');
  }
  return value as Readonly<Record<string, FrontMatterValue>>;
}

function decodeDraft(row: DraftRow): DraftSnapshot {
  return {
    workspaceId: createWorkspaceId(row.workspace_id),
    documentId: createDocumentId(row.document_id),
    version: row.version,
    sourceRevision: createContentHash(row.source_revision),
    frontMatter: decodeFrontMatter(row.front_matter_json),
    body: row.body,
    savedAt: row.saved_at,
  };
}

export class SqliteDraftRepository {
  public constructor(private readonly database: StudioDatabase) {}

  public get(
    workspaceId: WorkspaceId,
    documentId: DocumentId,
  ): DraftSnapshot | null {
    const row = this.database
      .prepare(
        `SELECT workspace_id, document_id, version, source_revision,
                front_matter_json, body, saved_at
           FROM drafts
          WHERE workspace_id = ? AND document_id = ?`,
      )
      .get(workspaceId, documentId) as DraftRow | undefined;
    return row === undefined ? null : decodeDraft(row);
  }

  public save(input: SaveDraftInput): DraftSnapshot {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.get(input.workspaceId, input.documentId);
      const actualVersion = existing?.version ?? 0;
      if (actualVersion !== input.expectedVersion) {
        throw new RevisionConflictError(input.expectedVersion, actualVersion);
      }

      const nextVersion = actualVersion + 1;
      this.database
        .prepare(
          `INSERT INTO drafts (
             workspace_id, document_id, version, source_revision,
             front_matter_json, body, saved_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(workspace_id, document_id) DO UPDATE SET
             version = excluded.version,
             source_revision = excluded.source_revision,
             front_matter_json = excluded.front_matter_json,
             body = excluded.body,
             saved_at = excluded.saved_at`,
        )
        .run(
          input.workspaceId,
          input.documentId,
          nextVersion,
          input.sourceRevision,
          JSON.stringify(input.frontMatter),
          input.body,
          input.savedAt,
        );
      this.database.exec('COMMIT');

      return {
        workspaceId: input.workspaceId,
        documentId: input.documentId,
        version: nextVersion,
        sourceRevision: input.sourceRevision,
        frontMatter: input.frontMatter,
        body: input.body,
        savedAt: input.savedAt,
      };
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  public delete(
    workspaceId: WorkspaceId,
    documentId: DocumentId,
    expectedVersion: number,
  ): boolean {
    return (
      this.database
        .prepare(
          `DELETE FROM drafts
            WHERE workspace_id = ? AND document_id = ? AND version = ?`,
        )
        .run(workspaceId, documentId, expectedVersion).changes === 1
    );
  }
}
