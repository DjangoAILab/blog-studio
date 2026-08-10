import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { promisify } from 'node:util';

import { assertSitePath } from './site-path.js';

const executeFile = promisify(execFile);
const revisionPattern = /^(?:HEAD(?:~[0-9]{1,6})?|[0-9a-f]{7,64})$/;
const maximumOutputBytes = 2 * 1024 * 1024;

export class StructuredGitInputError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'StructuredGitInputError';
  }
}

export interface StructuredGitLogOptions {
  readonly limit?: number;
}

export interface StructuredGitShowOptions {
  readonly revision: string;
  readonly path?: string;
}

export interface StructuredGitRestoreOptions {
  readonly path: string;
}

export interface TrackedFileSnapshot {
  readonly path: string;
  readonly before: Uint8Array;
  readonly afterSha256?: string;
}

/** Fixed-shape local Git operations. No executable or free-form args cross this API. */
export class StructuredSiteGit {
  readonly #rootPromise: Promise<string>;

  public constructor(siteRoot: string) {
    this.#rootPromise = realpath(siteRoot);
  }

  public async status(): Promise<string> {
    return await this.#git([
      'status',
      '--porcelain=v1',
      '--branch',
      '--untracked-files=all',
    ]);
  }

  public async diff(path?: string): Promise<string> {
    return await this.#git([
      'diff',
      '--no-ext-diff',
      '--no-textconv',
      ...(path ? ['--', await this.#path(path)] : []),
    ]);
  }

  public async log(options: StructuredGitLogOptions = {}): Promise<string> {
    const limit = options.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
      throw new StructuredGitInputError(
        'Git log limit must be between 1 and 50',
      );
    }
    return await this.#git([
      'log',
      `--max-count=${limit}`,
      '--date=iso-strict',
      '--format=%H%x09%aI%x09%an%x09%s',
    ]);
  }

  public async show(options: StructuredGitShowOptions): Promise<string> {
    this.#revision(options.revision);
    return await this.#git([
      'show',
      '--no-ext-diff',
      '--no-textconv',
      '--format=fuller',
      options.revision,
      ...(options.path ? ['--', await this.#path(options.path)] : []),
    ]);
  }

  /** Restore one tracked working-tree path from HEAD; index and other paths stay intact. */
  public async restorePath(
    options: StructuredGitRestoreOptions,
  ): Promise<void> {
    await this.#git([
      'restore',
      '--source=HEAD',
      '--worktree',
      '--',
      await this.#path(options.path),
    ]);
  }

  /** Capture a tracked regular file without including unrelated human changes. */
  public async captureTrackedFile(
    input: string,
  ): Promise<TrackedFileSnapshot | null> {
    const path = await this.#path(input);
    try {
      await this.#git(['ls-files', '--error-unmatch', '--', path]);
    } catch {
      return null;
    }
    const root = await this.#rootPromise;
    const absolute = await assertSitePath(root, path);
    const metadata = await lstat(absolute).catch(() => undefined);
    if (!metadata?.isFile()) return null;
    return { path, before: await readFile(absolute) };
  }

  /** Seal the exact post-mutation state used to reject later human edits. */
  public async sealTrackedFile(
    snapshot: TrackedFileSnapshot,
  ): Promise<TrackedFileSnapshot> {
    const root = await this.#rootPromise;
    const absolute = await assertSitePath(root, snapshot.path);
    const bytes = await readFile(absolute).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    });
    return {
      ...snapshot,
      ...(bytes
        ? {
            afterSha256: createHash('sha256').update(bytes).digest('hex'),
          }
        : {}),
    };
  }

  /** Restore only when the file still equals the Agent-produced state. */
  public async restoreAgentSnapshot(
    snapshot: TrackedFileSnapshot,
  ): Promise<void> {
    const root = await this.#rootPromise;
    const absolute = await assertSitePath(root, snapshot.path);
    const current = await readFile(absolute).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    });
    const currentSha256 = current
      ? createHash('sha256').update(current).digest('hex')
      : undefined;
    if (currentSha256 !== snapshot.afterSha256) {
      throw new StructuredGitInputError(
        'The path changed after the Agent mutation; refusing to overwrite later work',
      );
    }
    await writeFile(absolute, snapshot.before);
  }

  async #path(input: string): Promise<string> {
    const root = await this.#rootPromise;
    const path = await assertSitePath(root, input);
    const pathFromRoot = relative(root, path);
    if (!pathFromRoot) {
      throw new StructuredGitInputError(
        'A repository-wide path is not allowed',
      );
    }
    return pathFromRoot;
  }

  #revision(revision: string): void {
    if (!revisionPattern.test(revision)) {
      throw new StructuredGitInputError(
        'Git revision is not an allowed fixed form',
      );
    }
  }

  async #git(arguments_: readonly string[]): Promise<string> {
    const root = await this.#rootPromise;
    const { stdout } = await executeFile(
      'git',
      [
        '-c',
        'alias.show=!false',
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'core.fsmonitor=false',
        '-C',
        root,
        ...arguments_,
      ],
      {
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH,
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: '/dev/null',
          GIT_OPTIONAL_LOCKS: '0',
          LC_ALL: 'C',
        },
        maxBuffer: maximumOutputBytes,
        timeout: 15_000,
      },
    );
    return stdout;
  }
}
