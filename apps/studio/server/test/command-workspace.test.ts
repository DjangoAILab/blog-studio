import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { createStudioServer } from '../app.js';

const origin = 'https://command-studio.example.test';
const authToken = 'command-test-auth-token';
const cookieSecret =
  'command-test-cookie-secret-at-least-thirty-two-characters';
const apps: FastifyInstance[] = [];

async function commandFixture(options?: {
  readonly extraGeneratorOption?: string;
}): Promise<{ readonly app: FastifyInstance; readonly workspace: string }> {
  const parent = await mkdtemp(join(tmpdir(), 'blog-studio-command-app-'));
  const workspace = join(parent, 'workspace');
  const client = join(parent, 'client');
  await mkdir(join(workspace, 'content', 'posts'), { recursive: true });
  await mkdir(join(workspace, 'content', 'drafts'), { recursive: true });
  await mkdir(join(workspace, 'static'), { recursive: true });
  await mkdir(join(workspace, 'scripts'), { recursive: true });
  await mkdir(client);
  await writeFile(join(client, 'index.html'), '<h1>Blog Studio</h1>');
  await writeFile(join(workspace, '.blog-studio-example'), 'v1\n');
  await writeFile(
    join(workspace, 'content', 'posts', 'welcome.md'),
    '---\ntitle: Welcome\npermalink: notes/welcome/\n---\nOriginal body\n',
  );
  await writeFile(
    join(workspace, 'scripts', 'build.mjs'),
    `import { mkdir, readFile, writeFile } from 'node:fs/promises';
const markdown = await readFile('content/posts/welcome.md', 'utf8');
const body = markdown.split('---\\n').slice(2).join('---\\n');
await mkdir('public/notes/welcome', { recursive: true });
await writeFile('public/index.html', '<a href="/notes/welcome/">Welcome</a>');
await writeFile('public/notes/welcome/index.html', '<main>' + body + '</main>');
`,
  );
  const config = join(parent, 'blog-studio.yml');
  await writeFile(
    config,
    `version: 1
workspace:
  id: command-blog
  root: ${workspace}
generator:
  adapter: command
  options:
    displayName: Example command site
    markers: [.blog-studio-example]
    outputDirectory: public
    siteUrl: https://command-blog.example.test/
    build:
      command: ${process.execPath}
      args: [scripts/build.mjs]
      timeoutMs: 30000
    ${options?.extraGeneratorOption ?? ''}
repository:
  adapter: local-git
assets:
  adapter: filesystem
  options:
    rootDirectory: static
    managedPrefix: media/posts
    protectedPrefixes: [legacy]
    publicBaseUrl: https://command-blog.example.test/static/
publish:
  adapter: none
content:
  collections:
    posts:
      path: content/posts
      draftPath: content/drafts
`,
  );
  const app = await createStudioServer({
    configurationPaths: [config],
    allowedWorkspaceRoot: parent,
    databasePath: join(parent, 'studio.sqlite'),
    authenticationMode: 'password',
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

describe('production command workspace wiring', () => {
  it('opens, autosaves, and previews a non-Hexo workspace safely', async () => {
    const { app } = await commandFixture();
    const session = await login(app);
    const headers = { cookie: session.cookie };
    const mutationHeaders = {
      ...headers,
      origin,
      'x-csrf-token': session.csrfToken,
    };

    const workspaces = await app.inject({ url: '/api/workspaces', headers });
    expect(workspaces.json()).toMatchObject({
      workspaces: [
        {
          id: 'command-blog',
          generator: 'command',
          canCreateDocuments: false,
          publishTarget: { adapter: 'none', configured: false },
        },
      ],
    });
    expect(workspaces.body).not.toContain(process.execPath);
    expect(workspaces.body).not.toContain('scripts/build.mjs');

    const scan = await app.inject({
      method: 'POST',
      url: '/api/workspaces/command-blog/scan',
      headers: mutationHeaders,
    });
    expect(scan.statusCode).toBe(200);
    expect(scan.json()).toMatchObject({
      detection: { detected: true, confidence: 1 },
      model: {
        collections: [
          { id: 'posts', canCreate: false, canDelete: false },
          { id: 'drafts', canCreate: false, canDelete: false },
        ],
      },
    });

    const documents = await app.inject({
      url: '/api/workspaces/command-blog/documents?collection=posts',
      headers,
    });
    expect(documents.statusCode).toBe(200);
    const [document] = documents.json<{
      documents: Array<{
        ref: { documentId: string };
        title: string;
      }>;
    }>().documents;
    expect(document?.title).toBe('Welcome');
    if (!document) throw new Error('command document missing');

    const sourceResponse = await app.inject({
      url: `/api/workspaces/command-blog/documents/${document.ref.documentId}?collection=posts`,
      headers,
    });
    const source = sourceResponse.json<{
      source: {
        revision: string;
        frontMatter: Record<string, unknown>;
      };
    }>().source;
    const saved = await app.inject({
      method: 'PUT',
      url: `/api/workspaces/command-blog/documents/${document.ref.documentId}/draft?collection=posts`,
      headers: mutationHeaders,
      payload: {
        expectedVersion: 0,
        sourceRevision: source.revision,
        frontMatter: source.frontMatter,
        body: 'Previewed generic body\n',
      },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ draft: { version: 1 } });

    const previewResponse = await app.inject({
      method: 'POST',
      url: `/api/workspaces/command-blog/documents/${document.ref.documentId}/preview?collection=posts`,
      headers: mutationHeaders,
    });
    expect(previewResponse.statusCode).toBe(200);
    const previewUrl = previewResponse.json<{ preview: { url: string } }>()
      .preview.url;
    const preview = await app.inject({ url: previewUrl, headers });
    expect(preview.statusCode).toBe(200);
    expect(preview.body).toContain('Previewed generic body');
  });

  it('keeps unknown command options fail-closed in degraded setup mode', async () => {
    const { app } = await commandFixture({
      extraGeneratorOption: 'unexpected: true',
    });
    expect((await app.inject('/api/health')).statusCode).toBe(503);
    expect((await app.inject('/api/setup/status')).json()).toMatchObject({
      ready: false,
      configuration: {
        state: 'invalid',
        nextAction: 'repair-configuration',
      },
      site: { state: 'unavailable' },
    });
    const session = await login(app);
    const workspaces = await app.inject({
      url: '/api/workspaces',
      headers: { cookie: session.cookie },
    });
    expect(workspaces.statusCode).toBe(503);
    expect(workspaces.body).not.toContain('unexpected');
  });
});
