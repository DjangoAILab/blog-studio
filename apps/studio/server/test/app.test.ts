import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { createStudioServer } from '../app.js';

const origin = 'https://studio.example.test';
const authToken = 'test-auth-token-at-least-sixteen';
const cookieSecret = 'test-cookie-secret-with-at-least-thirty-two-characters';
const apps: FastifyInstance[] = [];

async function fixture(): Promise<{
  readonly app: FastifyInstance;
  readonly workspace: string;
}> {
  const parent = await mkdtemp(join(tmpdir(), 'blog-studio-api-'));
  const workspace = join(parent, 'site');
  const client = join(parent, 'client');
  await mkdir(join(workspace, 'source', '_posts'), { recursive: true });
  await mkdir(join(workspace, 'source', '_drafts'), { recursive: true });
  await mkdir(join(workspace, 'node_modules', '.bin'), { recursive: true });
  await mkdir(client);
  await writeFile(join(client, 'index.html'), '<h1>Blog Studio</h1>');
  await writeFile(
    join(workspace, '_config.yml'),
    'url: https://blog.example.test\npermalink: :year/:month/:day/:title/\n',
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
    "#!/usr/bin/env node\nconst{mkdir,readFile,writeFile}=await import('node:fs/promises');const body=await readFile('source/_posts/hello.md','utf8');await mkdir('public/2026/08/02/hello',{recursive:true});await mkdir('public/css',{recursive:true});await writeFile('public/index.html','preview');await writeFile('public/css/site.css','body{background:url(/images/paper.png)}');await writeFile('public/2026/08/02/hello/index.html','<link href=\"/css/site.css\">'+body);\n",
  );
  await chmod(fakeHexo, 0o755);
  const configPath = join(parent, 'blog-studio.yml');
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
publish:
  adapter: filesystem
verification:
  baseUrl: https://blog.example.test
`,
  );

  const app = await createStudioServer({
    configurationPaths: [configPath],
    allowedWorkspaceRoot: parent,
    databasePath: join(parent, 'studio.sqlite'),
    authToken,
    cookieSecret,
    allowedOrigins: [origin],
    secureCookies: false,
    clientDirectory: client,
  });
  apps.push(app);
  return { app, workspace };
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
    const stylesheet = await app.inject({
      url: `/api/previews/${firstPreview.id}/content/css/site.css`,
    });
    expect(stylesheet.body).toContain(
      `/api/previews/${firstPreview.id}/content/images/paper.png`,
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
});
