import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  openStudioDatabase,
  OwnerAlreadyInitializedError,
  OwnerNotInitializedError,
  SqliteOwnerCredentialRepository,
  SqliteOwnerSessionRepository,
} from '@blog-studio/persistence';

import { OwnerAuthService } from './auth/owner-auth.js';

export interface StudioCliIo {
  readonly stdout: (message: string) => void;
  readonly stderr: (message: string) => void;
  readonly readStdin: () => Promise<string>;
  readonly readHiddenPassword: (prompt: string) => Promise<string>;
  readonly environment: Readonly<Record<string, string | undefined>>;
}

function defaultIo(): StudioCliIo {
  return {
    stdout: (message) => process.stdout.write(`${message}\n`),
    stderr: (message) => process.stderr.write(`${message}\n`),
    readStdin: async () => {
      let content = '';
      for await (const chunk of process.stdin as AsyncIterable<unknown>) {
        if (typeof chunk === 'string') content += chunk;
        else if (chunk instanceof Uint8Array) {
          content += Buffer.from(chunk).toString('utf8');
        } else {
          throw new Error('stdin returned an unsupported chunk');
        }
      }
      return content.replace(/\r?\n$/, '');
    },
    readHiddenPassword: readHiddenPasswordFromTerminal,
    environment: process.env,
  };
}

async function readHiddenPasswordFromTerminal(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      'Interactive password input requires a TTY; use --password-file or --password-stdin',
    );
  }
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  return await new Promise<string>((resolvePassword, reject) => {
    let password = '';
    const cleanup = () => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
    };
    const onData = (chunk: string | Buffer) => {
      const value = chunk.toString();
      for (const character of value) {
        if (character === '\u0003') {
          cleanup();
          process.stdout.write('\n');
          reject(new Error('Password input canceled'));
          return;
        }
        if (character === '\r' || character === '\n') {
          cleanup();
          process.stdout.write('\n');
          resolvePassword(password);
          return;
        }
        if (character === '\u007f' || character === '\b') {
          password = password.slice(0, -1);
        } else {
          password += character;
        }
      }
    };
    process.stdin.on('data', onData);
  });
}

interface ParsedArguments {
  readonly action: 'status' | 'init' | 'reset';
  readonly databasePath: string;
  readonly passwordFile?: string;
  readonly passwordStdin: boolean;
}

function parseArguments(
  arguments_: readonly string[],
  environment: StudioCliIo['environment'],
): ParsedArguments {
  const [group, action, ...options] = arguments_;
  if (group !== 'auth' || !['status', 'init', 'reset'].includes(action ?? '')) {
    throw new Error(
      'Usage: blog-studio auth <status|init|reset> --database <path> [--password-file <path>|--password-stdin]',
    );
  }
  let databasePath = environment.BLOG_STUDIO_DATABASE_PATH;
  let passwordFile: string | undefined;
  let passwordStdin = false;
  for (let index = 0; index < options.length; index++) {
    const option = options[index];
    if (option === '--database') {
      databasePath = options[++index];
    } else if (option === '--password-file') {
      passwordFile = options[++index];
    } else if (option === '--password-stdin') {
      passwordStdin = true;
    } else {
      throw new Error(`Unknown or unsafe option: ${option ?? '<missing>'}`);
    }
  }
  if (!databasePath)
    throw new Error('--database or BLOG_STUDIO_DATABASE_PATH is required');
  if (passwordFile && passwordStdin) {
    throw new Error('Choose exactly one password source');
  }
  if (action === 'status' && (passwordFile || passwordStdin)) {
    throw new Error('auth status does not accept a password source');
  }
  if (
    (options.includes('--database') && !databasePath) ||
    (options.includes('--password-file') && !passwordFile)
  ) {
    throw new Error('An option value is missing');
  }
  return {
    action: action as ParsedArguments['action'],
    databasePath,
    ...(passwordFile ? { passwordFile } : {}),
    passwordStdin,
  };
}

async function passwordFromArguments(
  parsed: ParsedArguments,
  io: StudioCliIo,
): Promise<string> {
  if (parsed.passwordFile) {
    const metadata = await stat(parsed.passwordFile);
    if (!metadata.isFile()) throw new Error('Password source must be a file');
    if (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0) {
      throw new Error(
        'Password file must not be accessible by group or others',
      );
    }
    return (await readFile(parsed.passwordFile, 'utf8')).replace(/\r?\n$/, '');
  }
  if (parsed.passwordStdin) return await io.readStdin();
  const first = await io.readHiddenPassword('New owner password: ');
  const confirmation = await io.readHiddenPassword('Confirm owner password: ');
  if (first !== confirmation)
    throw new Error('Password confirmation does not match');
  return first;
}

export async function runStudioCli(
  arguments_: readonly string[],
  io: StudioCliIo = defaultIo(),
): Promise<number> {
  const parsed = parseArguments(arguments_, io.environment);
  const database = openStudioDatabase(parsed.databasePath);
  try {
    const auth = new OwnerAuthService(
      new SqliteOwnerCredentialRepository(database),
      new SqliteOwnerSessionRepository(database),
    );
    if (parsed.action === 'status') {
      const status = auth.status();
      io.stdout(
        status.initialized
          ? `Owner credentials: initialized (generation ${status.generation})`
          : 'Owner credentials: not initialized',
      );
      return status.initialized ? 0 : 2;
    }
    const password = await passwordFromArguments(parsed, io);
    if (parsed.action === 'init') {
      await auth.initialize(password);
      io.stdout(
        'Owner credentials initialized; browser login now uses the password',
      );
    } else {
      const credential = await auth.resetPassword(password);
      io.stdout(
        `Owner credentials reset to generation ${credential.generation}; all sessions revoked`,
      );
    }
    return 0;
  } finally {
    database.close();
  }
}

async function main(): Promise<void> {
  try {
    process.exitCode = await runStudioCli(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const prefix =
      error instanceof OwnerAlreadyInitializedError ||
      error instanceof OwnerNotInitializedError
        ? 'Refused'
        : 'Error';
    process.stderr.write(`${prefix}: ${message}\n`);
    process.exitCode = 1;
  }
}

const executedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (executedPath === fileURLToPath(import.meta.url)) await main();
