import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { assertGeneratorAdapterConformance } from '@blog-studio/adapter-testkit';

import { HexoGeneratorAdapter } from '../src/index.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

async function copySite(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'blog-studio-hexo-'));
  await cp(join(fixtures, 'site'), root, { recursive: true });
  return root;
}

function createAdapter(
  options: { readonly build?: boolean; readonly configPath?: string } = {},
) {
  return new HexoGeneratorAdapter({
    workspaceId: 'synthetic-blog',
    ...(options.configPath ? { configPath: options.configPath } : {}),
    ...(options.build
      ? {
          executable: process.execPath,
          executableArgs: [join(fixtures, 'fake-build.mjs')],
        }
      : {}),
  });
}

describe('HexoGeneratorAdapter', () => {
  it('detects Hexo and discovers posts and drafts including Chinese filenames', async () => {
    const root = await copySite();
    const adapter = createAdapter();

    await expect(adapter.detect(root)).resolves.toMatchObject({
      detected: true,
      confidence: 1,
    });
    const posts = await adapter.listDocuments(root, 'posts');
    const drafts = await adapter.listDocuments(root, 'drafts');

    expect(posts).toHaveLength(1);
    expect(posts[0]?.ref.path).toBe('source/_posts/你好-世界.md');
    expect(posts[0]?.title).toBe('你好，世界');
    expect(drafts[0]?.state).toBe('draft');
  });

  it('uses an administrator-configured Hexo configuration path', async () => {
    const root = await copySite();
    await rename(join(root, '_config.yml'), join(root, 'custom.yml'));
    const adapter = createAdapter({ build: true, configPath: 'custom.yml' });

    await expect(adapter.detect(root)).resolves.toMatchObject({
      detected: true,
      confidence: 1,
    });
    const [summary] = await adapter.listDocuments(root, 'posts');
    if (!summary) throw new Error('fixture post missing');
    await expect(adapter.resolvePublicUrl(root, summary.ref)).resolves.toBe(
      'https://example.com/2026/08/02/%E4%BD%A0%E5%A5%BD-%E4%B8%96%E7%95%8C/',
    );
    await adapter.build({ workspaceRoot: root, mode: 'production' });
    await expect(
      readFile(join(root, 'public', 'config-argument.txt'), 'utf8'),
    ).resolves.toBe('custom.yml');
  });

  it('round-trips unknown front matter, Hexo tags, and raw HTML', async () => {
    const root = await copySite();
    const adapter = createAdapter();
    const [summary] = await adapter.listDocuments(root, 'posts');
    if (!summary) throw new Error('fixture post missing');
    const source = await adapter.readDocument(root, summary.ref);

    const unchanged = await adapter.writeDocument(root, {
      ref: summary.ref,
      expectedRevision: source.revision,
      frontMatter: source.frontMatter,
      body: source.body,
    });
    expect(unchanged.changed).toBe(false);

    const changed = await adapter.writeDocument(root, {
      ref: summary.ref,
      expectedRevision: source.revision,
      frontMatter: { ...source.frontMatter, title: '修改后的标题' },
      body: source.body,
    });
    expect(changed.changed).toBe(true);
    const written = await readFile(join(root, summary.ref.path), 'utf8');
    expect(written).toContain('custom_plugin_option:');
    expect(written).toContain('{% note info %}');
    expect(written).toContain('<aside data-kind="raw">');
  });

  it('creates portable native drafts exclusively and promotes by revision', async () => {
    const root = await copySite();
    const adapter = createAdapter();
    const created = await adapter.createDocument(root, {
      collectionId: 'drafts',
      title: '新的文章',
      slug: 'new-article',
      createdAt: '2026-08-02T12:00:00.000Z',
    });

    expect(created.source.ref.path).toBe('source/_drafts/new-article.md');
    expect(created.source.frontMatter).toMatchObject({
      title: '新的文章',
      date: '2026-08-02T12:00:00.000Z',
    });
    await expect(
      adapter.createDocument(root, {
        collectionId: 'drafts',
        title: '重复',
        slug: 'new-article',
        createdAt: '2026-08-02T12:00:00.000Z',
      }),
    ).rejects.toThrow('already exists');

    const promoted = await adapter.promoteDocument(root, {
      ref: created.source.ref,
      targetCollectionId: 'posts',
      expectedRevision: created.source.revision,
    });
    expect(promoted.ref.path).toBe('source/_posts/new-article.md');
    await expect(stat(join(root, promoted.ref.path))).resolves.toMatchObject(
      {},
    );
    await expect(stat(join(root, created.source.ref.path))).rejects.toThrow();
  });

  it('rejects unsafe draft slugs and stale promotion revisions', async () => {
    const root = await copySite();
    const adapter = createAdapter();
    await expect(
      adapter.createDocument(root, {
        collectionId: 'drafts',
        title: 'Unsafe',
        slug: '../unsafe',
        createdAt: '2026-08-02T12:00:00.000Z',
      }),
    ).rejects.toThrow('portable');
    const created = await adapter.createDocument(root, {
      collectionId: 'drafts',
      title: 'Safe',
      slug: 'safe',
      createdAt: '2026-08-02T12:00:00.000Z',
    });
    await expect(
      adapter.promoteDocument(root, {
        ref: created.source.ref,
        targetCollectionId: 'posts',
        expectedRevision: created.source.revision.replace(
          /.$/,
          '0',
        ) as typeof created.source.revision,
      }),
    ).rejects.toThrow('revision conflict');
  });

  it('resolves the configured Hexo permalink without changing old paths', async () => {
    const root = await copySite();
    const adapter = createAdapter();
    const [summary] = await adapter.listDocuments(root, 'posts');
    if (!summary) throw new Error('fixture post missing');

    await expect(adapter.resolvePublicUrl(root, summary.ref)).resolves.toBe(
      'https://example.com/2026/08/02/%E4%BD%A0%E5%A5%BD-%E4%B8%96%E7%95%8C/',
    );
  });

  it('resolves root-relative and document-relative legacy asset sources safely', async () => {
    const root = await copySite();
    const adapter = createAdapter();
    const [summary] = await adapter.listDocuments(root, 'posts');
    if (!summary) throw new Error('fixture post missing');
    await mkdir(join(root, 'source', 'static', 'assets'), { recursive: true });
    await writeFile(
      join(root, 'source', 'static', 'assets', 'legacy.png'),
      'png',
    );

    await expect(
      adapter.resolveAssetSourcePath(
        root,
        summary.ref,
        '../static/assets/legacy.png',
      ),
    ).resolves.toBe('source/static/assets/legacy.png');
    await expect(
      adapter.resolveAssetSourcePath(
        root,
        summary.ref,
        '/static/assets/legacy.png',
      ),
    ).resolves.toBe('source/static/assets/legacy.png');
    await expect(
      adapter.resolveAssetSourcePath(
        root,
        summary.ref,
        '../../../../etc/passwd',
      ),
    ).resolves.toBeUndefined();
  });

  it('matches Hexo date normalization for legacy three-digit days', async () => {
    const root = await copySite();
    const adapter = createAdapter();
    const [summary] = await adapter.listDocuments(root, 'posts');
    if (!summary) throw new Error('fixture post missing');
    const source = await adapter.readDocument(root, summary.ref);
    await adapter.writeDocument(root, {
      ref: summary.ref,
      expectedRevision: source.revision,
      frontMatter: { ...source.frontMatter, date: '2026-08-014 09:30:00' },
      body: source.body,
    });

    await expect(adapter.resolvePublicUrl(root, summary.ref)).resolves.toBe(
      'https://example.com/2026/08/14/%E4%BD%A0%E5%A5%BD-%E4%B8%96%E7%95%8C/',
    );
  });

  it('rejects impossible dates instead of inventing a public URL', async () => {
    const root = await copySite();
    const adapter = createAdapter();
    const [summary] = await adapter.listDocuments(root, 'posts');
    if (!summary) throw new Error('fixture post missing');
    const source = await adapter.readDocument(root, summary.ref);
    await adapter.writeDocument(root, {
      ref: summary.ref,
      expectedRevision: source.revision,
      frontMatter: { ...source.frontMatter, date: '2026-02-030 09:30:00' },
      body: source.body,
    });

    await expect(adapter.resolvePublicUrl(root, summary.ref)).rejects.toThrow(
      'Invalid Hexo document date',
    );
  });

  it('builds with an argument array and returns a content manifest', async () => {
    const root = await copySite();
    const result = await createAdapter({ build: true }).build({
      workspaceRoot: root,
      mode: 'production',
    });

    expect(result.manifest.map((entry) => entry.path)).toEqual([
      'assets/app.css',
      'index.html',
    ]);
    await expect(stat(result.outputDirectory)).resolves.toMatchObject({});
  });

  it('rejects stale writes', async () => {
    const root = await copySite();
    const adapter = createAdapter();
    const [summary] = await adapter.listDocuments(root, 'posts');
    if (!summary) throw new Error('fixture post missing');
    const source = await adapter.readDocument(root, summary.ref);

    await expect(
      adapter.writeDocument(root, {
        ref: summary.ref,
        expectedRevision: source.revision.replace(
          /.$/,
          '0',
        ) as typeof source.revision,
        frontMatter: source.frontMatter,
        body: source.body,
      }),
    ).rejects.toThrow('revision conflict');
  });

  it('passes the shared generator adapter contract', async () => {
    const root = await copySite();
    await expect(
      assertGeneratorAdapterConformance(() => ({
        adapter: createAdapter({ build: true }),
        workspaceRoot: root,
        collectionId: 'posts',
      })),
    ).resolves.toBeUndefined();
  });
});
