import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';
import {
  openStudioDatabase,
  SqliteOwnerCredentialRepository,
  SqliteOwnerSessionRepository,
} from '@blog-studio/persistence';
import {
  TencentCosPublisher,
  type CosPublisherClient,
} from '@blog-studio/publisher-cos';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';

import { createStudioServer, type StudioServerOptions } from '../app.js';
import { OwnerAuthService } from '../auth/owner-auth.js';

const origin = 'https://studio.example.test';
const authToken = 'test-auth-token-at-least-sixteen';
const cookieSecret = 'test-cookie-secret-with-at-least-thirty-two-characters';
const apps: FastifyInstance[] = [];

interface FixtureOptions {
  readonly existingCosObjects?: Map<string, Uint8Array>;
  readonly ownerPassword?: string;
  readonly omitLegacyAuthToken?: boolean;
  readonly secondWorkspace?: boolean;
  readonly previewFailure?: 'build-error' | 'missing-output' | 'route-error';
  readonly logger?: StudioServerOptions['logger'];
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
    [
      '#!/usr/bin/env node',
      "const{mkdir,readdir,readFile,writeFile}=await import('node:fs/promises');",
      ...(options.previewFailure === 'build-error'
        ? ["throw new Error('fixture preview build failed');"]
        : []),
      "await mkdir('public/css',{recursive:true});",
      "await writeFile('public/index.html','preview');",
      "await writeFile('public/css/site.css','body{background:url(../../static/reading.jpeg)}');",
      ...(options.previewFailure === 'missing-output'
        ? []
        : [
            "for(const name of await readdir('source/_posts')){",
            "if(!name.endsWith('.md'))continue;",
            "const body=await readFile('source/_posts/'+name,'utf8');",
            'const date=body.match(/date:\\s*[\\"\']?(\\d{4})-(\\d{2})-(\\d{2})/);',
            "if(!date)throw new Error('missing fixture date: '+name);",
            'const slug=name.slice(0,-3);',
            "const directory='public/'+date[1]+'/'+date[2]+'/'+date[3]+'/'+slug;",
            'await mkdir(directory,{recursive:true});',
            options.previewFailure === 'route-error'
              ? "await writeFile(directory+'/index.html','rendered without marker');"
              : 'await writeFile(directory+\'/index.html\',\'<link href="/css/site.css"><img src="../../../../static/reading.jpeg">\'+body);',
            '}',
          ]),
      '',
    ].join('\n'),
  );
  await chmod(fakeHexo, 0o755);
  const configPath = join(parent, 'blog-studio.yml');
  const usesCosBaseline = options.existingCosObjects !== undefined;
  const configuration = `version: 1
workspace:
  id: test-blog
  root: ${workspace}
generator:
  adapter: hexo
  options:
    config: _config.yml
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
    allowBaselineAdoption: true
    protectedPrefixes: [static]`
        : `directory: ${publishTarget}`
    }
verification:
  baseUrl: https://blog.example.test
