import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { assertGeneratorAdapterConformance } from '@blog-studio/adapter-testkit';

import { CommandGeneratorAdapter } from '../src/index.js';

describe('CommandGeneratorAdapter', () => {
  it('models a non-Hexo file site and uses distinct preview arguments', async () => {
    const root = await mkdtemp(join(tmpdir(), 'blog-studio-generic-'));
    await mkdir(join(root, 'content'), { recursive: true });
    await writeFile(join(root, 'site.marker'), 'generic');
    await writeFile(
      join(root, 'content', 'hello.md'),
      '---\ntitle: Hello\npermalink: notes/hello/\n---\nBody\n',
    );
    const script = join(root, 'build.mjs');
    await writeFile(
      script,
      "import{mkdir,writeFile}from'node:fs/promises';await mkdir('dist',{recursive:true});await writeFile('dist/index.html',process.argv[2]);",
    );
    const adapter = new CommandGeneratorAdapter({
      workspaceId: 'generic-site',
      markers: ['site.marker'],
      outputDirectory: 'dist',
      siteUrl: 'https://generic.example',
      collections: [{ id: 'notes', label: 'Notes', path: 'content' }],
      command: {
        executable: process.execPath,
        buildArgs: [script, 'production'],
        previewArgs: [script, 'preview'],
      },
    });

    await expect(adapter.detect(root)).resolves.toMatchObject({
      detected: true,
    });
    const documents = await adapter.listDocuments(root, 'notes');
    expect(documents[0]?.title).toBe('Hello');
    expect(documents[0]?.revision).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(documents[0]?.tags).toEqual([]);
    if (!documents[0]) throw new Error('fixture document missing');
    await expect(
      adapter.resolvePublicUrl(root, documents[0].ref),
    ).resolves.toBe('https://generic.example/notes/hello/');
    const result = await adapter.build({
      workspaceRoot: root,
      mode: 'preview',
    });
    expect(result.manifest).toHaveLength(1);
    expect(result.manifest[0]?.mediaType).toBe('text/html; charset=utf-8');
  });

  it('passes the shared generator adapter contract', async () => {
    const root = await mkdtemp(join(tmpdir(), 'blog-studio-generic-'));
    await mkdir(join(root, 'content'), { recursive: true });
    await writeFile(join(root, 'site.marker'), 'generic');
    await writeFile(
      join(root, 'content', 'hello.md'),
      '---\ntitle: Hello\npermalink: hello/\n---\nBody\n',
    );
    const script = join(root, 'build.mjs');
    await writeFile(
      script,
      "import{mkdir,writeFile}from'node:fs/promises';await mkdir('dist',{recursive:true});await writeFile('dist/index.html','ok');",
    );

    await expect(
      assertGeneratorAdapterConformance(() => ({
        workspaceRoot: root,
        collectionId: 'notes',
        adapter: new CommandGeneratorAdapter({
          workspaceId: 'generic-site',
          markers: ['site.marker'],
          outputDirectory: 'dist',
          siteUrl: 'https://generic.example',
          collections: [{ id: 'notes', label: 'Notes', path: 'content' }],
          command: {
            executable: process.execPath,
            buildArgs: [script],
          },
        }),
      })),
    ).resolves.toBeUndefined();
  });
});
