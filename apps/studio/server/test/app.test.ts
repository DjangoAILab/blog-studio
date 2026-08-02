import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';
import {
  TencentCosPublisher,
  type CosPublisherClient,
} from '@blog-studio/publisher-cos';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';

import { createStudioServer } from '../app.js';

const origin = 'https://studio.example.test';
const authToken = 'test-auth-token-at-least-sixteen';
const cookieSecret = 'test-cookie-secret-with-at-least-thirty-two-characters';
const apps: FastifyInstance[] = [];

interface FixtureOptions {
  readonly existingCosObjects?: Map<string, Uint8Array>;
}

async function fixture(options: FixtureOptions = {}): Promise<{
  readonly app: FastifyInstance;
  readonly workspace: string;
  readonly publishTarget: string;
  readonly cosObjects?: Map<string, Uint8Array>;
}> {
  const parent = await mkdtemp(join(tmpdir(), 'blog-studio-api-'));
  const workspace = join(parent, 'site');
  const publishTarget = join(parent, 'published');
  const client = join(parent, 'client');
  await mkdir(join(workspace, 'source', '_posts'), { recursive: true });
  await mkdir(join(workspace, 'source', '_drafts'), { recursive: true });
  await mkdir(join(workspace, 'source', 'static'), { recursive: true });
  await mkdir(join(workspace, 'node_modules', '.bin'), { recursive: true });
  await mkdir(client);
  await writeFile(join(client, 'index.html'), '<h1>Blog Studio</h1>');
  await writeFile(
    join(workspace, '_config.yml'),
    'url: https://blog.example.test\npermalink: :year/:month/:day/:title/\n',
  );
  await writeFile(
    join(workspace, 'source', 'static', 'reading.jpeg'),
    new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
  );
  await writeFile(
    join(workspace, 'package.json'),
    JSON.stringify({ private: true, dependencies: { hexo: 'test' } }),
  );
  await writeFile(
    join(workspace, 'source', '_posts', 'hello.md'),
    '---\ntitle: Hello\ndate: 2026-08-02 10:00:00\ncustom: keep\n---\nBody\n',
  );
  const fakeHexo = join(workspace, 'node_modules', '.bin', 'hexo');
  await writeFile(
    fakeHexo,
    "#!/usr/bin/env node\nconst{mkdir,readFile,writeFile}=await import('node:fs/promises');const body=await readFile('source/_posts/hello.md','utf8');await mkdir('public/2026/08/02/hello',{recursive:true});await mkdir('public/css',{recursive:true});await writeFile('public/index.html','preview');await writeFile('public/css/site.css','body{background:url(../../static/reading.jpeg)}');await writeFile('public/2026/08/02/hello/index.html','<link href=\"/css/site.css\"><img src=\"../../../../static/reading.jpeg\">'+body);\n",
  );
  await chmod(fakeHexo, 0o755);
  const configPath = join(parent, 'blog-studio.yml');
  const usesCosBaseline = options.existingCosObjects !== undefined;
  await writeFile(
    configPath,
    `version: 1
workspace:
  id: test-blog
  root: ${workspace}
generator:
  adapter: hexo
repository:
  adapter: local-git
assets:
  adapter: filesystem
  options:
    rootDirectory: source
    managedPrefix: media/posts
    protectedPrefixes: [static]
    publicBaseUrl: https://blog.example.test/
publish:
  adapter: ${usesCosBaseline ? 'tencent-cos' : 'filesystem'}
  options:
    ${
      usesCosBaseline
        ? `targetId: production
    allowBaselineAdoption: true`
        : `directory: ${publishTarget}`
    }
verification:
  baseUrl: https://blog.example.test
`,
  );

  const cosObjects = options.existingCosObjects;
  const cosClient: CosPublisherClient | undefined = cosObjects
    ? {
        putObject: ({ key, body }) => {
          cosObjects.set(key, Uint8Array.from(body));
          return Promise.resolve();
        },
        getObject: ({ key }) => {
          const body = cosObjects.get(key);
          if (!body)
            throw Object.assign(new Error(`Missing COS object: ${key}`), {
              statusCode: 404,
            });
          return Promise.resolve(Uint8Array.from(body));
        },
        listObjects: ({ prefix }) =>
          Promise.resolve({
            objects: [...cosObjects.entries()]
              .filter(([key]) => key.startsWith(prefix))
              .map(([key, body]) => ({ key, size: body.byteLength })),
          }),
        copyObject: ({ sourceKey, destinationKey }) => {
          const body = cosObjects.get(sourceKey);
          if (!body)
            throw Object.assign(new Error(`Missing COS object: ${sourceKey}`), {
              statusCode: 404,
            });
          cosObjects.set(destinationKey, Uint8Array.from(body));
          return Promise.resolve();
        },
        deleteObject: ({ key }) => {
          cosObjects.delete(key);
          return Promise.resolve();
        },
      }
    : undefined;

  const app = await createStudioServer({
    configurationPaths: [configPath],
    allowedWorkspaceRoot: parent,
    databasePath: join(parent, 'studio.sqlite'),
    authToken,
    cookieSecret,
    allowedOrigins: [origin],
    secureCookies: false,
    clientDirectory: client,
    releaseVerifierFactory: () => ({
      verify: () => Promise.resolve(true),
    }),
    ...(cosClient
      ? {
          publisherFactories: {
            'tencent-cos': () =>
              new TencentCosPublisher({
                client: cosClient,
                bucket: 'test-bucket-1234567890',
                region: 'ap-test',
                targetPrefix: '/',
                allowBucketRoot: true,
                statePrefix: '_blog-studio',
                retryDelay: () => Promise.resolve(),
              }),
          },
        }
      : {}),
  });
  apps.push(app);
  return {
    app,
    workspace,
    publishTarget,
    ...(cosObjects ? { cosObjects } : {}),
  };
}

