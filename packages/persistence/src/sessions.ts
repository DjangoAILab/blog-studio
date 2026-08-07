import type { StudioDatabase } from './database.js';

export interface OwnerSession {
  readonly tokenHash: string;
  readonly credentialGeneration: number;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly lastSeenAt: string;
}

interface SessionRow {
  readonly token_hash: string;
  readonly credential_generation: number;
  readonly created_at: string;
  readonly expires_at: string;
  readonly last_seen_at: string;
}

function sessionFromRow(row: SessionRow): OwnerSession {
  return {
    tokenHash: row.token_hash,
    credentialGeneration: row.credential_generation,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastSeenAt: row.last_seen_at,
  };
}

export class SqliteOwnerSessionRepository {
  public constructor(private readonly database: StudioDatabase) {}

  public create(session: OwnerSession): OwnerSession {
    this.database
      .prepare(
        `INSERT INTO owner_sessions (
           token_hash, credential_generation, created_at, expires_at, last_seen_at
         ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        session.tokenHash,
        session.credentialGeneration,
        session.createdAt,
        session.expiresAt,
        session.lastSeenAt,
      );
    return session;
  }

  public getValid(tokenHash: string, at: string): OwnerSession | null {
    const row = this.database
      .prepare(
        `SELECT s.token_hash, s.credential_generation, s.created_at,
                s.expires_at, s.last_seen_at
           FROM owner_sessions s
           JOIN owner_credentials c ON c.owner_id = 1
          WHERE s.token_hash = ?
            AND s.expires_at > ?
            AND s.credential_generation = c.generation`,
      )
      .get(tokenHash, at) as SessionRow | undefined;
    return row ? sessionFromRow(row) : null;
  }

  public touch(tokenHash: string, at: string): boolean {
    return (
      this.database
        .prepare(
          'UPDATE owner_sessions SET last_seen_at = ? WHERE token_hash = ?',
        )
        .run(at, tokenHash).changes === 1
    );
  }

  public delete(tokenHash: string): boolean {
    return (
      this.database
        .prepare('DELETE FROM owner_sessions WHERE token_hash = ?')
        .run(tokenHash).changes === 1
    );
  }

  public deleteAll(): number {
    return Number(
      this.database.prepare('DELETE FROM owner_sessions').run().changes,
    );
  }

  public reapExpired(at: string): number {
    return Number(
      this.database
        .prepare('DELETE FROM owner_sessions WHERE expires_at <= ?')
        .run(at).changes,
    );
  }
}
