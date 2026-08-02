import { cp, mkdtemp, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';

import { resolveWorkspacePath } from '@blog-studio/adapter-command';

import type { WorkspaceHandle } from './workspaces.js';

export interface WorkspaceSandbox {
  readonly directory: string;
  readonly workspaceRoot: string;
  dispose(): Promise<void>;
}

export async function createWorkspaceSandbox(
  workspace: WorkspaceHandle,
  purpose: 'preview' | 'release',
): Promise<WorkspaceSandbox> {
  const sourceRoot = await resolveWorkspacePath(
    workspace.config.workspace.root,
    '.',
  );
  const model = await workspace.generator.inspect(sourceRoot);
  const outputPath = relative(sourceRoot, model.outputDirectory);
  const directory = await mkdtemp(join(tmpdir(), `blog-studio-${purpose}-`));
  const destination = join(directory, 'workspace');
  const excludedRoots = new Set(['.git', 'node_modules']);
  if (outputPath && !outputPath.startsWith('..'))
    excludedRoots.add(outputPath.split(sep)[0] ?? outputPath);

  try {
    await cp(sourceRoot, destination, {
      recursive: true,
      filter(source) {
        const path = relative(sourceRoot, source);
        const root = path.split(sep)[0];
        return path === '' || !root || !excludedRoots.has(root);
      },
    });
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
      dispose: () => rm(directory, { force: true, recursive: true }),
    };
  } catch (error) {
    await rm(directory, { force: true, recursive: true });
    throw error;
  }
}
