import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  openStudioDatabase,
  SqliteOwnerCredentialRepository,
  SqliteOwnerSessionRepository,
} from '@blog-studio/persistence';
import { afterEach, describe, expect, it } from 'vitest';

import { OwnerAuthService } from '../auth/owner-auth.js';
import { runStudioCli, type StudioCliIo } from '../cli.js';

const temporaryDirectories: string[] = [];

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'blog-studio-cli-'));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, 'studio.sqlite');
  const stdout: string[] = [];
  const stderr: string[] = [];
  let stdin = '';
  let hiddenPasswords: string[] = [];
  const io: StudioCliIo = {
    stdout: (message) => stdout.push(message),
    stderr: (message) => stderr.push(message),
    readStdin: () => Promise.resolve(stdin),
    readHiddenPassword: () =>
      Promise.resolve(hiddenPasswords.shift() ?? 'missing test password'),
    environment: {},
  };
  return {
    databasePath,
    directory,
    io,
    stdout,
    stderr,
    setStdin(value: string) {
      stdin = value;
    },
    setHiddenPasswords(...values: string[]) {
      hiddenPasswords = values;
    },
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(async (directory) =>
        rm(directory, { force: true, recursive: true }),
      ),
  );
});

describe('Blog Studio auth CLI', () => {
  it('reports initialization state without exposing credential material', async () => {
    const test = await fixture();
    await expect(
      runStudioCli(
        ['auth', 'status', '--database', test.databasePath],
        test.io,
      ),
    ).resolves.toBe(2);
    expect(test.stdout).toEqual(['Owner credentials: not initialized']);
    expect(test.stderr).toEqual([]);
  });

  it('initializes from a mode-safe password file and refuses replacement', async () => {
    const test = await fixture();
    const passwordFile = join(test.directory, 'owner-password');
    await writeFile(passwordFile, 'initial owner passphrase\n', {
      mode: 0o600,
    });
    await expect(
      runStudioCli(
        [
          'auth',
          'init',
          '--database',
          test.databasePath,
          '--password-file',
          passwordFile,
        ],
        test.io,
      ),
    ).resolves.toBe(0);
    await expect(
      runStudioCli(
        [
          'auth',
          'init',
          '--database',
          test.databasePath,
          '--password-file',
          passwordFile,
        ],
        test.io,
      ),
    ).rejects.toThrow('already initialized');
    const database = openStudioDatabase(test.databasePath);
    const verifier = new SqliteOwnerCredentialRepository(database).get()
      ?.verifier;
    expect(verifier).not.toContain('initial owner passphrase');
    expect(await readFile(passwordFile, 'utf8')).toBe(
      'initial owner passphrase\n',
    );
    database.close();
  });

  it('rejects a password file readable by another local user', async () => {
    const test = await fixture();
    const passwordFile = join(test.directory, 'unsafe-password');
    await writeFile(passwordFile, 'initial owner passphrase\n', {
      mode: 0o644,
    });
    await expect(
      runStudioCli(
        [
          'auth',
          'init',
          '--database',
          test.databasePath,
          '--password-file',
          passwordFile,
        ],
        test.io,
      ),
    ).rejects.toThrow('must not be accessible by group or others');
  });

  it('supports confirmed hidden input and rejects mismatched confirmation', async () => {
    const test = await fixture();
    test.setHiddenPasswords('owner passphrase one', 'owner passphrase two');
    await expect(
      runStudioCli(['auth', 'init', '--database', test.databasePath], test.io),
    ).rejects.toThrow('confirmation does not match');
    const database = openStudioDatabase(test.databasePath);
    expect(new SqliteOwnerCredentialRepository(database).get()).toBeNull();
    database.close();
  });

  it('resets through stdin and revokes sessions without printing the password', async () => {
    const test = await fixture();
    test.setStdin('initial owner passphrase');
    await runStudioCli(
      ['auth', 'init', '--database', test.databasePath, '--password-stdin'],
      test.io,
    );
    const database = openStudioDatabase(test.databasePath);
    const auth = new OwnerAuthService(
      new SqliteOwnerCredentialRepository(database),
      new SqliteOwnerSessionRepository(database),
    );
    const oldSession = await auth.login('initial owner passphrase');
    database.close();

    test.setStdin('emergency reset passphrase');
    await expect(
      runStudioCli(
        ['auth', 'reset', '--database', test.databasePath, '--password-stdin'],
        test.io,
      ),
    ).resolves.toBe(0);
    const reopened = openStudioDatabase(test.databasePath);
    const afterReset = new OwnerAuthService(
      new SqliteOwnerCredentialRepository(reopened),
      new SqliteOwnerSessionRepository(reopened),
    );
    expect(afterReset.validateSession(oldSession.token)).toBe(false);
    await expect(
      afterReset.login('emergency reset passphrase'),
    ).resolves.toBeDefined();
    expect(test.stdout.join('\n')).not.toContain('emergency reset passphrase');
    reopened.close();
  });

  it('rejects plaintext and ambiguous password options', async () => {
    const test = await fixture();
    await expect(
      runStudioCli(
        [
          'auth',
          'init',
          '--database',
          test.databasePath,
          '--password',
          'visible-secret',
        ],
        test.io,
      ),
    ).rejects.toThrow('Unknown or unsafe option: --password');
    await expect(
      runStudioCli(
        [
          'auth',
          'init',
          '--database',
          test.databasePath,
          '--password-file',
          '/tmp/one',
          '--password-stdin',
        ],
        test.io,
      ),
    ).rejects.toThrow('exactly one password source');
  });
});
