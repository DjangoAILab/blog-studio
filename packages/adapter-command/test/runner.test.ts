import { mkdir, mkdtemp, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CommandTimeoutError,
  WorkspacePathError,
  runCommand,
} from '../src/index.js';

describe('runCommand', () => {
  it('passes arguments without a shell and exposes only allowlisted environment', async () => {
    const root = await mkdtemp(join(tmpdir(), 'blog-studio-command-'));
    const marker = '$(printf shell-was-used)';
    const result = await runCommand({
      executable: process.execPath,
      args: [
        '-e',
        'process.stdout.write(JSON.stringify({arg:process.argv[1],secret:process.env.BLOG_STUDIO_SECRET,home:process.env.HOME}))',
        marker,
      ],
      workspaceRoot: root,
      environmentAllowlist: ['BLOG_STUDIO_SECRET'],
      environment: { BLOG_STUDIO_SECRET: 'allowed' },
    });

    expect(JSON.parse(result.stdout)).toEqual({
      arg: marker,
      secret: 'allowed',
    });
  });

  it('terminates commands that exceed the timeout', async () => {
    const root = await mkdtemp(join(tmpdir(), 'blog-studio-command-'));
    await expect(
      runCommand({
        executable: process.execPath,
        args: ['-e', 'setTimeout(() => {}, 10_000)'],
        workspaceRoot: root,
        timeoutMs: 20,
      }),
    ).rejects.toBeInstanceOf(CommandTimeoutError);
  });

  it('rejects a cwd that escapes through a symlink', async () => {
    const root = await mkdtemp(join(tmpdir(), 'blog-studio-command-'));
    const outside = await mkdtemp(join(tmpdir(), 'blog-studio-outside-'));
    await mkdir(join(root, 'safe'));
    await symlink(outside, join(root, 'escape'));

    await expect(
      runCommand({
        executable: process.execPath,
        args: ['-e', 'process.exit(0)'],
        workspaceRoot: root,
        cwd: 'escape',
      }),
    ).rejects.toBeInstanceOf(WorkspacePathError);
  });
});