async function login(app: FastifyInstance): Promise<{
  readonly cookie: string;
  readonly csrfToken: string;
}> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/session',
    headers: { origin },
    payload: { token: authToken },
  });
  expect(response.statusCode).toBe(200);
  const setCookie = response.headers['set-cookie'];
  const values = Array.isArray(setCookie) ? setCookie : [setCookie ?? ''];
  return {
    cookie: values.map((value) => value.split(';')[0]).join('; '),
    csrfToken: response.json<{ csrfToken: string }>().csrfToken,
  };
}

interface ReleaseDetails {
  readonly release: {
    readonly id: string;
    readonly status: string;
    readonly stages: Array<{ readonly status: string }>;
  };
  readonly events: Array<{ readonly stage: string }>;
}

async function waitForRelease(
  app: FastifyInstance,
  cookie: string,
  releaseId: string,
): Promise<ReleaseDetails> {
  for (let attempt = 0; attempt < 80; attempt++) {
    const response = await app.inject({
      url: `/api/workspaces/test-blog/releases/${releaseId}`,
      headers: { cookie },
    });
    const details = response.json<ReleaseDetails>();
    if (
      ['succeeded', 'failed', 'rolled-back', 'canceled'].includes(
        details.release.status,
      )
    )
      return details;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Release did not reach a terminal state: ${releaseId}`);
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe('Studio workspace API', () => {
  it('keeps health public and requires a signed session elsewhere', async () => {
    const { app } = await fixture();
    expect((await app.inject('/api/health')).statusCode).toBe(200);
    expect((await app.inject('/api/workspaces')).statusCode).toBe(401);
    const landing = await app.inject('/');
    expect(landing.body).toContain('Blog Studio');
    expect(landing.headers['cache-control']).toContain('max-age=0');
    expect(landing.headers['content-security-policy']).toContain(
      "default-src 'self'",
    );

    const rejected = await app.inject({
      method: 'POST',
      url: '/api/session',
      headers: { origin: 'https://attacker.example' },
      payload: { token: authToken },
    });
    expect(rejected.statusCode).toBe(403);
  });

  it('scans, lists, reads, and autosaves with optimistic conflicts', async () => {
    const { app } = await fixture();
    const session = await login(app);
    const getHeaders = { cookie: session.cookie };
    const mutationHeaders = {
      ...getHeaders,
      origin,
      'x-csrf-token': session.csrfToken,
    };

    const scan = await app.inject({
      method: 'POST',
      url: '/api/workspaces/test-blog/scan',
      headers: mutationHeaders,
    });
    expect(scan.json()).toMatchObject({ detection: { detected: true } });

    const listed = await app.inject({
      url: '/api/workspaces/test-blog/documents?collection=posts',
      headers: getHeaders,
    });
    const document = listed.json<{
      documents: Array<{ ref: { documentId: string } }>;
    }>().documents[0];
    if (!document) throw new Error('fixture document missing');
    const read = await app.inject({
      url: `/api/workspaces/test-blog/documents/${document.ref.documentId}?collection=posts`,
      headers: getHeaders,
    });
    const source = read.json<{ source: { revision: string } }>().source;

    const url = `/api/workspaces/test-blog/documents/${document.ref.documentId}/draft?collection=posts`;
    const payload = {
      expectedVersion: 0,
      sourceRevision: source.revision,
      frontMatter: { title: 'Hello', custom: 'keep' },
      body: 'Changed locally\n',
    };
    const saved = await app.inject({
      method: 'PUT',
      url,
      headers: mutationHeaders,
      payload,
    });
    expect(saved.json()).toMatchObject({ draft: { version: 1 } });
    const conflict = await app.inject({
      method: 'PUT',
      url,
      headers: mutationHeaders,
      payload,
    });
    expect(conflict.statusCode, conflict.body).toBe(409);
    expect(conflict.json()).toMatchObject({ code: 'REVISION_CONFLICT' });
  });

  it('creates native drafts and discards only a version-matched snapshot', async () => {
    const { app, workspace } = await fixture();
    const session = await login(app);
    const headers = {
      cookie: session.cookie,
      origin,
      'x-csrf-token': session.csrfToken,
    };
    const withoutCsrf = await app.inject({
      method: 'POST',
      url: '/api/workspaces/test-blog/documents',
      headers: { cookie: session.cookie, origin },
      payload: { title: 'New draft', slug: 'new-draft' },
    });
    expect(withoutCsrf.statusCode).toBe(403);

    const created = await app.inject({
      method: 'POST',
      url: '/api/workspaces/test-blog/documents',
      headers,
      payload: { title: 'New draft', slug: 'new-draft' },
    });
    expect(created.statusCode, created.body).toBe(201);
    const payload = created.json<{
      source: { ref: { documentId: string; path: string } };
      draft: { version: number };
    }>();
    expect(payload.source.ref.path).toBe('source/_drafts/new-draft.md');
    expect(payload.draft.version).toBe(1);
    await expect(
      readFile(join(workspace, payload.source.ref.path), 'utf8'),
    ).resolves.toContain('title: New draft');

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/workspaces/test-blog/documents',
      headers,
      payload: { title: 'Duplicate', slug: 'new-draft' },
    });
    expect(duplicate.statusCode, duplicate.body).toBe(409);
    expect(duplicate.json()).toMatchObject({ code: 'DOCUMENT_CONFLICT' });

    const discardUrl = `/api/workspaces/test-blog/documents/${payload.source.ref.documentId}/draft?collection=drafts`;
    const stale = await app.inject({
      method: 'DELETE',
      url: discardUrl,
      headers,
      payload: { expectedVersion: 2 },
    });
    expect(stale.statusCode).toBe(409);
    const discarded = await app.inject({
      method: 'DELETE',
      url: discardUrl,
      headers,
      payload: { expectedVersion: 1 },
    });
    expect(discarded.json()).toEqual({ discarded: true });
    const read = await app.inject({
      url: `/api/workspaces/test-blog/documents/${payload.source.ref.documentId}?collection=drafts`,
      headers: { cookie: session.cookie },
    });
    expect(read.json()).toMatchObject({ draft: null });
  });

  it('rejects missing CSRF and reuses a healthy preview until stopped', async () => {
    const { app, workspace } = await fixture();
    const session = await login(app);
    const headers = {
      cookie: session.cookie,
      origin,
      'x-csrf-token': session.csrfToken,
    };
    const listed = await app.inject({
      url: '/api/workspaces/test-blog/documents?collection=posts',
      headers: { cookie: session.cookie },
    });
    const documentId = listed.json<{
      documents: Array<{ ref: { documentId: string } }>;
    }>().documents[0]?.ref.documentId;
    if (!documentId) throw new Error('fixture document missing');
    const sourceResponse = await app.inject({
      url: `/api/workspaces/test-blog/documents/${documentId}?collection=posts`,
      headers: { cookie: session.cookie },
    });
    const revision = sourceResponse.json<{
      source: { revision: string };
    }>().source.revision;
    await app.inject({
      method: 'PUT',
      url: `/api/workspaces/test-blog/documents/${documentId}/draft?collection=posts`,
      headers,
      payload: {
        expectedVersion: 0,
        sourceRevision: revision,
        frontMatter: {
          title: 'Hello',
          date: '2026-08-02 10:00:00',
          custom: 'keep',
        },
        body: 'Preview draft\n',
      },
    });
    const url = `/api/workspaces/test-blog/documents/${documentId}/preview?collection=posts`;
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          headers: { cookie: session.cookie, origin },
        })
      ).statusCode,
    ).toBe(403);

    const first = await app.inject({ method: 'POST', url, headers });
    const second = await app.inject({ method: 'POST', url, headers });
    expect(first.statusCode).toBe(200);
    const firstPreview = first.json<{
      preview: { id: string; url: string };
    }>().preview;
    expect(second.json()).toMatchObject({
      preview: { id: firstPreview.id },
    });
    const content = await app.inject({
      url: firstPreview.url,
      headers: { cookie: session.cookie },
    });
    expect(content.statusCode).toBe(200);
    expect(content.body).toContain('Preview draft');
    expect(content.body).toContain(
      `/api/previews/${firstPreview.id}/content/css/site.css`,
    );
    const legacyImage = await app.inject({
      url: `/api/previews/${firstPreview.id}/content/static/reading.jpeg`,
    });
    expect(legacyImage.statusCode).toBe(200);
    expect(legacyImage.headers['content-type']).toBe('image/jpeg');
    const stylesheet = await app.inject({
      url: `/api/previews/${firstPreview.id}/content/css/site.css`,
    });
    expect(stylesheet.body).toContain(
      `/api/previews/${firstPreview.id}/content/static/reading.jpeg`,
    );
    expect(
      await readFile(join(workspace, 'source', '_posts', 'hello.md'), 'utf8'),
    ).toContain('Body');
    expect(content.headers['content-security-policy']).toContain('sandbox');
    expect(
      (await app.inject({ method: 'DELETE', url, headers })).json(),
    ).toEqual({ stopped: true });
    expect((await app.inject({ url: firstPreview.url })).statusCode).toBe(404);
    const third = await app.inject({ method: 'POST', url, headers });
    expect(third.json<{ preview: { id: string } }>().preview.id).not.toBe(
      firstPreview.id,
    );
  });

  it('processes an uploaded image into an article-scoped immutable asset', async () => {
    const { app, workspace } = await fixture();
    const session = await login(app);
    const documents = await app.inject({
      url: '/api/workspaces/test-blog/documents?collection=posts',
      headers: { cookie: session.cookie },
    });
    const documentId = documents.json<{
      documents: Array<{ ref: { documentId: string } }>;
    }>().documents[0]?.ref.documentId;
    if (!documentId) throw new Error('fixture document missing');
    const image = await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 4,
        background: { r: 220, g: 80, b: 35, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const response = await app.inject({
      method: 'POST',
      url: `/api/workspaces/test-blog/documents/${documentId}/assets?collection=posts`,
      headers: {
        cookie: session.cookie,
        origin,
        'x-csrf-token': session.csrfToken,
        'x-blog-studio-filename': encodeURIComponent('封面 Final.PNG'),
        'content-type': 'image/png',
      },
      payload: image,
    });
    expect(response.statusCode, response.body).toBe(201);
    const asset = response.json<{
      asset: { key: string; publicUrl: string; mediaType: string };
    }>().asset;
    expect(asset).toMatchObject({
      mediaType: 'image/webp',
      publicUrl: `https://blog.example.test/media/posts/${documentId}/${asset.key.split('/').at(-1)}`,
    });
    expect(asset.key).toMatch(
      new RegExp(`^media/posts/${documentId}/[a-f0-9]{64}-final\\.webp$`),
    );
    expect(await readFile(join(workspace, 'source', asset.key))).not.toEqual(
      image,
    );
  });

  it('publishes a verified release and exposes its durable timeline', async () => {
    const { app, publishTarget, workspace } = await fixture();
    const session = await login(app);
    const headers = {
      cookie: session.cookie,
      origin,
      'x-csrf-token': session.csrfToken,
    };
    const documents = await app.inject({
      url: '/api/workspaces/test-blog/documents?collection=posts',
      headers: { cookie: session.cookie },
    });
    const documentId = documents.json<{
      documents: Array<{ ref: { documentId: string } }>;
    }>().documents[0]?.ref.documentId;
    if (!documentId) throw new Error('fixture document missing');
    const sourceResponse = await app.inject({
      url: `/api/workspaces/test-blog/documents/${documentId}?collection=posts`,
      headers: { cookie: session.cookie },
    });
    const sourceRevision = sourceResponse.json<{
      source: { revision: string };
    }>().source.revision;
    const draft = await app.inject({
      method: 'PUT',
      url: `/api/workspaces/test-blog/documents/${documentId}/draft?collection=posts`,
      headers,
      payload: {
        expectedVersion: 0,
        sourceRevision,
        frontMatter: {
          title: 'Released from Studio',
          date: '2026-08-02 10:00:00',
        },
        body: 'Published draft body\n',
      },
    });
    expect(draft.statusCode, draft.body).toBe(200);
    const started = await app.inject({
      method: 'POST',
      url: '/api/workspaces/test-blog/releases',
      headers,
      payload: {
        targetId: 'production',
        draft: { collectionId: 'posts', documentId, version: 1 },
      },
    });
    expect(started.statusCode, started.body).toBe(202);
    const releaseId = started.json<{ release: { id: string } }>().release.id;

    const details = await waitForRelease(app, session.cookie, releaseId);
    expect(details.release.status).toBe('succeeded');
    expect(
      details.release.stages.every((stage) => stage.status === 'succeeded'),
    ).toBe(true);
    expect(
      details.events.some((event) => event.stage === 'uploading-pages'),
    ).toBe(true);

    const listed = await app.inject({
      url: '/api/workspaces/test-blog/releases',
      headers: { cookie: session.cookie },
    });
    expect(listed.json<{ releases: unknown[] }>().releases).toHaveLength(1);
    expect(
      await readFile(
        join(publishTarget, '2026', '08', '02', 'hello', 'index.html'),
        'utf8',
      ),
    ).toContain('Published draft body');
    expect(
      await readFile(join(workspace, 'source', '_posts', 'hello.md'), 'utf8'),
    ).toContain('Published draft body');
    const sourceAfter = await app.inject({
      url: `/api/workspaces/test-blog/documents/${documentId}?collection=posts`,
      headers: { cookie: session.cookie },
    });
    const sourceAfterPayload = sourceAfter.json<{
      source: { revision: string };
      draft: unknown;
    }>();
    expect(sourceAfterPayload.draft).toBeNull();

    const secondDraft = await app.inject({
      method: 'PUT',
      url: `/api/workspaces/test-blog/documents/${documentId}/draft?collection=posts`,
      headers,
      payload: {
        expectedVersion: 0,
        sourceRevision: sourceAfterPayload.source.revision,
        frontMatter: { title: 'Second release', date: '2026-08-02 10:00:00' },
        body: 'Second release body\n',
      },
    });
    expect(secondDraft.statusCode, secondDraft.body).toBe(200);
    const secondStarted = await app.inject({
      method: 'POST',
      url: '/api/workspaces/test-blog/releases',
      headers,
      payload: {
        targetId: 'production',
        draft: { collectionId: 'posts', documentId, version: 1 },
      },
    });
    expect(secondStarted.statusCode, secondStarted.body).toBe(202);
    const secondReleaseId = secondStarted.json<ReleaseDetails>().release.id;
    expect(
      (await waitForRelease(app, session.cookie, secondReleaseId)).release
        .status,
    ).toBe('succeeded');
    expect(
      await readFile(
        join(publishTarget, '2026', '08', '02', 'hello', 'index.html'),
        'utf8',
      ),
    ).toContain('Second release body');

    const rollback = await app.inject({
      method: 'POST',
      url: `/api/workspaces/test-blog/releases/${secondReleaseId}/rollback`,
      headers,
      payload: {},
    });
    expect(rollback.statusCode, rollback.body).toBe(202);
    expect(
      (await waitForRelease(app, session.cookie, secondReleaseId)).release
        .status,
    ).toBe('rolled-back');
    expect(
      await readFile(
        join(publishTarget, '2026', '08', '02', 'hello', 'index.html'),
        'utf8',
      ),
    ).toContain('Published draft body');
  });

  it('promotes exactly one native draft only after a verified release', async () => {
    const { app, workspace } = await fixture();
    const session = await login(app);
    const headers = {
      cookie: session.cookie,
      origin,
      'x-csrf-token': session.csrfToken,
    };
    const created = await app.inject({
      method: 'POST',
      url: '/api/workspaces/test-blog/documents',
      headers,
      payload: { title: 'Native release', slug: 'native-release' },
    });
    const createdPayload = created.json<{
      source: {
        revision: string;
        frontMatter: Record<string, unknown>;
        ref: { documentId: string };
      };
      draft: { version: number };
    }>();
    const documentId = createdPayload.source.ref.documentId;
    const saved = await app.inject({
      method: 'PUT',
      url: `/api/workspaces/test-blog/documents/${documentId}/draft?collection=drafts`,
      headers,
      payload: {
        expectedVersion: 1,
        sourceRevision: createdPayload.source.revision,
        frontMatter: createdPayload.source.frontMatter,
        body: 'Native draft body\n',
      },
    });
    expect(saved.json()).toMatchObject({ draft: { version: 2 } });
    const started = await app.inject({
      method: 'POST',
      url: '/api/workspaces/test-blog/releases',
      headers,
      payload: {
        targetId: 'production',
        draft: { collectionId: 'drafts', documentId, version: 2 },
      },
    });
    const releaseId = started.json<ReleaseDetails>().release.id;
    expect(
      (await waitForRelease(app, session.cookie, releaseId)).release.status,
    ).toBe('succeeded');
    await expect(
      readFile(
        join(workspace, 'source', '_posts', 'native-release.md'),
        'utf8',
      ),
    ).resolves.toContain('Native draft body');
    await expect(
      readFile(
        join(workspace, 'source', '_drafts', 'native-release.md'),
        'utf8',
      ),
    ).rejects.toThrow();
  });

  it('keeps canonical source and acknowledged draft when an isolated build fails', async () => {
    const { app, workspace } = await fixture();
    const session = await login(app);
    const headers = {
      cookie: session.cookie,
      origin,
      'x-csrf-token': session.csrfToken,
    };
    const documents = await app.inject({
      url: '/api/workspaces/test-blog/documents?collection=posts',
      headers: { cookie: session.cookie },
    });
    const documentId = documents.json<{
      documents: Array<{ ref: { documentId: string } }>;
    }>().documents[0]!.ref.documentId;
    const source = await app.inject({
      url: `/api/workspaces/test-blog/documents/${documentId}?collection=posts`,
      headers: { cookie: session.cookie },
    });
    const sourcePayload = source.json<{
      source: {
        revision: string;
        frontMatter: Record<string, unknown>;
      };
    }>().source;
    await app.inject({
      method: 'PUT',
      url: `/api/workspaces/test-blog/documents/${documentId}/draft?collection=posts`,
      headers,
      payload: {
        expectedVersion: 0,
        sourceRevision: sourcePayload.revision,
        frontMatter: sourcePayload.frontMatter,
        body: 'Must survive failed build\n',
      },
    });
    await writeFile(
      join(workspace, 'node_modules', '.bin', 'hexo'),
      '#!/usr/bin/env node\nprocess.exit(7);\n',
    );
    await chmod(join(workspace, 'node_modules', '.bin', 'hexo'), 0o755);
    const started = await app.inject({
      method: 'POST',
      url: '/api/workspaces/test-blog/releases',
      headers,
      payload: {
        targetId: 'production',
        draft: { collectionId: 'posts', documentId, version: 1 },
      },
    });
    const releaseId = started.json<ReleaseDetails>().release.id;
    expect(
      (await waitForRelease(app, session.cookie, releaseId)).release.status,
    ).toBe('failed');
    expect(
      await readFile(join(workspace, 'source', '_posts', 'hello.md'), 'utf8'),
    ).toContain('Body');
    const after = await app.inject({
      url: `/api/workspaces/test-blog/documents/${documentId}?collection=posts`,
      headers: { cookie: session.cookie },
    });
    expect(after.json()).toMatchObject({
      draft: { version: 1, body: 'Must survive failed build\n' },
    });
  });

  it('requires and safely adopts a populated COS baseline before publishing', async () => {
    const legacyBytes = Buffer.from('legacy production homepage');
    const existingCosObjects = new Map<string, Uint8Array>([
      ['index.html', legacyBytes],
      ['static/legacy.png', Uint8Array.from([1, 2, 3, 4])],
    ]);
    const { app, cosObjects } = await fixture({ existingCosObjects });
    if (!cosObjects) throw new Error('COS fixture was not created');
    const session = await login(app);
    const getHeaders = { cookie: session.cookie };
    const mutationHeaders = {
      ...getHeaders,
      origin,
      'x-csrf-token': session.csrfToken,
    };

    const before = await app.inject({
      url: '/api/workspaces',
      headers: getHeaders,
    });
    expect(before.json()).toMatchObject({
      workspaces: [
        { publishTarget: { baselineAdoption: 'required', configured: true } },
      ],
    });
    const blocked = await app.inject({
      method: 'POST',
      url: '/api/workspaces/test-blog/releases',
      headers: mutationHeaders,
      payload: { targetId: 'production' },
    });
    expect(blocked.statusCode, blocked.body).toBe(409);

    const invalidConfirmation = await app.inject({
      method: 'POST',
      url: '/api/workspaces/test-blog/releases/adopt-baseline',
      headers: mutationHeaders,
      payload: { confirmation: 'yes' },
    });
    expect(invalidConfirmation.statusCode).toBe(400);

    const started = await app.inject({
      method: 'POST',
      url: '/api/workspaces/test-blog/releases/adopt-baseline',
      headers: mutationHeaders,
      payload: { confirmation: 'ADOPT EXISTING DEPLOYMENT' },
    });
    expect(started.statusCode, started.body).toBe(202);
    const releaseId = started.json<ReleaseDetails>().release.id;
    expect(
      (await waitForRelease(app, session.cookie, releaseId)).release.status,
    ).toBe('succeeded');

    expect(Buffer.from(cosObjects.get('index.html') ?? [])).toEqual(
      legacyBytes,
    );
    expect(cosObjects.get('static/legacy.png')).toEqual(
      Uint8Array.from([1, 2, 3, 4]),
    );
    expect(cosObjects.has('blog-studio-release.json')).toBe(true);
    expect(
      [...cosObjects.keys()].some((key) =>
        key.startsWith(`_blog-studio/releases/${releaseId}/`),
      ),
    ).toBe(true);

    const after = await app.inject({
      url: '/api/workspaces',
      headers: getHeaders,
    });
    expect(after.json()).toMatchObject({
      workspaces: [
        { publishTarget: { baselineAdoption: 'complete', configured: true } },
      ],
    });
    const repeated = await app.inject({
      method: 'POST',
      url: '/api/workspaces/test-blog/releases/adopt-baseline',
      headers: mutationHeaders,
      payload: { confirmation: 'ADOPT EXISTING DEPLOYMENT' },
    });
    expect(repeated.statusCode, repeated.body).toBe(409);
  });
});
