import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  CredentialGenerationConflictError,
  openStudioDatabase,
  OwnerAlreadyInitializedError,
  SqliteOwnerCredentialRepository,
  SqliteOwnerSessionRepository,
} from '../src/index.js';

const temporaryDirectories: string[] = [];

function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'blog-studio-credential-'));
  temporaryDirectories.push(directory);
  return join(directory, 'studio.sqlite');
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('owner credential and session repositories', () => {
  it('initializes exactly one durable owner credential', () => {
    const path = databasePath();
    const firstDatabase = openStudioDatabase(path);
    const first = new SqliteOwnerCredentialRepository(firstDatabase);
    expect(first.get()).toBeNull();
    expect(
      first.initialize('scrypt:first', '2026-08-04T00:00:00.000Z'),
    ).toEqual({
      verifier: 'scrypt:first',
      generation: 1,
      createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-04T00:00:00.000Z',
    });
    expect(() =>
      first.initialize('scrypt:second', '2026-08-04T00:00:01.000Z'),
    ).toThrow(OwnerAlreadyInitializedError);
    firstDatabase.close();

    const secondDatabase = openStudioDatabase(path);
    expect(
      new SqliteOwnerCredentialRepository(secondDatabase).get()?.verifier,
    ).toBe('scrypt:first');
    secondDatabase.close();
  });

  it('rotates the generation and atomically invalidates every session', () => {
    const database = openStudioDatabase(databasePath());
    const credentials = new SqliteOwnerCredentialRepository(database);
    const sessions = new SqliteOwnerSessionRepository(database);
    credentials.initialize('scrypt:first', '2026-08-04T00:00:00.000Z');
    for (const tokenHash of ['hash-one', 'hash-two']) {
      sessions.create({
        tokenHash,
        credentialGeneration: 1,
        createdAt: '2026-08-04T00:00:01.000Z',
        expiresAt: '2026-08-05T00:00:00.000Z',
        lastSeenAt: '2026-08-04T00:00:01.000Z',
      });
      expect(
        sessions.getValid(tokenHash, '2026-08-04T12:00:00.000Z'),
      ).not.toBeNull();
    }

    const rotated = credentials.rotate({
      verifier: 'scrypt:next',
      expectedGeneration: 1,
      at: '2026-08-04T12:00:00.000Z',
    });
    expect(rotated.generation).toBe(2);
    expect(
      sessions.getValid('hash-one', '2026-08-04T12:00:01.000Z'),
    ).toBeNull();
    expect(
      sessions.getValid('hash-two', '2026-08-04T12:00:01.000Z'),
    ).toBeNull();
    database.close();
  });

  it('rejects a stale rotation without deleting sessions', () => {
    const database = openStudioDatabase(databasePath());
    const credentials = new SqliteOwnerCredentialRepository(database);
    const sessions = new SqliteOwnerSessionRepository(database);
    credentials.initialize('scrypt:first', '2026-08-04T00:00:00.000Z');
    sessions.create({
      tokenHash: 'keep-me',
      credentialGeneration: 1,
      createdAt: '2026-08-04T00:00:01.000Z',
      expiresAt: '2026-08-05T00:00:00.000Z',
      lastSeenAt: '2026-08-04T00:00:01.000Z',
    });

    expect(() =>
      credentials.rotate({
        verifier: 'scrypt:stale',
        expectedGeneration: 2,
        at: '2026-08-04T12:00:00.000Z',
      }),
    ).toThrow(CredentialGenerationConflictError);
    expect(
      sessions.getValid('keep-me', '2026-08-04T12:00:01.000Z'),
    ).not.toBeNull();
    expect(credentials.get()?.verifier).toBe('scrypt:first');
    database.close();
  });

  it('expires and reaps sessions without exposing raw tokens', () => {
    const database = openStudioDatabase(databasePath());
    new SqliteOwnerCredentialRepository(database).initialize(
      'scrypt:first',
      '2026-08-04T00:00:00.000Z',
    );
    const sessions = new SqliteOwnerSessionRepository(database);
    sessions.create({
      tokenHash: 'only-a-hash',
      credentialGeneration: 1,
      createdAt: '2026-08-04T00:00:00.000Z',
      expiresAt: '2026-08-04T01:00:00.000Z',
      lastSeenAt: '2026-08-04T00:00:00.000Z',
    });
    expect(
      sessions.getValid('only-a-hash', '2026-08-04T01:00:00.000Z'),
    ).toBeNull();
    expect(sessions.reapExpired('2026-08-04T01:00:00.000Z')).toBe(1);
    database.close();
  });
});