`;
  await writeFile(configPath, configuration);
  const configurationPaths = [configPath];
  if (options.secondWorkspace) {
    const secondConfigPath = join(parent, 'blog-studio-second.yml');
    await writeFile(
      secondConfigPath,
      configuration.replace('id: test-blog', 'id: second-blog'),
    );
    configurationPaths.push(secondConfigPath);
  }

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

  const databasePath = join(parent, 'studio.sqlite');
  if (options.ownerPassword) {
    const database = openStudioDatabase(databasePath);
    await new OwnerAuthService(
      new SqliteOwnerCredentialRepository(database),
      new SqliteOwnerSessionRepository(database),
    ).initialize(options.ownerPassword);
    database.close();
  }
  const app = await createStudioServer({
    configurationPaths,
    allowedWorkspaceRoot: parent,
    databasePath,
    ...(options.omitLegacyAuthToken ? {} : { authToken }),
    cookieSecret,
    allowedOrigins: [origin],
    secureCookies: false,
    clientDirectory: client,
    ...(options.logger ? { logger: options.logger } : {}),
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
                protectedPrefixes: ['static'],
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

function cookies(
  response: Awaited<ReturnType<FastifyInstance['inject']>>,
): string {
  const setCookie = response.headers['set-cookie'];
  const values = Array.isArray(setCookie) ? setCookie : [setCookie ?? ''];
  return values.map((value) => value.split(';')[0]).join('; ');
}

async function loginWithPassword(
  app: FastifyInstance,
  password: string,
): Promise<{ readonly cookie: string; readonly csrfToken: string }> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/session',
    headers: { origin },
    payload: { password },
  });
  expect(response.statusCode, response.body).toBe(200);
  return {
    cookie: cookies(response),
    csrfToken: response.json<{ csrfToken: string }>().csrfToken,
  };
}

interface ReleaseDetails {
  readonly release: {
    readonly id: string;
    readonly status: string;
    readonly createdAt: string;
    readonly stages: Array<{ readonly status: string }>;
  };
  readonly events: Array<{ readonly stage: string; readonly message: string }>;
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
  it('reports uninitialized owner state without allowing browser ownership claim', async () => {
    const { app } = await fixture({ omitLegacyAuthToken: true });
    expect((await app.inject('/api/auth/status')).json()).toEqual({
      initialized: false,
    });
    const attemptedClaim = await app.inject({
      method: 'POST',
      url: '/api/session',
      headers: { origin },
      payload: { password: 'browser selected password' },
    });
    expect(attemptedClaim.statusCode).toBe(503);
    expect(attemptedClaim.json()).toMatchObject({
      code: 'OWNER_NOT_INITIALIZED',
    });
    expect((await app.inject('/api/auth/status')).json()).toEqual({
      initialized: false,
    });
  });

  it('redacts credential, session, cookie, CSRF, and authorization log fields', async () => {
    const lines: string[] = [];
    const secrets = {
      authorization: 'Bearer authorization-secret',
      cookie: 'cookie-secret',
      csrf: 'csrf-secret',
      password: 'password-secret',
      currentPassword: 'current-password-secret',
      newPassword: 'new-password-secret',
      token: 'legacy-token-secret',
      verifier: 'stored-verifier-secret',
      sessionToken: 'session-token-secret',
    };
    const { app } = await fixture({
      logger: {
        level: 'info',
        stream: { write: (line: string) => lines.push(line) },
      },
    });
    app.log.info(
      {
        req: {
          headers: {
            authorization: secrets.authorization,
            cookie: secrets.cookie,
            'x-csrf-token': secrets.csrf,
          },
          body: {
            password: secrets.password,
            currentPassword: secrets.currentPassword,
            newPassword: secrets.newPassword,
            token: secrets.token,
          },
        },
        body: secrets,
        res: { headers: { 'set-cookie': 'response-cookie-secret' } },
      },
      'credential redaction probe',
    );
    const output = lines.join('\n');
    for (const secret of [
      ...Object.values(secrets),
      'response-cookie-secret',
    ]) {
      expect(output).not.toContain(secret);
    }
    expect(output).toContain('[REDACTED]');
  });

  it('disables the legacy token after CLI-equivalent password initialization', async () => {
    const ownerPassword = 'owner initialized passphrase';
    const { app } = await fixture({ ownerPassword });
    expect((await app.inject('/api/auth/status')).json()).toEqual({
      initialized: true,
      generation: 1,
    });
    const legacy = await app.inject({
      method: 'POST',
      url: '/api/session',
      headers: { origin },
      payload: { token: authToken },
    });
    expect(legacy.statusCode).toBe(401);
    const session = await loginWithPassword(app, ownerPassword);
    expect(
      (
        await app.inject({
          url: '/api/workspaces',
          headers: { cookie: session.cookie },
        })
      ).statusCode,
    ).toBe(200);
  });

  it('rate limits repeated owner password failures', async () => {
    const { app } = await fixture({
      ownerPassword: 'owner rate limit passphrase',
    });
    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/session',
        headers: { origin },
        payload: { password: 'incorrect owner passphrase' },
      });
      expect(response.statusCode).toBe(401);
    }
    const limited = await app.inject({
      method: 'POST',
      url: '/api/session',
      headers: { origin },
      payload: { password: 'owner rate limit passphrase' },
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
  });

  it('changes the owner password and revokes every prior browser session', async () => {
    const initialPassword = 'initial browser passphrase';
    const replacementPassword = 'replacement browser passphrase';
    const { app } = await fixture({ ownerPassword: initialPassword });
    const first = await loginWithPassword(app, initialPassword);
    const second = await loginWithPassword(app, initialPassword);
    const changed = await app.inject({
      method: 'PATCH',
      url: '/api/auth/password',
      headers: {
        cookie: first.cookie,
        origin,
        'x-csrf-token': first.csrfToken,
      },
      payload: {
        currentPassword: initialPassword,
        newPassword: replacementPassword,
      },
    });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(changed.json()).toMatchObject({
      changed: true,
      credentialGeneration: 2,
    });
    const replacementCookie = cookies(changed);
    for (const old of [first.cookie, second.cookie]) {
      expect(
        (
          await app.inject({
            url: '/api/workspaces',
            headers: { cookie: old },
          })
        ).statusCode,
      ).toBe(401);
    }
    expect(
      (
        await app.inject({
          url: '/api/workspaces',
          headers: { cookie: replacementCookie },
        })
      ).statusCode,
    ).toBe(200);
    const oldLogin = await app.inject({
      method: 'POST',
      url: '/api/session',
      headers: { origin },
      payload: { password: initialPassword },
    });
    expect(oldLogin.statusCode).toBe(401);
    await expect(
      loginWithPassword(app, replacementPassword),
    ).resolves.toBeDefined();
  });

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

  it('discovers and confirms a v0.1 workspace as a user-facing Site', async () => {
    const { app, workspace } = await fixture();
    const session = await login(app);
    const headers = {
      cookie: session.cookie,
      origin,
      'x-csrf-token': session.csrfToken,
    };
    expect((await app.inject({ url: '/api/sites', headers })).json()).toEqual({
      sites: [],
    });
    const discovery = await app.inject({
      url: '/api/sites/discover',
      headers,
    });
    expect(discovery.statusCode, discovery.body).toBe(200);
    const candidate = discovery.json<{
      candidates: Array<{
        candidateId: string;
        proposedDisplayName: string;
        canonicalUrl: string;
        contentCounts: Record<string, number>;
        advanced: { workspaceRoot: string; configurationPath: string };
      }>;
    }>().candidates[0];
    expect(candidate).toMatchObject({
      candidateId: 'test-blog',
      proposedDisplayName: 'test-blog',
      canonicalUrl: 'https://blog.example.test/',
      contentCounts: { posts: 1, drafts: 0 },
      advanced: { workspaceRoot: workspace },
    });
    expect(candidate?.advanced.configurationPath).toMatch(/blog-studio\.yml$/);

    const registered = await app.inject({
      method: 'POST',
      url: '/api/sites',
      headers,
      payload: {
        candidateId: 'test-blog',
        displayName: '测试博客',
        canonicalUrl: 'https://blog.example.test',
      },
    });
    expect(registered.statusCode, registered.body).toBe(201);
    const site = registered.json<{
      site: {
        id: string;
        displayName: string;
        canonicalUrl: string;
        updatedAt: string;
        workspaceId?: string;
      };
    }>().site;
    expect(site).toMatchObject({
      displayName: '测试博客',
      canonicalUrl: 'https://blog.example.test/',
    });
    expect(site.id).toMatch(/^site-[a-f0-9-]+$/);
    expect(site.workspaceId).toBeUndefined();
    expect(
      (await app.inject({ url: '/api/sites/discover', headers })).json(),
    ).toEqual({ candidates: [] });

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/sites/${site.id}`,
      headers,
      payload: {
        expectedUpdatedAt: site.updatedAt,
        displayName: '测试博客 Studio',
        canonicalUrl: 'https://writing.example.test',
      },
    });
    expect(updated.statusCode, updated.body).toBe(200);
    expect(updated.json()).toMatchObject({
      site: {
        displayName: '测试博客 Studio',
        canonicalUrl: 'https://writing.example.test/',
      },
    });
    const stale = await app.inject({
      method: 'PATCH',
      url: `/api/sites/${site.id}`,
      headers,
      payload: {
        expectedUpdatedAt: site.updatedAt,
        displayName: '陈旧设置',
      },
    });
    expect(stale.statusCode).toBe(409);
    expect(
      await readFile(join(workspace, '..', 'blog-studio.yml'), 'utf8'),
    ).not.toContain('测试博客 Studio');
  });

  it('rejects duplicate Site identity and unsupported canonical URLs', async () => {
    const { app } = await fixture({ secondWorkspace: true });
    const session = await login(app);
    const headers = {
      cookie: session.cookie,
      origin,
      'x-csrf-token': session.csrfToken,
    };
    const first = await app.inject({
      method: 'POST',
      url: '/api/sites',
      headers,
      payload: {
        candidateId: 'test-blog',
        displayName: 'Same Site',
      },
    });
    expect(first.statusCode, first.body).toBe(201);

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/sites',
      headers,
      payload: {
        candidateId: 'second-blog',
        displayName: 'same site',
      },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({
      title: 'A Site already exists with the same displayName',
    });

    const unsupportedUrl = await app.inject({
      method: 'PATCH',
      url: `/api/sites/${first.json<{ site: { id: string } }>().site.id}`,
      headers,
      payload: {
        expectedUpdatedAt: first.json<{ site: { updatedAt: string } }>().site
          .updatedAt,
        displayName: 'Same Site',
        canonicalUrl: 'ftp://blog.example.test',
      },
    });
    expect(unsupportedUrl.statusCode).toBe(422);
    expect(unsupportedUrl.json()).toMatchObject({
      title: 'Site canonical URL must use HTTP or HTTPS',
    });
  });

  it('queries published, draft, and modified content through the Site contract', async () => {
    const { app, workspace } = await fixture();
    const session = await login(app);
    const headers = {
      cookie: session.cookie,
      origin,
      'x-csrf-token': session.csrfToken,
    };
    const registered = await app.inject({
      method: 'POST',
      url: '/api/sites',
      headers,
      payload: { candidateId: 'test-blog', displayName: 'Content Site' },
    });
    const siteId = registered.json<{ site: { id: string } }>().site.id;
    const initial = await app.inject({
      url: `/api/sites/${siteId}/content`,
      headers,
    });
    expect(initial.statusCode, initial.body).toBe(200);
    const initialContent = initial.json<{
      content: {
        items: Array<{
          documentId: string;
          collectionId: string;
          state: string;
          path: string;
        }>;
        counts: Record<string, number>;
      };
    }>().content;
    expect(initialContent).toMatchObject({
      counts: { all: 1, published: 1, draft: 0, modified: 0 },
      items: [{ state: 'published', collectionId: 'posts' }],
    });
    expect(JSON.stringify(initialContent)).not.toContain('Body');
    const published = initialContent.items[0];
    if (!published) throw new Error('fixture post missing');

    const opened = await app.inject({
      url: `/api/sites/${siteId}/content/${published.documentId}?collection=posts`,
      headers,
    });
    const source = opened.json<{
      source: {
        revision: string;
        frontMatter: Record<string, unknown>;
        body: string;
      };
    }>().source;
    const workingCopyUrl = `/api/sites/${siteId}/content/${published.documentId}/working-copy?collection=posts`;
    const saved = await app.inject({
      method: 'PUT',
      url: workingCopyUrl,
      headers,
      payload: {
        expectedVersion: 0,
        sourceRevision: source.revision,
        frontMatter: {
          ...source.frontMatter,
          title: 'Edited Hello',
          tags: ['Release', '中文'],
        },
        body: 'SQLite working copy only\n',
      },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toMatchObject({ draft: { version: 1 } });
    expect(
      await readFile(join(workspace, 'source', '_posts', 'hello.md'), 'utf8'),
    ).toContain('Body');

    const nativeDraft = await app.inject({
      method: 'POST',
      url: '/api/workspaces/test-blog/documents',
      headers,
      payload: { title: 'Native idea', slug: 'native-idea' },
    });
    expect(nativeDraft.statusCode, nativeDraft.body).toBe(201);

    const merged = await app.inject({
      url: `/api/sites/${siteId}/content?page=1&pageSize=1`,
      headers,
    });
    expect(merged.statusCode, merged.body).toBe(200);
    expect(merged.json()).toMatchObject({
      content: {
        page: 1,
        pageSize: 1,
        total: 2,
        counts: { all: 2, published: 0, draft: 1, modified: 1 },
        items: [{ title: 'Native idea', state: 'draft' }],
      },
    });
    const filtered = await app.inject({
      url: `/api/sites/${siteId}/content?state=modified&tag=release&search=edited&pageSize=10`,
      headers,
    });
    expect(filtered.json()).toMatchObject({
      content: {
        total: 1,
        items: [
          {
            documentId: published.documentId,
            title: 'Edited Hello',
            state: 'modified',
            sourceState: 'published',
            tags: ['Release', '中文'],
            workingCopy: { version: 1, stale: false },
          },
        ],
      },
    });
    expect(
      (
        await app.inject({
          url: `/api/sites/${siteId}/content?search=source%2F_posts&collection=posts`,
          headers,
        })
      ).json(),
    ).toMatchObject({
      content: {
        total: 1,
        items: [{ documentId: published.documentId, state: 'modified' }],
      },
    });
    expect(
      (
        await app.inject({
          url: `/api/sites/${siteId}/content?collection=drafts`,
          headers,
        })
      ).json(),
    ).toMatchObject({ content: { total: 1, items: [{ state: 'draft' }] } });
    expect(
      (
        await app.inject({
          url: `/api/sites/${siteId}/content?to=2000-01-01T00%3A00%3A00.000Z`,
          headers,
        })
      ).json(),
    ).toMatchObject({ content: { total: 0 } });

    await writeFile(
      join(workspace, 'source', '_posts', 'hello.md'),
      '---\ntitle: Canonical changed\ndate: 2026-08-02 10:00:00\n---\nChanged elsewhere\n',
    );
    const staleList = await app.inject({
      url: `/api/sites/${siteId}/content?state=modified`,
      headers,
    });
    expect(staleList.json()).toMatchObject({
      content: { items: [{ workingCopy: { version: 1, stale: true } }] },
    });
    const staleSave = await app.inject({
      method: 'PUT',
      url: workingCopyUrl,
      headers,
      payload: {
        expectedVersion: 1,
        sourceRevision: source.revision,
        frontMatter: { title: 'Must not overwrite' },
        body: 'stale',
      },
    });
    expect(staleSave.statusCode).toBe(409);
    expect(staleSave.json()).toMatchObject({ code: 'DOCUMENT_CONFLICT' });

    const staleDiscard = await app.inject({
      method: 'DELETE',
      url: workingCopyUrl,
      headers,
      payload: { expectedVersion: 2 },
    });
    expect(staleDiscard.statusCode).toBe(409);
    const discarded = await app.inject({
      method: 'DELETE',
      url: workingCopyUrl,
      headers,
      payload: { expectedVersion: 1 },
    });
    expect(discarded.statusCode, discarded.body).toBe(200);
  });

  it('scans, lists, reads, and autosaves with optimistic conflicts', async () => {
    const { app, workspace } = await fixture();
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
    await writeFile(
      join(workspace, 'source', '_posts', 'hello.md'),
      '---\ntitle: Changed outside Studio\ndate: 2026-08-02 10:00:00\n---\nExternal change\n',
    );
    const sourceConflict = await app.inject({
      method: 'PUT',
      url,
      headers: mutationHeaders,
      payload: { ...payload, expectedVersion: 1 },
    });
    expect(sourceConflict.statusCode, sourceConflict.body).toBe(409);
    expect(sourceConflict.json()).toMatchObject({ code: 'DOCUMENT_CONFLICT' });
  });

  it('serves immediate sanitized Markdown and marker-verified enhanced previews', async () => {
    const { app } = await fixture();
    const session = await login(app);
    const headers = {
      cookie: session.cookie,
      origin,
      'x-csrf-token': session.csrfToken,
    };
    const registered = await app.inject({
      method: 'POST',
      url: '/api/sites',
      headers,
      payload: { candidateId: 'test-blog', displayName: 'Preview Site' },
    });
    const siteId = registered.json<{ site: { id: string } }>().site.id;
    const listed = await app.inject({
      url: `/api/sites/${siteId}/content`,
      headers,
    });
    const documentId = listed.json<{
      content: { items: Array<{ documentId: string }> };
    }>().content.items[0]?.documentId;
    if (!documentId) throw new Error('fixture post missing');
    const opened = await app.inject({
      url: `/api/sites/${siteId}/content/${documentId}?collection=posts`,
      headers,
    });
    const source = opened.json<{
      source: { revision: string; frontMatter: Record<string, unknown> };
    }>().source;
    await app.inject({
      method: 'PUT',
      url: `/api/sites/${siteId}/content/${documentId}/working-copy?collection=posts`,
      headers,
      payload: {
        expectedVersion: 0,
        sourceRevision: source.revision,
        frontMatter: source.frontMatter,
        body: '# Markdown works\n\n<script>alert(1)</script>\n\n![Reading](/static/reading.jpeg)\n',
      },
    });

    const markdownStarted = await app.inject({
      method: 'POST',
      url: `/api/sites/${siteId}/content/${documentId}/preview?collection=posts&mode=markdown`,
      headers,
    });
    expect(markdownStarted.statusCode, markdownStarted.body).toBe(200);
    const markdownPreview = markdownStarted.json<{
      preview: { mode: string; status: string; url: string };
    }>().preview;
    expect(markdownPreview).toMatchObject({
      mode: 'markdown',
      status: 'ready',
    });
    const markdown = await app.inject({
      url: markdownPreview.url,
      headers,
    });
    expect(markdown.statusCode, markdown.body).toBe(200);
    expect(markdown.body).toContain('<h1>Markdown works</h1>');
    expect(markdown.body).not.toContain('<script>');
    expect(markdown.body).toContain(
      `/api/sites/${siteId}/content/${documentId}/resource?collection=posts&amp;source=%2Fstatic%2Freading.jpeg`,
    );
    expect(markdown.headers['content-security-policy']).toContain(
      "script-src 'none'",
    );
    const resource = await app.inject({
      url: `/api/sites/${siteId}/content/${documentId}/resource?collection=posts&source=%2Fstatic%2Freading.jpeg`,
      headers,
    });
    expect(resource.statusCode, resource.body).toBe(200);
    expect(resource.headers['content-type']).toContain('image/jpeg');

    const enhancedStarted = await app.inject({
      method: 'POST',
      url: `/api/sites/${siteId}/content/${documentId}/preview?collection=posts`,
      headers,
    });
    expect(enhancedStarted.statusCode, enhancedStarted.body).toBe(200);
    const enhancedPreview = enhancedStarted.json<{
      preview: { mode: string; status: string; url: string };
    }>().preview;
    expect(enhancedPreview).toMatchObject({
      mode: 'enhanced',
      status: 'ready',
    });
    const enhanced = await app.inject({ url: enhancedPreview.url, headers });
    expect(enhanced.statusCode, enhanced.body).toBe(200);
    expect(enhanced.body).toContain('blog-studio-preview:');
    expect(enhanced.body).toContain('# Markdown works');
  });

  it.each([
    ['missing-output', 'missing-output'],
    ['route-error', 'route-error'],
    ['build-error', 'build-error'],
  ] as const)(
    'falls back to Markdown when enhanced preview reports %s',
    async (previewFailure, fallbackReason) => {
      const { app } = await fixture({ previewFailure });
      const session = await login(app);
      const headers = {
        cookie: session.cookie,
        origin,
        'x-csrf-token': session.csrfToken,
      };
      const registered = await app.inject({
        method: 'POST',
        url: '/api/sites',
        headers,
        payload: { candidateId: 'test-blog', displayName: 'Fallback Site' },
      });
      const siteId = registered.json<{ site: { id: string } }>().site.id;
      const listed = await app.inject({
        url: `/api/sites/${siteId}/content`,
        headers,
      });
      const documentId = listed.json<{
        content: { items: Array<{ documentId: string }> };
      }>().content.items[0]?.documentId;
      if (!documentId) throw new Error('fixture post missing');

      const started = await app.inject({
        method: 'POST',
        url: `/api/sites/${siteId}/content/${documentId}/preview?collection=posts`,
        headers,
      });
      expect(started.statusCode, started.body).toBe(200);
      const preview = started.json<{
        preview: {
          mode: string;
          status: string;
          fallbackReason: string;
          url: string;
        };
      }>().preview;
      expect(preview).toMatchObject({
        mode: 'markdown',
        status: 'ready',
        fallbackReason,
      });
      expect((await app.inject({ url: preview.url, headers })).statusCode).toBe(
        200,
      );
    },
  );

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

  it('previews orphan assets and rejects a stale deletion confirmation', async () => {
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
    }>().documents[0]?.ref.documentId;
    if (!documentId) throw new Error('fixture document missing');
    const upload = async (red: number) => {
      const image = await sharp({
        create: {
          width: 8,
          height: 8,
          channels: 4,
          background: { r: red, g: 80, b: 35, alpha: 1 },
        },
      })
        .png()
        .toBuffer();
      const response = await app.inject({
        method: 'POST',
        url: `/api/workspaces/test-blog/documents/${documentId}/assets?collection=posts`,
        headers: {
          ...headers,
          'x-blog-studio-filename': encodeURIComponent(`image-${red}.png`),
          'content-type': 'image/png',
        },
        payload: image,
      });
      expect(response.statusCode, response.body).toBe(201);
      return response.json<{
        asset: { key: string; publicUrl: string };
      }>().asset;
    };
    const referenced = await upload(180);
    const orphan = await upload(220);
    const sourceResponse = await app.inject({
      url: `/api/workspaces/test-blog/documents/${documentId}?collection=posts`,
      headers: { cookie: session.cookie },
    });
    const source = sourceResponse.json<{
      source: { revision: string; frontMatter: Record<string, unknown> };
    }>().source;
    const draftUrl = `/api/workspaces/test-blog/documents/${documentId}/draft?collection=posts`;
    const saveDraft = async (expectedVersion: number) =>
      await app.inject({
        method: 'PUT',
        url: draftUrl,
        headers,
        payload: {
          expectedVersion,
          sourceRevision: source.revision,
          frontMatter: source.frontMatter,
          body: `![kept](${referenced.publicUrl})\n`,
        },
      });
    expect((await saveDraft(0)).statusCode).toBe(200);

    const orphanUrl = `/api/workspaces/test-blog/documents/${documentId}/assets/orphans?collection=posts`;
    const firstPlan = await app.inject({
      url: orphanUrl,
      headers: { cookie: session.cookie },
    });
    expect(firstPlan.statusCode, firstPlan.body).toBe(200);
    const firstPlanPayload = firstPlan.json<{
      plan: {
        confirmation: string;
        assets: Array<{ key: string }>;
      };
    }>().plan;
    expect(firstPlanPayload.assets.map((asset) => asset.key)).toEqual([
      orphan.key,
    ]);

    expect((await saveDraft(1)).statusCode).toBe(200);
    const stale = await app.inject({
      method: 'DELETE',
      url: orphanUrl,
      headers,
      payload: { confirmation: firstPlanPayload.confirmation },
    });
    expect(stale.statusCode, stale.body).toBe(409);
    expect(stale.json()).toMatchObject({ code: 'ASSET_PLAN_CONFLICT' });

    const currentPlan = await app.inject({
      url: orphanUrl,
      headers: { cookie: session.cookie },
    });
    const confirmation = currentPlan.json<{
      plan: { confirmation: string };
    }>().plan.confirmation;
    const deleted = await app.inject({
      method: 'DELETE',
      url: orphanUrl,
      headers,
      payload: { confirmation },
    });
    expect(deleted.statusCode, deleted.body).toBe(200);
    expect(deleted.json()).toMatchObject({ count: 1 });
    await expect(
      readFile(join(workspace, 'source', referenced.key)),
    ).resolves.toBeDefined();
    await expect(
      readFile(join(workspace, 'source', orphan.key)),
    ).rejects.toMatchObject({ code: 'ENOENT' });
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

    const previewStarted = await app.inject({
      method: 'POST',
      url: `/api/workspaces/test-blog/documents/${documentId}/preview?collection=drafts`,
      headers,
    });
    expect(previewStarted.statusCode).toBe(200);
    const previewUrl = previewStarted.json<{ preview: { url: string } }>()
      .preview.url;
    const preview = await app.inject({ url: previewUrl, headers });
    expect(preview.statusCode).toBe(200);
    expect(preview.body).toContain('Native draft body');
    await expect(
      readFile(
        join(workspace, 'source', '_drafts', 'native-release.md'),
        'utf8',
      ),
    ).resolves.toContain('Native release');
    await expect(
      readFile(
        join(workspace, 'source', '_posts', 'native-release.md'),
        'utf8',
      ),
    ).rejects.toThrow();

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
    const releaseCreatedAt = started.json<ReleaseDetails>().release.createdAt;
    expect((await app.inject(previewUrl)).statusCode).toBe(404);
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
      stat(join(workspace, 'source', '_posts', 'native-release.md')).then(
        (details) => details.mtime.toISOString(),
      ),
    ).resolves.toBe(releaseCreatedAt);
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

    const published = await app.inject({
      method: 'POST',
      url: '/api/workspaces/test-blog/releases',
      headers: mutationHeaders,
      payload: { targetId: 'production' },
    });
    expect(published.statusCode, published.body).toBe(202);
    const publishedReleaseId = published.json<ReleaseDetails>().release.id;
    const publishedDetails = await waitForRelease(
      app,
      session.cookie,
      publishedReleaseId,
    );
    expect(publishedDetails.release.status).toBe('succeeded');
    expect(
      publishedDetails.events.some(({ message }) =>
        message.includes('Preserved 1 protected baseline object'),
      ),
    ).toBe(true);
    expect(cosObjects.get('static/legacy.png')).toEqual(
      Uint8Array.from([1, 2, 3, 4]),
    );

    const repeated = await app.inject({
      method: 'POST',
      url: '/api/workspaces/test-blog/releases/adopt-baseline',
      headers: mutationHeaders,
      payload: { confirmation: 'ADOPT EXISTING DEPLOYMENT' },
    });
    expect(repeated.statusCode, repeated.body).toBe(409);
  });
});
