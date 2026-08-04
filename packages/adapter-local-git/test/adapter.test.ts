import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createWorkspaceId } from '@blog-studio/core';
import { afterEach, describe, expect, it } from 'vitest';

import { LocalGitRepositoryAdapter } from '../src/index.js';

const roots: string[] = [];

function git(root: string, ...args: string[]): void {
  execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' });
}

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'blog-studio-git-'));
  roots.push(root);
  git(root, 'init', '-q');
  git(root, 'config', 'user.name', 'Blog Studio Test');
  git(root, 'config', 'user.email', 'studio@example.invalid');
  writeFileSync(join(root, '.gitignore'), 'ignored/**\n');
  writeFileSync(join(root, 'modified.md'), 'before\n');
  writeFileSync(join(root, 'deleted.md'), 'delete me\n');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'baseline');
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});

describe('local Git repository inspection', () => {
  it('reports managed, unmanaged, ignored, staged, hashes, and diffs without mutation', async () => {
    const root = fixture();
    writeFileSync(join(root, 'modified.md'), 'after\n');
    rmSync(join(root, 'deleted.md'));
    writeFileSync(join(root, 'unmanaged.pdf'), '%PDF-1.7\n');
    const ignoredDirectory = join(root, 'ignored');
    writeFileSync(join(root, '.gitignore'), 'ignored/**\n');
    mkdirSync(ignoredDirectory);
    writeFileSync(join(ignoredDirectory, 'cache.txt'), 'cache\n');
    git(root, 'add', 'modified.md');

    const adapter = new LocalGitRepositoryAdapter();
    const before = execFileSync(
      'git',
      ['-C', root, 'status', '--porcelain=v1'],
      {
        encoding: 'utf8',
      },
    );
    const status = await adapter.status(createWorkspaceId('site'), root);
    const after = execFileSync(
      'git',
      ['-C', root, 'status', '--porcelain=v1'],
      {
        encoding: 'utf8',
      },
    );

    expect(after).toBe(before);
    expect(status.head).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(status.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'modified.md',
          state: 'modified',
          staged: true,
        }),
        expect.objectContaining({ path: 'deleted.md', state: 'deleted' }),
        expect.objectContaining({
          path: 'unmanaged.pdf',
          state: 'unmanaged',
        }),
        expect.objectContaining({
          path: 'ignored/cache.txt',
          state: 'ignored',
        }),
      ]),
    );
    const modified = status.changes.find(
      (entry) => entry.path === 'modified.md',
    );
    expect(modified?.currentHash).toMatch(/^sha256:/);
    expect(modified?.diff).toContain('+after');
  });

  it('commits only selected paths and preserves unrelated staged work', async () => {
    const root = fixture();
    writeFileSync(join(root, 'modified.md'), 'selected\n');
    writeFileSync(join(root, 'unrelated.md'), 'unrelated\n');
    git(root, 'add', 'unrelated.md');

    const checkpoint = await new LocalGitRepositoryAdapter().checkpoint(
      createWorkspaceId('site'),
      root,
      'Apply reviewed change',
      ['modified.md'],
    );

    expect(checkpoint.commitId).toMatch(/^[a-f0-9]{40,64}$/);
    expect(
      execFileSync(
        'git',
        ['-C', root, 'show', '--pretty=', '--name-only', 'HEAD'],
        {
          encoding: 'utf8',
        },
      ).trim(),
    ).toBe('modified.md');
    expect(
      execFileSync('git', ['-C', root, 'diff', '--cached', '--name-only'], {
        encoding: 'utf8',
      }).trim(),
    ).toBe('unrelated.md');
  });

  it('restores the exact index when commit creation fails', async () => {
    const root = fixture();
    writeFileSync(join(root, 'modified.md'), 'selected\n');
    writeFileSync(join(root, 'unrelated.md'), 'unrelated\n');
    git(root, 'add', 'unrelated.md');
    git(root, 'config', 'user.name', '');
    git(root, 'config', 'user.email', '');
    const before = execFileSync(
      'git',
      ['-C', root, 'diff', '--cached', '--binary'],
      { encoding: 'utf8' },
    );

    await expect(
      new LocalGitRepositoryAdapter().checkpoint(
        createWorkspaceId('site'),
        root,
        'Must fail',
        ['modified.md'],
      ),
    ).rejects.toThrow();

    expect(
      execFileSync('git', ['-C', root, 'diff', '--cached', '--binary'], {
        encoding: 'utf8',
      }),
    ).toBe(before);
    expect(
      execFileSync('git', ['-C', root, 'diff', '--name-only'], {
        encoding: 'utf8',
      }).trim(),
    ).toBe('modified.md');
  });
});
