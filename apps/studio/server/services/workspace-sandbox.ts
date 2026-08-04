import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { promisify } from 'node:util';

import { resolveWorkspacePath } from '@blog-studio/adapter-command';

import type { WorkspaceHandle } from './workspaces.js';

const execute = promisify(execFile);

export interface WorkspaceSandbox {
  readonly directory: string;
  readonly workspaceRoot: string;
  dispose(): Promise<void>;
}

export async function createWorkspaceSandbox(
  workspace: WorkspaceHandle,
  purpose: 'preview' | 'release',
  commitId?: string,
  parentDirectory?: string,
): Promise<WorkspaceSandbox> {
  const sourceRoot = await resolveWorkspacePath(
    workspace.config.workspace.root,
    '.',
  );
  const model = await workspace.generator.inspect(sourceRoot);
  const outputPath = relative(sourceRoot, model.outputDirectory);
  const sandboxParent = parentDirectory ?? tmpdir();
  await mkdir(sandboxParent, { recursive: true });
  const directory = await mkdtemp(
    join(
      sandboxParent,
      parentDirectory ? `${purpose}-` : `blog-studio-${purpose}-`,
    ),
  );
  const destination = join(directory, 'workspace');
  const excludedRoots = new Set(['.git', 'node_modules']);
  if (outputPath && !outputPath.startsWith('..'))
    excludedRoots.add(outputPath.split(sep)[0] ?? outputPath);

  try {
    if (commitId) {
      if (!/^[a-f0-9]{40,64}$/.test(commitId))
        throw new Error('Release commit ID is invalid');
      await execute(
        'git',
        [
          '-C',
          sourceRoot,
          'worktree',
          'add',
          '--detach',
          destination,
          commitId,
        ],
        { maxBuffer: 4 * 1024 * 1024 },
      );
    } else {
      await cp(sourceRoot, destination, {
        recursive: true,
        filter(source) {
          const path = relative(sourceRoot, source);
          const root = path.split(sep)[0];
          return path === '' || !root || !excludedRoots.has(root);
        },
      });
    }
    const dependencies = join(sourceRoot, 'node_modules');
    try {
      await stat(dependencies);
      await symlink(
        dependencies,
        join(destination, 'node_modules'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    } catch {
      // A generator may use a globally installed executable instead.
    }
    return {
      directory,
      workspaceRoot: destination,
      dispose: async () => {
        if (commitId) {
          await execute(
            'git',
            ['-C', sourceRoot, 'worktree', 'remove', '--force', destination],
            { maxBuffer: 4 * 1024 * 1024 },
          );
        }
        await rm(directory, { force: true, recursive: true });
      },
    };
  } catch (error) {
    if (commitId) {
      await execute(
        'git',
        ['-C', sourceRoot, 'worktree', 'remove', '--force', destination],
        { maxBuffer: 4 * 1024 * 1024 },
      ).catch(() => undefined);
    }
    await rm(directory, { force: true, recursive: true });
    throw error;
  }
}
