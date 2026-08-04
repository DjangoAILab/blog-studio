import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createContentHash,
  createDocumentId,
  createWorkspaceId,
  type BuildInput,
} from '@blog-studio/core';

import { MarkdownPreviewService } from '../services/markdown-previews.js';
import { PreviewService } from '../services/previews.js';
import type {
  WorkspaceHandle,
  WorkspaceService,
} from '../services/workspaces.js';

describe('Markdown preview fallback', () => {
  it('renders Markdown while neutralizing raw HTML and rewriting local resources', () => {
    const previews = new MarkdownPreviewService(1_000);
    const session = previews.start({
      title: '<unsafe title>',
      body: `# Safe heading

<script>alert('no')</script>

<img src=x onerror=alert(1)>

![Local](../static/reading.jpeg)

[Blocked](javascript:alert(1))

![Remote](https://images.example.test/cover.png)
`,
      resourceBase: '/safe-resource?source=',
      now: 1_000,
    });

    expect(session.html).toContain('<h1>Safe heading</h1>');
    expect(session.html).toContain('&lt;script&gt;');
    expect(session.html).not.toContain('<script');
    expect(session.html).not.toContain('<img src=x');
    expect(session.html).toContain(
      'src="/safe-resource?source=..%2Fstatic%2Freading.jpeg"',
    );
    expect(session.html).not.toContain('javascript:');
    expect(session.html).toContain('href="#blocked-resource"');
    expect(session.html).toContain(
      'src="https://images.example.test/cover.png"',
    );
    expect(session.html).toContain('<title>&lt;unsafe title&gt;</title>');
    expect(previews.get(session.id, 1_999)).toEqual(session);
    expect(previews.reapExpired(2_000)).toBe(1);
    expect(() => previews.get(session.id, 2_000)).toThrow(/Unknown Markdown/);
  });

  it('rejects enhanced preview before creating a sandbox when unsupported', async () => {
    const workspaces = {
      get: () => ({
        generator: {
          id: 'static-only',
          capabilities: { preview: false },
        },
      }),
    } as unknown as WorkspaceService;
    const previews = new PreviewService(workspaces);

    await expect(
      previews.start({
        workspaceId: 'static-site',
        ref: {
          workspaceId: createWorkspaceId('static-site'),
          collectionId: 'posts',
          documentId: createDocumentId('doc-one'),
          path: 'posts/one.md',
        },
        sourceRevision: createContentHash(`sha256:${'a'.repeat(64)}`),
        source: { frontMatter: { title: 'One' }, body: 'Body' },
      }),
    ).rejects.toMatchObject({ reason: 'unsupported-engine' });
  });

  it('cancels an in-flight generator and removes its isolated sandbox', async () => {
    const root = await mkdtemp(join(tmpdir(), 'blog-studio-preview-source-'));
    const sandboxRoot = await mkdtemp(
      join(tmpdir(), 'blog-studio-preview-state-'),
    );
    await mkdir(join(root, 'source', '_posts'), { recursive: true });
    await writeFile(join(root, 'source', '_posts', 'one.md'), 'Body');
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const workspace = {
      config: { workspace: { id: 'cancel-site', root } },
      generator: {
        id: 'slow-generator',
        capabilities: { preview: true, drafts: false, mdx: false },
        inspect: (workspaceRoot: string) =>
          Promise.resolve({
            collections: [],
            diagnostics: [],
            outputDirectory: join(workspaceRoot, 'public'),
          }),
        writeDocument: () =>
          Promise.resolve({
            revision: createContentHash(`sha256:${'b'.repeat(64)}`),
            changed: true,
          }),
        resolvePublicUrl: () => Promise.resolve('https://example.test/one/'),
        build: (input: BuildInput) =>
          new Promise((_resolve, reject) => {
            markStarted?.();
            input.signal?.addEventListener(
              'abort',
              () => reject(new Error('fixture generator canceled')),
              { once: true },
            );
          }),
      },
    } as unknown as WorkspaceHandle;
    const workspaces = {
      get: () => workspace,
    } as unknown as WorkspaceService;
    const previews = new PreviewService(workspaces, 60_000, sandboxRoot);
    await previews.recover();
    const preview = previews.start({
      workspaceId: 'cancel-site',
      ref: {
        workspaceId: createWorkspaceId('cancel-site'),
        collectionId: 'posts',
        documentId: createDocumentId('doc-one'),
        path: 'source/_posts/one.md',
      },
      sourceRevision: createContentHash(`sha256:${'a'.repeat(64)}`),
      source: { frontMatter: { title: 'One' }, body: 'Body' },
    });
    await started;
    expect(await readdir(sandboxRoot)).toHaveLength(1);

    await expect(previews.stop('cancel-site')).resolves.toBe(true);
    await expect(preview).rejects.toMatchObject({ reason: 'canceled' });
    expect(await readdir(sandboxRoot)).toEqual([]);
  });

  it('removes interrupted sandboxes before accepting requests after restart', async () => {
    const sandboxRoot = await mkdtemp(
      join(tmpdir(), 'blog-studio-preview-recovery-'),
    );
    await mkdir(join(sandboxRoot, 'preview-interrupted', 'workspace'), {
      recursive: true,
    });
    await writeFile(
      join(sandboxRoot, 'preview-interrupted', 'workspace', 'partial.html'),
      'partial',
    );
    const previews = new PreviewService(
      { get: () => undefined } as unknown as WorkspaceService,
      60_000,
      sandboxRoot,
    );

    await expect(previews.recover()).resolves.toBe(1);
    expect(await readdir(sandboxRoot)).toEqual([]);
  });
});
