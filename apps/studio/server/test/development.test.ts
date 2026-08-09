import { createServer } from 'node:net';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DevelopmentService } from '../services/development.js';
import { WorkspaceService } from '../services/workspaces.js';

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

describe('DevelopmentService', () => {
  it('runs only in a per-Site sandbox and removes it after stop', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'blog-studio-development-'));
    const workspace = join(parent, 'workspace');
    const stateDirectory = join(parent, 'development-state');
    const port = await freePort();
    await mkdir(join(workspace, 'source', '_posts'), { recursive: true });
    await writeFile(
      join(workspace, '_config.yml'),
      'url: http://example.test\n',
    );
    await writeFile(
      join(workspace, 'source', '_posts', 'hello.md'),
      '---\ntitle: Original\n---\nOriginal body\n',
    );
    await writeFile(
      join(workspace, 'development-server.mjs'),
      `import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
await writeFile('executed-in-sandbox', process.cwd());
createServer((_, response) => response.end('ready')).listen(${port}, '127.0.0.1');
`,
    );
    const configurationPath = join(parent, 'blog-studio.yml');
    await writeFile(
      configurationPath,
      `version: 1
workspace:
  id: development-test
  root: ${workspace}
generator:
  adapter: hexo
repository:
  adapter: local-git
assets:
  adapter: filesystem
publish:
  adapter: none
development:
  command: ${process.execPath}
  args: [development-server.mjs]
  baseUrl: http://127.0.0.1:${port}
  previewUrl: https://preview.example.test/
  startupTimeoutMs: 5000
`,
    );
    const workspaces = await WorkspaceService.load({
      configurationPaths: [configurationPath],
      allowedWorkspaceRoot: parent,
    });
    const service = new DevelopmentService(workspaces, stateDirectory);

    const started = await service.start('development-test');
    expect(started).toMatchObject({
      status: 'ready',
      previewUrl: 'https://preview.example.test/',
    });
    await expect(
      access(join(workspace, 'executed-in-sandbox')),
    ).rejects.toThrow();
    const sandboxParent = join(stateDirectory, 'development-test');
    const [sandboxDirectory] = await readdir(sandboxParent);
    if (!sandboxDirectory) throw new Error('sandbox missing');
    const summary = (
      await workspaces
        .get('development-test')
        .generator.listDocuments(workspace, 'posts')
    )[0];
    if (!summary) throw new Error('fixture post missing');
    const { ref } = await workspaces.findDocument(
      'development-test',
      'posts',
      summary.ref.documentId,
    );
    const source = await workspaces
      .get('development-test')
      .generator.readDocument(workspace, ref);
    expect(
      (
        await service.sync({
          workspaceId: 'development-test',
          ref,
          sourceRevision: source.revision,
          frontMatter: { title: 'Synced' },
          body: 'Updated through the working copy\n',
        })
      ).status,
    ).toBe('ready');
    await expect(
      readFile(
        join(
          sandboxParent,
          sandboxDirectory,
          'workspace',
          'source',
          '_posts',
          'hello.md',
        ),
        'utf8',
      ),
    ).resolves.toContain('Updated through the working copy');
    expect(await readdir(sandboxParent)).toHaveLength(1);

    const stopped = await service.stop('development-test');
    expect(stopped.status).toBe('stopped');
    expect(await readdir(sandboxParent)).toEqual([]);
    await service.dispose();
  });
});
