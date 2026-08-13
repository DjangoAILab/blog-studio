import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { lstat, readFile, readlink } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import {
  ADAPTER_API_VERSION,
  createContentHash,
  type RepositoryAdapter,
  type RepositoryChange,
  type RepositoryChangeState,
  type RepositoryCheckpoint,
  type RepositoryStatus,
  type WorkspaceId,
} from '@blog-studio/core';

const execute = promisify(execFile);

function contentHash(bytes: Uint8Array | string) {
  return createContentHash(
    `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  );
}

async function git(root: string, args: readonly string[]): Promise<string> {
  const result = await execute('git', ['-C', root, ...args], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return result.stdout;
}

function state(code: string): RepositoryChangeState {
  if (code === '??') return 'unmanaged';
  if (code === '!!') return 'ignored';
  if (['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(code))
    return 'conflicted';
  if (code.includes('D')) return 'deleted';
  if ([...code].some((value) => ['A', 'R', 'C'].includes(value)))
    return 'added';
  return 'modified';
}

function statusEntries(output: string): Array<{
  readonly code: string;
  readonly path: string;
}> {
  const tokens = output.split('\0').filter(Boolean);
  const entries: Array<{ code: string; path: string }> = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    const code = token.slice(0, 2);
    const path = token.slice(3);
    if (
      !path ||
      path.startsWith('/') ||
      path.split('/').includes('..') ||
      [...path].some((character) => (character.codePointAt(0) ?? 0) < 0x20)
    )
      throw new Error('Git returned a non-portable repository path');
    entries.push({ code, path });
    if (code.includes('R') || code.includes('C')) index++;
  }
  return entries;
}

async function change(root: string, entry: { code: string; path: string }) {
  const changeState = state(entry.code);
  let currentHash: ReturnType<typeof contentHash> | undefined;
  if (!['deleted', 'ignored'].includes(changeState)) {
    const path = join(root, entry.path);
    const details = await lstat(path);
    currentHash = contentHash(
      details.isSymbolicLink()
        ? `symlink:${await readlink(path)}`
        : await readFile(path),
    );
  }
  const diff = ['unmanaged', 'ignored'].includes(changeState)
    ? undefined
    : await git(root, [
        'diff',
        '--no-ext-diff',
        '--no-color',
        '--unified=3',
        'HEAD',
        '--',
        entry.path,
      ]);
  return {
    path: entry.path,
    state: changeState,
    staged: ![' ', '?', '!'].includes(entry.code[0] ?? ' '),
    ...(currentHash ? { currentHash } : {}),
    ...(diff ? { diff } : {}),
  } satisfies RepositoryChange;
}

export class LocalGitRepositoryAdapter implements RepositoryAdapter {
  public readonly apiVersion = ADAPTER_API_VERSION;
  public readonly id = 'local-git';
  public readonly displayName = 'Local Git';

  public async status(
    _workspaceId: WorkspaceId,
    workspaceRoot: string,
  ): Promise<RepositoryStatus> {
    const [head, branch, porcelain] = await Promise.all([
      git(workspaceRoot, ['rev-parse', '--verify', 'HEAD']),
      git(workspaceRoot, ['branch', '--show-current']),
      git(workspaceRoot, [
        'status',
        '--porcelain=v1',
        '-z',
        '--ignored=matching',
        '--untracked-files=all',
      ]),
    ]);
    let ahead = 0;
    let behind = 0;
    try {
      const counts = (
        await git(workspaceRoot, [
          'rev-list',
          '--left-right',
          '--count',
          '@{upstream}...HEAD',
        ])
      )
        .trim()
        .split(/\s+/)
        .map(Number);
      behind = counts[0] ?? 0;
      ahead = counts[1] ?? 0;
    } catch {
      // A local-only repository legitimately has no upstream.
    }
    const changes = await Promise.all(
      statusEntries(porcelain).map((entry) => change(workspaceRoot, entry)),
    );
    return {
      branch: branch.trim() || '(detached)',
      head: contentHash(head.trim()),
      dirtyPaths: changes
        .filter((entry) => entry.state !== 'ignored')
        .map((entry) => entry.path),
      ahead,
      behind,
      changes,
    };
  }

  public checkpoint(
    workspaceId: WorkspaceId,
    workspaceRoot: string,
    message: string,
    paths: readonly string[],
  ): Promise<RepositoryCheckpoint> {
    return this.#checkpoint(workspaceId, workspaceRoot, message, paths);
  }

  async #checkpoint(
    workspaceId: WorkspaceId,
    workspaceRoot: string,
    message: string,
    paths: readonly string[],
  ): Promise<RepositoryCheckpoint> {
    if (!message.trim()) throw new Error('Commit message is required');
    const uniquePaths = [...new Set(paths)];
    if (uniquePaths.length === 0) throw new Error('Commit paths are required');
    if (
      uniquePaths.some(
        (path) =>
          !path ||
          path.startsWith('/') ||
          path.split('/').includes('..') ||
          [...path].some((character) => (character.codePointAt(0) ?? 0) < 0x20),
      )
    )
      throw new Error('Commit path is not portable');
    const before = await this.status(workspaceId, workspaceRoot);
    const byPath = new Map(before.changes.map((entry) => [entry.path, entry]));
    for (const path of uniquePaths) {
      const entry = byPath.get(path);
      if (!entry) throw new Error(`Commit path is no longer changed: ${path}`);
      if (entry.state === 'ignored' || entry.state === 'conflicted')
        throw new Error(`Commit path cannot be committed safely: ${path}`);
    }
    const indexTree = (await git(workspaceRoot, ['write-tree'])).trim();
    try {
      await git(workspaceRoot, ['add', '--all', '--', ...uniquePaths]);
      await git(workspaceRoot, [
        'commit',
        '--only',
        '--no-verify',
        '-m',
        message.trim(),
        '--',
        ...uniquePaths,
      ]);
    } catch (error) {
      await git(workspaceRoot, ['read-tree', indexTree]);
      throw error;
    }
    const commitId = (await git(workspaceRoot, ['rev-parse', 'HEAD'])).trim();
    return {
      head: contentHash(commitId),
      commitId,
      message: message.trim(),
      createdAt: new Date().toISOString(),
    };
  }

  public async readCommitted(
    workspaceRoot: string,
    path: string,
  ): Promise<string | undefined> {
    try {
      return await git(workspaceRoot, ['show', `HEAD:${path}`]);
    } catch {
      return undefined;
    }
  }

  public async restorePath(workspaceRoot: string, path: string): Promise<void> {
    const committed = await this.readCommitted(workspaceRoot, path);
    if (committed === undefined) {
      throw new Error(`No committed version to restore: ${path}`);
    }
    await git(workspaceRoot, ['checkout', 'HEAD', '--', path]);
  }

  public push(): Promise<void> {
    return Promise.reject(new Error('Local Git push is not implemented'));
  }
}
