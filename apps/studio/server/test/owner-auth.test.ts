import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  openStudioDatabase,
  OwnerAlreadyInitializedError,
  SqliteOwnerCredentialRepository,
  SqliteOwnerSessionRepository,
} from '@blog-studio/persistence';
import { afterEach, describe, expect, it } from 'vitest';

import {
  hashOwnerSessionToken,
  OwnerAuthenticationFailedError,
  OwnerAuthService,
  OwnerSessionInvalidError,
} from '../auth/owner-auth.js';
import {
  hashOwnerPassword,
  PasswordPolicyError,
  verifyOwnerPassword,
} from '../auth/passwords.js';

const temporaryDirectories: string[] = [];

function authFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'blog-studio-owner-auth-'));
  temporaryDirectories.push(directory);
  const database = openStudioDatabase(join(directory, 'studio.sqlite'));
  let now = new Date('2026-08-04T00:00:00.000Z');
  const credentials = new SqliteOwnerCredentialRepository(database);
  const sessions = new SqliteOwnerSessionRepository(database);
  const auth = new OwnerAuthService(credentials, sessions, {
    now: () => now,
    sessionTtlMs: 60_000,
  });
  return {
    auth,
    credentials,
    database,
    sessions,
    advance(milliseconds: number) {
      now = new Date(now.getTime() + milliseconds);
    },
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('owner password verifier', () => {
  it('uses a randomized versioned scrypt verifier', async () => {
    const first = await hashOwnerPassword('correct horse battery staple');
    const second = await hashOwnerPassword('correct horse battery staple');
    expect(first).toMatch(/^blog-studio-scrypt-v1\$N=32768,r=8,p=1\$/);
    expect(second).not.toBe(first);
    await expect(
      verifyOwnerPassword('correct horse battery staple', first),
    ).resolves.toBe(true);
    await expect(
      verifyOwnerPassword('wrong password value', first),
    ).resolves.toBe(false);
    await expect(
      verifyOwnerPassword('anything at all', 'malformed'),
    ).resolves.toBe(false);
  });

  it('accepts passphrases but rejects weak, blank, NUL, and oversized input', async () => {
    await expect(hashOwnerPassword('too short')).rejects.toBeInstanceOf(
      PasswordPolicyError,
    );
    await expect(hashOwnerPassword('            ')).rejects.toBeInstanceOf(
      PasswordPolicyError,
    );
    await expect(
      hashOwnerPassword('long enough\0password'),
    ).rejects.toBeInstanceOf(PasswordPolicyError);
    await expect(hashOwnerPassword('密'.repeat(400))).rejects.toBeInstanceOf(
      PasswordPolicyError,
    );
  });
});

describe('owner authentication service', () => {
  it('initializes only through the trusted service and stores no plaintext', async () => {
    const fixture = authFixture();
    expect(fixture.auth.status()).toEqual({ initialized: false });
    await fixture.auth.initialize('initial owner passphrase');
    expect(fixture.auth.status()).toEqual({ initialized: true, generation: 1 });
    expect(fixture.credentials.get()?.verifier).not.toContain(
      'initial owner passphrase',
    );
    await expect(
      fixture.auth.initialize('replacement passphrase'),
    ).rejects.toBeInstanceOf(OwnerAlreadyInitializedError);
    fixture.database.close();
  });

  it('stores only a session-token hash and expires it server-side', async () => {
    const fixture = authFixture();
    await fixture.auth.initialize('initial owner passphrase');
    const session = await fixture.auth.login('initial owner passphrase');
    expect(session.token).not.toBe(hashOwnerSessionToken(session.token));
    expect(
      fixture.sessions.getValid(
        hashOwnerSessionToken(session.token),
        '2026-08-04T00:00:00.000Z',
      ),
    ).not.toBeNull();
    expect(fixture.auth.validateSession(session.token)).toBe(true);
    fixture.advance(60_000);
    expect(fixture.auth.validateSession(session.token)).toBe(false);
    fixture.database.close();
  });

  it('rejects a wrong password without creating a session', async () => {
    const fixture = authFixture();
    await fixture.auth.initialize('initial owner passphrase');
    await expect(
      fixture.auth.login('incorrect passphrase'),
    ).rejects.toBeInstanceOf(OwnerAuthenticationFailedError);
    expect(fixture.sessions.deleteAll()).toBe(0);
    fixture.database.close();
  });

  it('changes password after re-authentication and revokes all prior sessions', async () => {
    const fixture = authFixture();
    await fixture.auth.initialize('initial owner passphrase');
    const first = await fixture.auth.login('initial owner passphrase');
    const second = await fixture.auth.login('initial owner passphrase');
    const replacement = await fixture.auth.changePassword({
      sessionToken: first.token,
      currentPassword: 'initial owner passphrase',
      newPassword: 'replacement owner passphrase',
    });
    expect(fixture.auth.validateSession(first.token)).toBe(false);
    expect(fixture.auth.validateSession(second.token)).toBe(false);
    expect(fixture.auth.validateSession(replacement.token)).toBe(true);
    await expect(
      fixture.auth.login('initial owner passphrase'),
    ).rejects.toBeInstanceOf(OwnerAuthenticationFailedError);
    await expect(
      fixture.auth.login('replacement owner passphrase'),
    ).resolves.toMatchObject({ credentialGeneration: 2 });
    fixture.database.close();
  });

  it('requires a valid session and current password before in-product change', async () => {
    const fixture = authFixture();
    await fixture.auth.initialize('initial owner passphrase');
    const session = await fixture.auth.login('initial owner passphrase');
    await expect(
      fixture.auth.changePassword({
        sessionToken: 'invalid',
        currentPassword: 'initial owner passphrase',
        newPassword: 'replacement owner passphrase',
      }),
    ).rejects.toBeInstanceOf(OwnerSessionInvalidError);
    await expect(
      fixture.auth.changePassword({
        sessionToken: session.token,
        currentPassword: 'wrong current password',
        newPassword: 'replacement owner passphrase',
      }),
    ).rejects.toBeInstanceOf(OwnerAuthenticationFailedError);
    expect(fixture.auth.validateSession(session.token)).toBe(true);
    fixture.database.close();
  });

  it('CLI-equivalent reset rotates credentials and revokes every session', async () => {
    const fixture = authFixture();
    await fixture.auth.initialize('initial owner passphrase');
    const session = await fixture.auth.login('initial owner passphrase');
    await fixture.auth.resetPassword('emergency reset passphrase');
    expect(fixture.auth.validateSession(session.token)).toBe(false);
    await expect(
      fixture.auth.login('emergency reset passphrase'),
    ).resolves.toMatchObject({ credentialGeneration: 2 });
    fixture.database.close();
  });
});
