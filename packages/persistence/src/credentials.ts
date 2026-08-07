import type { StudioDatabase } from './database.js';

export interface OwnerCredential {
  readonly verifier: string;
  readonly generation: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface CredentialRow {
  readonly verifier: string;
  readonly generation: number;
  readonly created_at: string;
  readonly updated_at: string;
}

export class OwnerAlreadyInitializedError extends Error {
  public constructor() {
    super('Owner credentials are already initialized');
    this.name = 'OwnerAlreadyInitializedError';
  }
}

export class OwnerNotInitializedError extends Error {
  public constructor() {
    super('Owner credentials are not initialized');
    this.name = 'OwnerNotInitializedError';
  }
}

export class CredentialGenerationConflictError extends Error {
  public constructor(
    readonly expected: number,
    readonly actual: number,
  ) {
    super(
      `Owner credential generation conflict: expected ${expected}, found ${actual}`,
    );
    this.name = 'CredentialGenerationConflictError';
  }
}

function credentialFromRow(row: CredentialRow): OwnerCredential {
  return {
    verifier: row.verifier,
    generation: row.generation,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteOwnerCredentialRepository {
  public constructor(private readonly database: StudioDatabase) {}

  public get(): OwnerCredential | null {
    const row = this.database
      .prepare(
        `SELECT verifier, generation, created_at, updated_at
           FROM owner_credentials WHERE owner_id = 1`,
      )
      .get() as CredentialRow | undefined;
    return row ? credentialFromRow(row) : null;
  }

  public initialize(verifier: string, at: string): OwnerCredential {
    try {
      this.database
        .prepare(
          `INSERT INTO owner_credentials (
             owner_id, verifier, generation, created_at, updated_at
           ) VALUES (1, ?, 1, ?, ?)`,
        )
        .run(verifier, at, at);
    } catch (error) {
      if (
        error instanceof Error &&
        /UNIQUE constraint failed: owner_credentials\.owner_id/.test(
          error.message,
        )
      ) {
        throw new OwnerAlreadyInitializedError();
      }
      throw error;
    }
    return this.get()!;
  }

  public rotate(input: {
    readonly verifier: string;
    readonly expectedGeneration: number;
    readonly at: string;
  }): OwnerCredential {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const current = this.get();
      if (!current) throw new OwnerNotInitializedError();
      if (current.generation !== input.expectedGeneration) {
        throw new CredentialGenerationConflictError(
          input.expectedGeneration,
          current.generation,
        );
      }
      const nextGeneration = current.generation + 1;
      this.database
        .prepare(
          `UPDATE owner_credentials
              SET verifier = ?, generation = ?, updated_at = ?
            WHERE owner_id = 1 AND generation = ?`,
        )
        .run(input.verifier, nextGeneration, input.at, current.generation);
      this.database.exec('DELETE FROM owner_sessions');
      this.database.exec('COMMIT');
      return this.get()!;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}
