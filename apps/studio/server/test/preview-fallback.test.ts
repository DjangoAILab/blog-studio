import { describe, expect, it } from 'vitest';

import {
  createContentHash,
  createDocumentId,
  createWorkspaceId,
} from '@blog-studio/core';

import { MarkdownPreviewService } from '../services/markdown-previews.js';
import { PreviewService } from '../services/previews.js';
import type { WorkspaceService } from '../services/workspaces.js';

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
});
