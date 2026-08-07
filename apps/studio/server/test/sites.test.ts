import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { WorkspaceService } from '../services/workspaces.js';

const temporaryDirectories: string[] = [];

function configuration(root: string): string {
  return `version: 1
workspace:
  id: secure-site
  root: ${root}
generator:
  adapter: hexo
  options: {}
repository:
  adapter: local-git
assets:
  adapter: filesystem
  options:
    rootDirectory: source
publish:
  adapter: none
  options: {}
`;
}

describe('Site discovery workspace boundary', () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map(async (directory) => {
        await rm(directory, { recursive: true, force: true });
      }),
    );
  });

  it('rejects configured roots outside the administrator allowlist', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'blog-studio-sites-'));
    temporaryDirectories.push(parent);
    const allowedRoot = join(parent, 'allowed');
    const outsideRoot = join(parent, 'outside');
    await Promise.all([
      mkdir(allowedRoot, { recursive: true }),
      mkdir(join(outsideRoot, 'source'), { recursive: true }),
    ]);
    const configPath = join(parent, 'outside.yml');
    await writeFile(configPath, configuration(outsideRoot));

    await expect(
      WorkspaceService.load({
        configurationPaths: [configPath],
        allowedWorkspaceRoot: allowedRoot,
      }),
    ).rejects.toThrow(/escapes the workspace root/);
  });

  it('rejects an allowed-looking root that escapes through a symlink', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'blog-studio-sites-'));
    temporaryDirectories.push(parent);
    const allowedRoot = join(parent, 'allowed');
    const outsideRoot = join(parent, 'outside');
    const linkedRoot = join(allowedRoot, 'linked-site');
    await Promise.all([
      mkdir(allowedRoot, { recursive: true }),
      mkdir(join(outsideRoot, 'source'), { recursive: true }),
    ]);
    await symlink(outsideRoot, linkedRoot);
    const configPath = join(parent, 'symlink.yml');
    await writeFile(configPath, configuration(linkedRoot));

    await expect(
      WorkspaceService.load({
        configurationPaths: [configPath],
        allowedWorkspaceRoot: allowedRoot,
      }),
    ).rejects.toThrow(/escapes the workspace root/);
  });
});
