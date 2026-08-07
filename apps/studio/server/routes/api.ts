import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

import { resolveWorkspacePath } from '@blog-studio/adapter-command';
import { createArticleAssetScope } from '@blog-studio/assets';
import {
  createContentHash,
  createDocumentId,
  createWorkspaceId,
  type AssetRecord,
  type AssetScope,
  type FrontMatterValue,
} from '@blog-studio/core';
import {
  RevisionConflictError,
  type SqliteDraftRepository,
} from '@blog-studio/persistence';
import type { FastifyInstance } from 'fastify';

import {
  SourceRevisionConflictError,
  type ContentService,
} from '../services/content.js';
import type { ChangeSetService } from '../services/change-sets.js';
import {
  MarkdownPreviewNotFoundError,
  MarkdownPreviewResourceNotFoundError,
  type MarkdownPreviewResourceContext,
  type MarkdownPreviewService,
} from '../services/markdown-previews.js';
import {
  PreviewReadinessError,
  type PreviewFallbackReason,
  type PreviewService,
} from '../services/previews.js';
import type { SiteService } from '../services/sites.js';
import type { DevelopmentService } from '../services/development.js';
import type { SiteConfigurationService } from '../services/site-configurations.js';
import {
  BASELINE_ADOPTION_CONFIRMATION,
  type ReleaseService,
} from '../services/releases.js';
import type { WorkspaceService } from '../services/workspaces.js';

export interface ApiDependencies {
  readonly workspaces: WorkspaceService;
  readonly sites: SiteService;
  readonly content: ContentService;
  readonly changeSets: ChangeSetService;
  readonly drafts: SqliteDraftRepository;
  readonly markdownPreviews: MarkdownPreviewService;
  readonly previews: PreviewService;
  readonly releases: ReleaseService;
  readonly development: DevelopmentService;
  readonly siteConfigurations: SiteConfigurationService;
  readonly allowLegacyReleaseApi: boolean;
}

function previewFallbackReason(error: unknown): PreviewFallbackReason {
  if (error instanceof PreviewReadinessError) return error.reason;
  if (error instanceof Error && /timed? out|timeout/i.test(error.message))
    return 'timeout';
  return 'build-error';
}

const workspaceParams = {
  type: 'object',
  additionalProperties: false,
  required: ['workspaceId'],
  properties: {
    workspaceId: { type: 'string', pattern: '^[a-z0-9][a-z0-9._-]*$' },
  },
} as const;

const siteParams = {
  type: 'object',
  additionalProperties: false,
  required: ['siteId'],
  properties: {
    siteId: { type: 'string', pattern: '^site-[a-z0-9-]+$' },
  },
} as const;

const changeSetParams = {
  type: 'object',
  additionalProperties: false,
  required: ['siteId', 'changeSetId'],
  properties: {
    siteId: { type: 'string', pattern: '^site-[a-z0-9-]+$' },
    changeSetId: { type: 'string', pattern: '^change-[a-z0-9-]+$' },
  },
} as const;

const siteDocumentParams = {
  type: 'object',
  additionalProperties: false,
  required: ['siteId', 'documentId'],
  properties: {
    siteId: { type: 'string', pattern: '^site-[a-z0-9-]+$' },
    documentId: {
      type: 'string',
      pattern: '^[a-z0-9][a-z0-9._-]*$',
    },
  },
} as const;

const documentParams = {
  type: 'object',
  additionalProperties: false,
  required: ['workspaceId', 'documentId'],
  properties: {
    workspaceId: { type: 'string', pattern: '^[a-z0-9][a-z0-9._-]*$' },
    documentId: { type: 'string', pattern: '^[a-z0-9][a-z0-9._-]*$' },
  },
} as const;

const releaseParams = {
  type: 'object',
  additionalProperties: false,
  required: ['workspaceId', 'releaseId'],
  properties: {
    workspaceId: { type: 'string', pattern: '^[a-z0-9][a-z0-9._-]*$' },
    releaseId: { type: 'string', pattern: '^release-[a-z0-9-]+$' },
  },
} as const;

const siteReleaseParams = {
  type: 'object',
  additionalProperties: false,
  required: ['siteId', 'releaseId'],
  properties: {
    siteId: { type: 'string', pattern: '^site-[a-z0-9-]+$' },
    releaseId: { type: 'string', pattern: '^release-[a-z0-9-]+$' },
  },
} as const;

const collectionQuery = {
  type: 'object',
  additionalProperties: false,
  required: ['collection'],
  properties: { collection: { type: 'string', minLength: 1, maxLength: 64 } },
} as const;

const assetSourceQuery = {
  type: 'object',
  additionalProperties: false,
  required: ['collection', 'source'],
  properties: {
    collection: { type: 'string', minLength: 1, maxLength: 64 },
    source: { type: 'string', minLength: 1, maxLength: 2048 },
  },
} as const;

const markdownPreviewResourceQuery = {
  type: 'object',
  additionalProperties: false,
  required: ['source'],
  properties: {
    source: { type: 'string', minLength: 1, maxLength: 2048 },
  },
} as const;

const mediaTypes: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

function defaultSlug(title: string, now: Date): string {
  const fromTitle = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  if (fromTitle) return fromTitle;
  return `draft-${now.toISOString().replace(/\D/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
}

interface OrphanAssetPlan {
  readonly confirmation: string;
  readonly sourceRevision: string;
  readonly draftVersion: number;
  readonly assets: readonly AssetRecord[];
  readonly scope: AssetScope;
}

async function createOrphanAssetPlan(
  dependencies: ApiDependencies,
  input: {
    readonly workspaceId: string;
    readonly documentId: string;
    readonly collection: string;
  },
): Promise<OrphanAssetPlan> {
  const workspace = dependencies.workspaces.get(input.workspaceId);
  const { ref } = await dependencies.workspaces.findDocument(
    input.workspaceId,
    input.collection,
    input.documentId,
  );
  const source = await workspace.generator.readDocument(
    workspace.config.workspace.root,
    ref,
  );
  const draft = dependencies.drafts.get(ref.workspaceId, ref.documentId);
  const scope = createArticleAssetScope(
    createWorkspaceId(input.workspaceId),
    createDocumentId(input.documentId),
    workspace.assetRootPrefix,
  );
  const referenceText = JSON.stringify({
    frontMatter: draft?.frontMatter ?? source.frontMatter,
    body: draft?.body ?? source.body,
  });
  const assets = (await workspace.assetProvider.list(scope))
    .filter(
      (asset) =>
        !referenceText.includes(asset.publicUrl) &&
        !referenceText.includes(asset.key) &&
        !referenceText.includes(`/${asset.key}`),
    )
    .sort((left, right) => left.id.localeCompare(right.id));
  const confirmation = createContentHash(
    `sha256:${createHash('sha256')
      .update(
        JSON.stringify({
          workspaceId: input.workspaceId,
          documentId: input.documentId,
          collection: input.collection,
          sourceRevision: source.revision,
          draftVersion: draft?.version ?? 0,
          assets: assets.map((asset) => ({
            id: asset.id,
            contentHash: asset.contentHash,
          })),
        }),
      )
      .digest('hex')}`,
  );
  return {
    confirmation,
    sourceRevision: source.revision,
    draftVersion: draft?.version ?? 0,
    assets,
    scope,
  };
}

function rewritePreviewText(
  input: string,
  contentType: string,
  prefix: string,
  sourcePath: string,
): string {
  const rewriteUrl = (value: string): string => {
    const trimmed = value.trim();
    if (
      !trimmed ||
      trimmed.startsWith('#') ||
      trimmed.startsWith('//') ||
      /^(?:data|blob|https?|mailto|tel|javascript):/i.test(trimmed)
    )
      return value;
    const resolved = new URL(
      trimmed,
      `https://preview.invalid/${sourcePath.replace(/^\/+/, '')}`,
    );
    return `${prefix}${resolved.pathname}${resolved.search}${resolved.hash}`;
  };
  if (contentType.startsWith('text/html')) {
    const html = input
      .replace(
        /\b(href|src|action|poster)=(['"])([^'"]+)\2/gi,
        (_match, attribute: string, quote: string, value: string) =>
          `${attribute}=${quote}${rewriteUrl(value)}${quote}`,
      )
      .replace(
        /\bsrcset=(['"])([^'"]+)\1/gi,
        (_match, quote: string, sources: string) =>
          `srcset=${quote}${sources
            .split(',')
            .map((source) => {
              const [, url = '', descriptor = ''] = /^(\S+)(.*)$/.exec(
                source.trim(),
              ) ?? ['', '', ''];
              return `${rewriteUrl(url)}${descriptor}`;
            })
            .join(',')}${quote}`,
      );
    return rewritePreviewText(html, 'text/css', prefix, sourcePath);
  }
  if (contentType.startsWith('text/css')) {
    return input.replace(
      /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi,
      (_match, quote: string, value: string) =>
        `url(${quote}${rewriteUrl(value)}${quote})`,
    );
  }
  return input;
}

export function registerApiRoutes(
  app: FastifyInstance,
  dependencies: ApiDependencies,
): void {
  app.get('/api/sites', () => ({ sites: dependencies.sites.list() }));

  app.get('/api/sites/discover', async () => ({
    candidates: await dependencies.sites.discover(),
  }));

  app.get<{ Params: { siteId: string } }>(
    '/api/sites/:siteId/change-sets',
    { schema: { params: siteParams } },
    (request) => ({
      changeSets: dependencies.changeSets.list(request.params.siteId),
    }),
  );

  app.get<{ Params: { siteId: string; changeSetId: string } }>(
    '/api/sites/:siteId/change-sets/:changeSetId',
    { schema: { params: changeSetParams } },
    (request) => ({
      changeSet: dependencies.changeSets.get(
        request.params.siteId,
        request.params.changeSetId,
      ),
    }),
  );

  app.post<{ Params: { siteId: string } }>(
    '/api/sites/:siteId/change-sets/prepare',
    { schema: { params: siteParams } },
    async (request, reply) =>
      reply.code(201).send({
        changeSet: await dependencies.changeSets.prepare(request.params.siteId),
      }),
  );

  app.post<{ Params: { siteId: string; changeSetId: string } }>(
    '/api/sites/:siteId/change-sets/:changeSetId/apply',
    { schema: { params: changeSetParams } },
    async (request) => ({
      changeSet: await dependencies.changeSets.apply(
        request.params.siteId,
        request.params.changeSetId,
      ),
    }),
  );

  app.post<{
    Params: { siteId: string; changeSetId: string };
    Body: { message: string; paths: string[] };
  }>(
    '/api/sites/:siteId/change-sets/:changeSetId/commit',
    {
      schema: {
        params: changeSetParams,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['message', 'paths'],
          properties: {
            message: { type: 'string', minLength: 1, maxLength: 200 },
            paths: {
              type: 'array',
              minItems: 1,
              uniqueItems: true,
              items: { type: 'string', minLength: 1, maxLength: 2048 },
            },
          },
        },
      },
    },
    async (request) => ({
      changeSet: await dependencies.changeSets.commit({
        siteId: request.params.siteId,
        changeSetId: request.params.changeSetId,
        message: request.body.message,
        paths: request.body.paths,
      }),
    }),
  );

  app.get<{ Params: { siteId: string } }>(
    '/api/sites/:siteId/releases',
    { schema: { params: siteParams } },
    (request) => ({
      releases: dependencies.releases.list(
        dependencies.sites.workspaceId(request.params.siteId),
      ),
    }),
  );

  app.get<{ Params: { siteId: string; releaseId: string } }>(
    '/api/sites/:siteId/releases/:releaseId',
    { schema: { params: siteReleaseParams } },
    (request) =>
      dependencies.releases.get(
        dependencies.sites.workspaceId(request.params.siteId),
        request.params.releaseId,
      ),
  );

  app.delete<{ Params: { siteId: string; releaseId: string } }>(
    '/api/sites/:siteId/releases/:releaseId',
    { schema: { params: siteReleaseParams } },
    (request, reply) =>
      reply
        .code(202)
        .send(
          dependencies.releases.cancel(
            dependencies.sites.workspaceId(request.params.siteId),
            request.params.releaseId,
          ),
        ),
  );

  app.post<{ Params: { siteId: string; releaseId: string } }>(
    '/api/sites/:siteId/releases/:releaseId/rollback',
    { schema: { params: siteReleaseParams } },
    (request, reply) =>
      reply
        .code(202)
        .send(
          dependencies.releases.rollback(
            dependencies.sites.workspaceId(request.params.siteId),
            request.params.releaseId,
          ),
        ),
  );

  app.post<{
    Params: { siteId: string; changeSetId: string };
    Body: { targetId?: string; confirmation: string };
  }>(
    '/api/sites/:siteId/change-sets/:changeSetId/release',
    {
      schema: {
        params: changeSetParams,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['confirmation'],
          properties: {
            targetId: { type: 'string', minLength: 1, maxLength: 64 },
            confirmation: { type: 'string', maxLength: 64 },
          },
        },
      },
    },
    async (request, reply) =>
      reply.code(202).send({
        release: await dependencies.releases.startCommittedChangeSet({
          siteId: request.params.siteId,
          changeSetId: request.params.changeSetId,
          ...(request.body.targetId ? { targetId: request.body.targetId } : {}),
          confirmation: request.body.confirmation,
        }),
      }),
  );

  app.post<{
    Body: {
      candidateId: string;
      displayName: string;
      canonicalUrl?: string;
    };
  }>(
    '/api/sites',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['candidateId', 'displayName'],
          properties: {
            candidateId: {
              type: 'string',
              pattern: '^[a-z0-9][a-z0-9._-]*$',
            },
            displayName: { type: 'string', minLength: 1, maxLength: 120 },
            canonicalUrl: {
              type: 'string',
              format: 'uri',
              maxLength: 2048,
            },
          },
        },
      },
    },
    (request, reply) => {
      const site = dependencies.sites.register(request.body);
      return reply.code(201).send({ site });
    },
  );

  app.get<{ Params: { siteId: string } }>(
    '/api/sites/:siteId',
    { schema: { params: siteParams } },
    (request) => ({ site: dependencies.sites.get(request.params.siteId) }),
  );

  app.get<{ Params: { siteId: string } }>(
    '/api/sites/:siteId/events',
    { schema: { params: siteParams } },
    (request) => ({ events: dependencies.sites.events(request.params.siteId) }),
  );

  app.patch<{
    Params: { siteId: string };
    Body: {
      expectedUpdatedAt: string;
      displayName: string;
      canonicalUrl?: string;
    };
  }>(
    '/api/sites/:siteId',
    {
      schema: {
        params: siteParams,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['expectedUpdatedAt', 'displayName'],
          properties: {
            expectedUpdatedAt: { type: 'string', format: 'date-time' },
            displayName: { type: 'string', minLength: 1, maxLength: 120 },
            canonicalUrl: {
              type: 'string',
              format: 'uri',
              maxLength: 2048,
            },
          },
        },
      },
    },
    (request) => ({
      site: dependencies.sites.update({
        siteId: request.params.siteId,
        ...request.body,
      }),
    }),
  );

  app.get<{ Params: { siteId: string } }>(
    '/api/sites/:siteId/configuration',
    { schema: { params: siteParams } },
    async (request) => ({
      configuration: await dependencies.siteConfigurations.get(
        request.params.siteId,
      ),
    }),
  );

  app.get<{ Params: { siteId: string } }>(
    '/api/sites/:siteId/configuration/history',
    { schema: { params: siteParams } },
    async (request) => ({
      revisions: await dependencies.siteConfigurations.history(
        request.params.siteId,
      ),
    }),
  );

  app.post<{
    Params: { siteId: string };
    Body: { yaml: string };
  }>(
    '/api/sites/:siteId/configuration/validate',
    {
      schema: {
        params: siteParams,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['yaml'],
          properties: {
            yaml: { type: 'string', minLength: 1, maxLength: 200_000 },
          },
        },
      },
    },
    (request) => ({
      valid: true,
      configuration: dependencies.siteConfigurations.validate(
        request.body.yaml,
      ),
    }),
  );

  app.put<{
    Params: { siteId: string };
    Body: { expectedRevision: number; yaml: string };
  }>(
    '/api/sites/:siteId/configuration',
    {
      schema: {
        params: siteParams,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['expectedRevision', 'yaml'],
          properties: {
            expectedRevision: { type: 'integer', minimum: 1 },
            yaml: { type: 'string', minLength: 1, maxLength: 200_000 },
          },
        },
      },
    },
    async (request) => ({
      configuration: await dependencies.siteConfigurations.activate({
        siteId: request.params.siteId,
        ...request.body,
      }),
    }),
  );

  app.post<{
    Params: { siteId: string };
    Body: { expectedRevision: number; revision: number };
  }>(
    '/api/sites/:siteId/configuration/revert',
    {
      schema: {
        params: siteParams,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['expectedRevision', 'revision'],
          properties: {
            expectedRevision: { type: 'integer', minimum: 1 },
            revision: { type: 'integer', minimum: 1 },
          },
        },
      },
    },
    async (request) => ({
      configuration: await dependencies.siteConfigurations.revert({
        siteId: request.params.siteId,
        ...request.body,
      }),
    }),
  );

  app.get<{
    Params: { siteId: string };
    Querystring: {
      search?: string;
      collection?: string;
      state?: 'draft' | 'published' | 'modified';
      tag?: string;
      from?: string;
      to?: string;
      sort?:
        | 'activityAt'
        | 'publishedAt'
        | 'contentUpdatedAt'
        | 'filesystemModifiedAt'
        | 'title'
        | 'state'
        | 'path';
      direction?: 'asc' | 'desc';
      page?: number;
      pageSize?: number;
    };
  }>(
    '/api/sites/:siteId/content',
    {
      schema: {
        params: siteParams,
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            search: { type: 'string', minLength: 1, maxLength: 200 },
            collection: { type: 'string', minLength: 1, maxLength: 64 },
            state: { enum: ['draft', 'published', 'modified'] },
            tag: { type: 'string', minLength: 1, maxLength: 100 },
            from: { type: 'string', format: 'date-time' },
            to: { type: 'string', format: 'date-time' },
            sort: {
              enum: [
                'activityAt',
                'publishedAt',
                'contentUpdatedAt',
                'filesystemModifiedAt',
                'title',
                'state',
                'path',
              ],
            },
            direction: { enum: ['asc', 'desc'] },
            page: { type: 'integer', minimum: 1, maximum: 1_000_000 },
            pageSize: { type: 'integer', minimum: 1, maximum: 100 },
          },
        },
      },
    },
    async (request) => ({
      content: await dependencies.content.list(
        request.params.siteId,
        request.query,
      ),
    }),
  );

  app.post<{
    Params: { siteId: string };
    Body: { title: string; slug?: string };
  }>(
    '/api/sites/:siteId/content',
    {
      schema: {
        params: siteParams,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['title'],
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 200 },
            slug: {
              type: 'string',
              pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
              maxLength: 80,
            },
          },
        },
      },
    },
    async (request, reply) => {
      const workspaceId = dependencies.sites.workspaceId(request.params.siteId);
      const now = new Date();
      const created = await dependencies.workspaces.createDocument(
        workspaceId,
        {
          collectionId: 'drafts',
          title: request.body.title,
          slug: request.body.slug ?? defaultSlug(request.body.title, now),
          createdAt: now.toISOString(),
        },
      );
      const workspace = dependencies.workspaces.get(workspaceId);
      const configuredDefaults = Object.fromEntries(
        Object.entries(workspace.config.content?.fields ?? {}).flatMap(
          ([key, field]) =>
            field.default === undefined ? [] : [[key, field.default]],
        ),
      ) as Record<string, FrontMatterValue>;
      const draft = dependencies.drafts.save({
        workspaceId: created.source.ref.workspaceId,
        documentId: created.source.ref.documentId,
        expectedVersion: 0,
        sourceRevision: created.source.revision,
        frontMatter: { ...created.source.frontMatter, ...configuredDefaults },
        body: created.source.body,
        savedAt: now.toISOString(),
      });
      return reply.code(201).send({ source: created.source, draft });
    },
  );

  app.get<{ Params: { siteId: string } }>(
    '/api/sites/:siteId/development',
    { schema: { params: siteParams } },
    (request) => ({
      development: dependencies.development.snapshot(
        dependencies.sites.workspaceId(request.params.siteId),
      ),
    }),
  );

  app.post<{
    Params: { siteId: string };
    Body: { action: 'start' | 'restart' };
  }>(
    '/api/sites/:siteId/development',
    {
      schema: {
        params: siteParams,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['action'],
          properties: { action: { enum: ['start', 'restart'] } },
        },
      },
    },
    async (request) => {
      const workspaceId = dependencies.sites.workspaceId(request.params.siteId);
      return {
        development:
          request.body.action === 'start'
            ? await dependencies.development.start(workspaceId)
            : await dependencies.development.restart(workspaceId),
      };
    },
  );

  app.delete<{ Params: { siteId: string } }>(
    '/api/sites/:siteId/development',
    { schema: { params: siteParams } },
    async (request) => ({
      development: await dependencies.development.stop(
        dependencies.sites.workspaceId(request.params.siteId),
      ),
    }),
  );

  app.get<{ Params: { siteId: string; '*': string } }>(
    '/api/sites/:siteId/development/proxy/*',
    async (request, reply) => {
      const query = request.url.indexOf('?');
      const suffix = query === -1 ? '' : request.url.slice(query);
      const target = dependencies.development.proxyTarget(
        dependencies.sites.workspaceId(request.params.siteId),
        `/${request.params['*']}${suffix}`,
      );
      const response = await fetch(target, { redirect: 'manual' });
      const contentType = response.headers.get('content-type');
      if (contentType) reply.type(contentType);
      const location = response.headers.get('location');
      if (location) reply.header('location', location);
      return reply
        .code(response.status)
        .header('cache-control', 'private, no-store')
        .header('x-content-type-options', 'nosniff')
        .send(Buffer.from(await response.arrayBuffer()));
    },
  );

  app.get<{
    Params: { siteId: string; documentId: string };
    Querystring: { collection: string };
  }>(
    '/api/sites/:siteId/content/:documentId',
    {
      schema: { params: siteDocumentParams, querystring: collectionQuery },
    },
    async (request) =>
      await dependencies.content.read(
        request.params.siteId,
        request.query.collection,
        request.params.documentId,
      ),
  );

  app.put<{
    Params: { siteId: string; documentId: string };
    Querystring: { collection: string };
    Body: {
      expectedVersion: number;
      sourceRevision: string;
      frontMatter: Record<string, FrontMatterValue>;
      body: string;
    };
  }>(
    '/api/sites/:siteId/content/:documentId/working-copy',
    {
      schema: {
        params: siteDocumentParams,
        querystring: collectionQuery,
        body: {
          type: 'object',
          additionalProperties: false,
          required: [
            'expectedVersion',
            'sourceRevision',
            'frontMatter',
            'body',
          ],
          properties: {
            expectedVersion: { type: 'integer', minimum: 0 },
            sourceRevision: {
              type: 'string',
              pattern: '^sha256:[a-f0-9]{64}$',
            },
            frontMatter: { type: 'object', additionalProperties: true },
            body: { type: 'string', maxLength: 1_500_000 },
          },
        },
      },
    },
    async (request) => {
      const draft = await dependencies.content.save({
        siteId: request.params.siteId,
        collectionId: request.query.collection,
        documentId: request.params.documentId,
        ...request.body,
      });
      const workspaceId = dependencies.sites.workspaceId(request.params.siteId);
      const { ref } = await dependencies.workspaces.findDocument(
        workspaceId,
        request.query.collection,
        request.params.documentId,
      );
      const development = await dependencies.development.sync({
        workspaceId,
        ref,
        sourceRevision: createContentHash(request.body.sourceRevision),
        frontMatter: request.body.frontMatter,
        body: request.body.body,
      });
      return { draft, development };
    },
  );

  app.post<{
    Params: { siteId: string; documentId: string };
    Querystring: { collection: string };
    Body: { sourceRevision: string; frontMatterSource: string };
  }>(
    '/api/sites/:siteId/content/:documentId/repair-front-matter',
    {
      schema: {
        params: siteDocumentParams,
        querystring: collectionQuery,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['sourceRevision', 'frontMatterSource'],
          properties: {
            sourceRevision: {
              type: 'string',
              pattern: '^sha256:[a-f0-9]{64}$',
            },
            frontMatterSource: {
              type: 'string',
              minLength: 1,
              maxLength: 200_000,
            },
          },
        },
      },
    },
    async (request) => ({
      source: await dependencies.content.repairFrontMatter({
        siteId: request.params.siteId,
        collectionId: request.query.collection,
        documentId: request.params.documentId,
        ...request.body,
      }),
    }),
  );

  app.delete<{
    Params: { siteId: string; documentId: string };
    Querystring: { collection: string };
    Body: { expectedVersion: number };
  }>(
    '/api/sites/:siteId/content/:documentId/working-copy',
    {
      schema: {
        params: siteDocumentParams,
        querystring: collectionQuery,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['expectedVersion'],
          properties: { expectedVersion: { type: 'integer', minimum: 1 } },
        },
      },
    },
    async (request) => {
      await dependencies.content.discard({
        siteId: request.params.siteId,
        collectionId: request.query.collection,
        documentId: request.params.documentId,
        expectedVersion: request.body.expectedVersion,
      });
      return { discarded: true };
    },
  );

  app.delete<{
    Params: { siteId: string; documentId: string };
    Body: { expectedVersion: number };
  }>(
    '/api/sites/:siteId/content/:documentId/unavailable-working-copy',
    {
      schema: {
        params: siteDocumentParams,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['expectedVersion'],
          properties: { expectedVersion: { type: 'integer', minimum: 1 } },
        },
      },
    },
    async (request) => {
      await dependencies.content.discardUnavailable({
        siteId: request.params.siteId,
        documentId: request.params.documentId,
        expectedVersion: request.body.expectedVersion,
      });
      return { discarded: true };
    },
  );

  app.get<{
    Params: { siteId: string; documentId: string };
    Querystring: { collection: string; source: string };
  }>(
    '/api/sites/:siteId/content/:documentId/resource',
    { schema: { params: siteDocumentParams, querystring: assetSourceQuery } },
    async (request, reply) => {
      const workspaceId = dependencies.sites.workspaceId(request.params.siteId);
      const workspace = dependencies.workspaces.get(workspaceId);
      const { ref } = await dependencies.workspaces.findDocument(
        workspaceId,
        request.query.collection,
        request.params.documentId,
      );
      const sourcePath = await workspace.generator.resolveAssetSourcePath?.(
        workspace.config.workspace.root,
        ref,
        request.query.source,
      );
      if (!sourcePath) throw new Error('Unknown preview resource');
      const absolutePath = await resolveWorkspacePath(
        workspace.config.workspace.root,
        sourcePath,
      );
      return reply
        .header('cache-control', 'private, max-age=60')
        .header(
          'content-security-policy',
          "sandbox; default-src 'none'; img-src 'self'; media-src 'self'; style-src 'none'; script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
        )
        .header('x-content-type-options', 'nosniff')
        .type(
          mediaTypes[extname(absolutePath).toLowerCase()] ??
            'application/octet-stream',
        )
        .send(await readFile(absolutePath));
    },
  );

  app.post<{
    Params: { siteId: string; documentId: string };
    Querystring: { collection: string };
    Body: Buffer;
  }>(
    '/api/sites/:siteId/content/:documentId/resources',
    { schema: { params: siteDocumentParams, querystring: collectionQuery } },
    async (request, reply) => {
      const workspaceId = dependencies.sites.workspaceId(request.params.siteId);
      const workspace = dependencies.workspaces.get(workspaceId);
      await dependencies.workspaces.findDocument(
        workspaceId,
        request.query.collection,
        request.params.documentId,
      );
      const encodedFilename = request.headers['x-blog-studio-filename'];
      if (typeof encodedFilename !== 'string') {
        return reply.code(400).send({
          type: 'about:blank',
          title: 'Missing resource filename',
          status: 400,
        });
      }
      let filename: string;
      try {
        filename = decodeURIComponent(encodedFilename);
      } catch {
        return reply.code(400).send({
          type: 'about:blank',
          title: 'Invalid resource filename encoding',
          status: 400,
        });
      }
      if (!Buffer.isBuffer(request.body)) {
        return reply.code(400).send({
          type: 'about:blank',
          title: 'Resource body must be binary data',
          status: 400,
        });
      }
      const resource = await workspace.resources.ingest({
        scope: createArticleAssetScope(
          createWorkspaceId(workspaceId),
          createDocumentId(request.params.documentId),
          workspace.assetRootPrefix,
        ),
        filename,
        claimedMediaType: request.headers['content-type'] ?? '',
        bytes: request.body,
      });
      return reply.code(201).send({
        resource: {
          ...resource,
          storage:
            workspace.config.assets.adapter === 'filesystem'
              ? 'local'
              : 'remote',
        },
      });
    },
  );

  app.get<{
    Params: { siteId: string; documentId: string };
    Querystring: { collection: string };
  }>(
    '/api/sites/:siteId/content/:documentId/resources/orphans',
    { schema: { params: siteDocumentParams, querystring: collectionQuery } },
    async (request) => {
      const workspaceId = dependencies.sites.workspaceId(request.params.siteId);
      const workspace = dependencies.workspaces.get(workspaceId);
      const plan = await createOrphanAssetPlan(dependencies, {
        workspaceId,
        documentId: request.params.documentId,
        collection: request.query.collection,
      });
      return {
        plan: {
          confirmation: plan.confirmation,
          sourceRevision: plan.sourceRevision,
          draftVersion: plan.draftVersion,
          assets: plan.assets,
          storage:
            workspace.config.assets.adapter === 'filesystem'
              ? 'local'
              : 'remote',
        },
      };
    },
  );

  app.delete<{
    Params: { siteId: string; documentId: string };
    Querystring: { collection: string };
    Body: { confirmation: string };
  }>(
    '/api/sites/:siteId/content/:documentId/resources/orphans',
    {
      schema: {
        params: siteDocumentParams,
        querystring: collectionQuery,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['confirmation'],
          properties: {
            confirmation: {
              type: 'string',
              pattern: '^sha256:[a-f0-9]{64}$',
            },
          },
        },
      },
    },
    async (request, reply) => {
      const workspaceId = dependencies.sites.workspaceId(request.params.siteId);
      const workspace = dependencies.workspaces.get(workspaceId);
      const plan = await createOrphanAssetPlan(dependencies, {
        workspaceId,
        documentId: request.params.documentId,
        collection: request.query.collection,
      });
      if (request.body.confirmation !== plan.confirmation)
        return reply.code(409).send({
          type: 'about:blank',
          title: 'Resource deletion plan changed; preview it again',
          status: 409,
          code: 'ASSET_PLAN_CONFLICT',
        });
      for (const asset of plan.assets)
        await workspace.assetProvider.delete({
          scope: plan.scope,
          assetId: asset.id,
          expectedContentHash: asset.contentHash,
        });
      return {
        deleted: plan.assets.map((asset) => asset.id),
        count: plan.assets.length,
      };
    },
  );

  app.post<{
    Params: { siteId: string; documentId: string };
    Querystring: {
      collection: string;
      mode?: 'markdown' | 'enhanced';
    };
  }>(
    '/api/sites/:siteId/content/:documentId/preview',
    {
      schema: {
        params: siteDocumentParams,
        querystring: {
          type: 'object',
          additionalProperties: false,
          required: ['collection'],
          properties: {
            collection: { type: 'string', minLength: 1, maxLength: 64 },
            mode: { enum: ['markdown', 'enhanced'] },
          },
        },
      },
    },
    async (request) => {
      const opened = await dependencies.content.read(
        request.params.siteId,
        request.query.collection,
        request.params.documentId,
      );
      const frontMatter =
        opened.draft?.frontMatter ?? opened.source.frontMatter;
      const body = opened.draft?.body ?? opened.source.body;
      const titleValue = frontMatter.title;
      const title =
        typeof titleValue === 'string' || typeof titleValue === 'number'
          ? String(titleValue)
          : request.params.documentId;
      const markdown = dependencies.markdownPreviews.start({
        title,
        body,
        resource: {
          kind: 'site',
          siteId: request.params.siteId,
          documentId: request.params.documentId,
          collection: request.query.collection,
        },
      });
      const markdownResult = {
        id: markdown.id,
        mode: 'markdown' as const,
        status: 'ready' as const,
        url: `/api/markdown-previews/${markdown.id}`,
        createdAt: markdown.createdAt,
        expiresAt: markdown.expiresAt,
      };
      if (request.query.mode === 'markdown') return { preview: markdownResult };

      const workspaceId = dependencies.sites.workspaceId(request.params.siteId);
      try {
        const enhanced = await dependencies.previews.start({
          workspaceId,
          ref: opened.source.ref,
          sourceRevision: opened.source.revision,
          source: opened.source,
          ...(opened.draft ? { draft: opened.draft } : {}),
        });
        return {
          preview: {
            id: enhanced.id,
            mode: 'enhanced' as const,
            status: 'ready' as const,
            url: `/api/previews/${enhanced.id}/content${enhanced.contentPath}`,
            createdAt: enhanced.createdAt,
            expiresAt: enhanced.expiresAt,
          },
        };
      } catch (error) {
        return {
          preview: {
            ...markdownResult,
            fallbackReason: previewFallbackReason(error),
          },
        };
      }
    },
  );

  app.delete<{ Params: { siteId: string } }>(
    '/api/sites/:siteId/preview',
    { schema: { params: siteParams } },
    async (request) => ({
      stopped: await dependencies.previews.stop(
        dependencies.sites.workspaceId(request.params.siteId),
      ),
    }),
  );

  app.get('/api/workspaces', () => ({
    workspaces: dependencies.workspaces.list().map((workspace) => ({
      id: workspace.config.workspace.id,
      generator: workspace.generator.id,
      capabilities: workspace.generator.capabilities,
      canCreateDocuments: workspace.generator.createDocument !== undefined,
      publishTarget: dependencies.releases.target(workspace),
    })),
  }));

  app.post<{
    Params: { workspaceId: string };
    Body: { title: string; slug?: string };
  }>(
    '/api/workspaces/:workspaceId/documents',
    {
      schema: {
        params: workspaceParams,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['title'],
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 200 },
            slug: {
              type: 'string',
              pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
              maxLength: 80,
            },
          },
        },
      },
    },
    async (request, reply) => {
      const now = new Date();
      const created = await dependencies.workspaces.createDocument(
        request.params.workspaceId,
        {
          collectionId: 'drafts',
          title: request.body.title,
          slug: request.body.slug ?? defaultSlug(request.body.title, now),
          createdAt: now.toISOString(),
        },
      );
      const draft = dependencies.drafts.save({
        workspaceId: created.source.ref.workspaceId,
        documentId: created.source.ref.documentId,
        expectedVersion: 0,
        sourceRevision: created.source.revision,
        frontMatter: created.source.frontMatter,
        body: created.source.body,
        savedAt: now.toISOString(),
      });
      return reply.code(201).send({ source: created.source, draft });
    },
  );

  app.get<{ Params: { workspaceId: string } }>(
    '/api/workspaces/:workspaceId/releases',
    { schema: { params: workspaceParams } },
    (request) => ({
      releases: dependencies.releases.list(request.params.workspaceId),
    }),
  );

  app.get<{
    Params: { workspaceId: string; documentId: string };
    Querystring: { collection: string };
  }>(
    '/api/workspaces/:workspaceId/documents/:documentId/assets/orphans',
    { schema: { params: documentParams, querystring: collectionQuery } },
    async (request) => {
      const plan = await createOrphanAssetPlan(dependencies, {
        ...request.params,
        collection: request.query.collection,
      });
      return {
        plan: {
          confirmation: plan.confirmation,
          sourceRevision: plan.sourceRevision,
          draftVersion: plan.draftVersion,
          assets: plan.assets,
        },
      };
    },
  );

  app.delete<{
    Params: { workspaceId: string; documentId: string };
    Querystring: { collection: string };
    Body: { confirmation: string };
  }>(
    '/api/workspaces/:workspaceId/documents/:documentId/assets/orphans',
    {
      schema: {
        params: documentParams,
        querystring: collectionQuery,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['confirmation'],
          properties: {
            confirmation: {
              type: 'string',
              pattern: '^sha256:[a-f0-9]{64}$',
            },
          },
        },
      },
    },
    async (request, reply) => {
      const workspace = dependencies.workspaces.get(request.params.workspaceId);
      const plan = await createOrphanAssetPlan(dependencies, {
        ...request.params,
        collection: request.query.collection,
      });
      if (request.body.confirmation !== plan.confirmation)
        return reply.code(409).send({
          type: 'about:blank',
          title: 'Asset deletion plan changed; preview it again',
          status: 409,
          code: 'ASSET_PLAN_CONFLICT',
        });
      for (const asset of plan.assets)
        await workspace.assetProvider.delete({
          scope: plan.scope,
          assetId: asset.id,
          expectedContentHash: asset.contentHash,
        });
      return {
        deleted: plan.assets.map((asset) => asset.id),
        count: plan.assets.length,
      };
    },
  );

  app.get<{
    Params: { workspaceId: string; releaseId: string };
  }>(
    '/api/workspaces/:workspaceId/releases/:releaseId',
    { schema: { params: releaseParams } },
    (request) =>
      dependencies.releases.get(
        request.params.workspaceId,
        request.params.releaseId,
      ),
  );

  app.post<{
    Params: { workspaceId: string };
    Body: {
      targetId?: string;
      draft?: { collectionId: string; documentId: string; version: number };
    };
  }>(
    '/api/workspaces/:workspaceId/releases',
    {
      schema: {
        params: workspaceParams,
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            targetId: { type: 'string', minLength: 1, maxLength: 64 },
            draft: {
              type: 'object',
              additionalProperties: false,
              required: ['collectionId', 'documentId', 'version'],
              properties: {
                collectionId: { type: 'string', minLength: 1, maxLength: 64 },
                documentId: {
                  type: 'string',
                  pattern: '^[a-z0-9][a-z0-9._-]*$',
                },
                version: { type: 'integer', minimum: 1 },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      if (!dependencies.allowLegacyReleaseApi)
        return reply.code(410).send({
          type: 'about:blank',
          title: 'Legacy live-tree release is disabled',
          status: 410,
          code: 'LEGACY_RELEASE_DISABLED',
          action:
            'Prepare, apply, and commit a Site ChangeSet before remote release',
        });
      await dependencies.previews.stop(request.params.workspaceId);
      const release = await dependencies.releases.start(
        request.params.workspaceId,
        request.body.targetId,
        request.body.draft,
      );
      return reply.code(202).send(release);
    },
  );

  app.post<{
    Params: { workspaceId: string };
    Body: { targetId?: string; confirmation: string };
  }>(
    '/api/workspaces/:workspaceId/releases/adopt-baseline',
    {
      schema: {
        params: workspaceParams,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['confirmation'],
          properties: {
            targetId: { type: 'string', minLength: 1, maxLength: 64 },
            confirmation: {
              type: 'string',
              enum: [BASELINE_ADOPTION_CONFIRMATION],
            },
          },
        },
      },
    },
    (request, reply) =>
      reply
        .code(202)
        .send(
          dependencies.releases.adoptBaseline(
            request.params.workspaceId,
            request.body.targetId,
            request.body.confirmation,
          ),
        ),
  );

  app.delete<{
    Params: { workspaceId: string; releaseId: string };
  }>(
    '/api/workspaces/:workspaceId/releases/:releaseId',
    { schema: { params: releaseParams } },
    (request, reply) =>
      reply
        .code(202)
        .send(
          dependencies.releases.cancel(
            request.params.workspaceId,
            request.params.releaseId,
          ),
        ),
  );

  app.post<{
    Params: { workspaceId: string; releaseId: string };
  }>(
    '/api/workspaces/:workspaceId/releases/:releaseId/rollback',
    { schema: { params: releaseParams } },
    (request, reply) =>
      reply
        .code(202)
        .send(
          dependencies.releases.rollback(
            request.params.workspaceId,
            request.params.releaseId,
          ),
        ),
  );

  app.post<{ Params: { workspaceId: string } }>(
    '/api/workspaces/:workspaceId/scan',
    { schema: { params: workspaceParams } },
    async (request) => {
      const workspace = dependencies.workspaces.get(request.params.workspaceId);
      const root = workspace.config.workspace.root;
      const [detection, model] = await Promise.all([
        workspace.generator.detect(root),
        workspace.generator.inspect(root),
      ]);
      return { detection, model };
    },
  );

  app.get<{
    Params: { workspaceId: string };
    Querystring: { collection: string };
  }>(
    '/api/workspaces/:workspaceId/documents',
    { schema: { params: workspaceParams, querystring: collectionQuery } },
    async (request) => {
      const workspace = dependencies.workspaces.get(request.params.workspaceId);
      return {
        documents: await workspace.generator.listDocuments(
          workspace.config.workspace.root,
          request.query.collection,
        ),
      };
    },
  );

  app.get<{
    Params: { workspaceId: string; documentId: string };
    Querystring: { collection: string };
  }>(
    '/api/workspaces/:workspaceId/documents/:documentId',
    { schema: { params: documentParams, querystring: collectionQuery } },
    async (request) => {
      const workspace = dependencies.workspaces.get(request.params.workspaceId);
      const { ref } = await dependencies.workspaces.findDocument(
        request.params.workspaceId,
        request.query.collection,
        request.params.documentId,
      );
      const source = await workspace.generator.readDocument(
        workspace.config.workspace.root,
        ref,
      );
      const draft = dependencies.drafts.get(ref.workspaceId, ref.documentId);
      return { source, draft };
    },
  );

  app.put<{
    Params: { workspaceId: string; documentId: string };
    Querystring: { collection: string };
    Body: {
      expectedVersion: number;
      sourceRevision: string;
      frontMatter: Record<string, FrontMatterValue>;
      body: string;
    };
  }>(
    '/api/workspaces/:workspaceId/documents/:documentId/draft',
    {
      schema: {
        params: documentParams,
        querystring: collectionQuery,
        body: {
          type: 'object',
          additionalProperties: false,
          required: [
            'expectedVersion',
            'sourceRevision',
            'frontMatter',
            'body',
          ],
          properties: {
            expectedVersion: { type: 'integer', minimum: 0 },
            sourceRevision: {
              type: 'string',
              pattern: '^sha256:[a-f0-9]{64}$',
            },
            frontMatter: { type: 'object', additionalProperties: true },
            body: { type: 'string', maxLength: 1_500_000 },
          },
        },
      },
    },
    async (request, reply) => {
      const { ref } = await dependencies.workspaces.findDocument(
        request.params.workspaceId,
        request.query.collection,
        request.params.documentId,
      );
      const workspace = dependencies.workspaces.get(request.params.workspaceId);
      const source = await workspace.generator.readDocument(
        workspace.config.workspace.root,
        ref,
      );
      if (source.revision !== request.body.sourceRevision) {
        throw new SourceRevisionConflictError(
          request.body.sourceRevision,
          source.revision,
        );
      }
      const snapshot = dependencies.drafts.save({
        workspaceId: ref.workspaceId,
        documentId: ref.documentId,
        expectedVersion: request.body.expectedVersion,
        sourceRevision: createContentHash(request.body.sourceRevision),
        frontMatter: request.body.frontMatter,
        body: request.body.body,
        savedAt: new Date().toISOString(),
      });
      return reply.code(200).send({ draft: snapshot });
    },
  );

  app.delete<{
    Params: { workspaceId: string; documentId: string };
    Querystring: { collection: string };
    Body: { expectedVersion: number };
  }>(
    '/api/workspaces/:workspaceId/documents/:documentId/draft',
    {
      schema: {
        params: documentParams,
        querystring: collectionQuery,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['expectedVersion'],
          properties: { expectedVersion: { type: 'integer', minimum: 1 } },
        },
      },
    },
    async (request) => {
      const { ref } = await dependencies.workspaces.findDocument(
        request.params.workspaceId,
        request.query.collection,
        request.params.documentId,
      );
      const current = dependencies.drafts.get(ref.workspaceId, ref.documentId);
      if (
        !current ||
        !dependencies.drafts.delete(
          ref.workspaceId,
          ref.documentId,
          request.body.expectedVersion,
        )
      )
        throw new RevisionConflictError(
          request.body.expectedVersion,
          current?.version ?? 0,
        );
      return { discarded: true };
    },
  );

  app.post<{
    Params: { workspaceId: string; documentId: string };
    Querystring: { collection: string };
    Body: Buffer;
  }>(
    '/api/workspaces/:workspaceId/documents/:documentId/assets',
    { schema: { params: documentParams, querystring: collectionQuery } },
    async (request, reply) => {
      const workspace = dependencies.workspaces.get(request.params.workspaceId);
      await dependencies.workspaces.findDocument(
        request.params.workspaceId,
        request.query.collection,
        request.params.documentId,
      );
      const encodedFilename = request.headers['x-blog-studio-filename'];
      if (typeof encodedFilename !== 'string')
        return reply.code(400).send({
          type: 'about:blank',
          title: 'Missing asset filename',
          status: 400,
        });
      let filename: string;
      try {
        filename = decodeURIComponent(encodedFilename);
      } catch {
        return reply.code(400).send({
          type: 'about:blank',
          title: 'Invalid asset filename encoding',
          status: 400,
        });
      }
      const contentType = request.headers['content-type'] ?? '';
      if (!Buffer.isBuffer(request.body))
        return reply.code(400).send({
          type: 'about:blank',
          title: 'Asset body must be an image',
          status: 400,
        });
      const asset = await workspace.assets.ingest({
        scope: createArticleAssetScope(
          createWorkspaceId(request.params.workspaceId),
          createDocumentId(request.params.documentId),
          workspace.assetRootPrefix,
        ),
        filename,
        claimedMediaType: contentType,
        bytes: request.body,
      });
      return reply.code(201).send({ asset });
    },
  );

  app.get<{
    Params: { workspaceId: string; documentId: string };
    Querystring: { collection: string; source: string };
  }>(
    '/api/workspaces/:workspaceId/documents/:documentId/legacy-asset',
    { schema: { params: documentParams, querystring: assetSourceQuery } },
    async (request, reply) => {
      const workspace = dependencies.workspaces.get(request.params.workspaceId);
      const { ref } = await dependencies.workspaces.findDocument(
        request.params.workspaceId,
        request.query.collection,
        request.params.documentId,
      );
      const path = await workspace.generator.resolveAssetSourcePath?.(
        workspace.config.workspace.root,
        ref,
        request.query.source,
      );
      if (!path) throw new Error('Unknown legacy asset');
      const absolutePath = await resolveWorkspacePath(
        workspace.config.workspace.root,
        path,
      );
      return reply
        .header('cache-control', 'private, max-age=60')
        .header('x-content-type-options', 'nosniff')
        .type(
          mediaTypes[extname(absolutePath).toLowerCase()] ??
            'application/octet-stream',
        )
        .send(await readFile(absolutePath));
    },
  );

  app.post<{
    Params: { workspaceId: string; documentId: string };
    Querystring: { collection: string };
  }>(
    '/api/workspaces/:workspaceId/documents/:documentId/preview',
    { schema: { params: documentParams, querystring: collectionQuery } },
    async (request) => {
      const workspace = dependencies.workspaces.get(request.params.workspaceId);
      const { ref } = await dependencies.workspaces.findDocument(
        request.params.workspaceId,
        request.query.collection,
        request.params.documentId,
      );
      const source = await workspace.generator.readDocument(
        workspace.config.workspace.root,
        ref,
      );
      const draft = dependencies.drafts.get(ref.workspaceId, ref.documentId);
      const previewSource = draft ?? source;
      const titleValue = previewSource.frontMatter.title;
      const title =
        typeof titleValue === 'string' || typeof titleValue === 'number'
          ? String(titleValue)
          : request.params.documentId;
      const markdown = dependencies.markdownPreviews.start({
        title,
        body: previewSource.body,
        resource: {
          kind: 'workspace',
          workspaceId: request.params.workspaceId,
          documentId: request.params.documentId,
          collection: request.query.collection,
        },
      });
      const markdownResult = {
        id: markdown.id,
        mode: 'markdown' as const,
        status: 'ready' as const,
        files: 0,
        createdAt: markdown.createdAt,
        expiresAt: markdown.expiresAt,
        url: `/api/markdown-previews/${markdown.id}`,
      };
      try {
        const preview = await dependencies.previews.start({
          workspaceId: request.params.workspaceId,
          ref,
          sourceRevision: source.revision,
          source,
          ...(draft === null ? {} : { draft }),
        });
        return {
          preview: {
            id: preview.id,
            mode: 'enhanced' as const,
            status: 'ready' as const,
            workspaceId: preview.workspaceId,
            files: preview.manifest.length,
            createdAt: preview.createdAt,
            expiresAt: preview.expiresAt,
            url: `/api/previews/${preview.id}/content${preview.contentPath}`,
          },
        };
      } catch (error) {
        return {
          preview: {
            ...markdownResult,
            fallbackReason: previewFallbackReason(error),
          },
        };
      }
    },
  );

  app.delete<{
    Params: { workspaceId: string; documentId: string };
    Querystring: { collection: string };
  }>(
    '/api/workspaces/:workspaceId/documents/:documentId/preview',
    { schema: { params: documentParams, querystring: collectionQuery } },
    async (request) => ({
      stopped: await dependencies.previews.stop(request.params.workspaceId),
    }),
  );

  app.get<{ Params: { previewId: string } }>(
    '/api/markdown-previews/:previewId',
    async (request, reply) => {
      const preview = dependencies.markdownPreviews.get(
        request.params.previewId,
      );
      return reply
        .header(
          'content-security-policy',
          "sandbox; default-src 'none'; img-src 'self' https:; media-src 'self' https:; style-src 'unsafe-inline'; font-src 'none'; object-src 'none'; script-src 'none'; base-uri 'none'; form-action 'none'",
        )
        .header('x-content-type-options', 'nosniff')
        .header('referrer-policy', 'no-referrer')
        .header('cache-control', 'no-store')
        .type('text/html; charset=utf-8')
        .send(preview.html);
    },
  );

  app.get<{
    Params: { previewId: string };
    Querystring: { source: string };
  }>(
    '/api/markdown-previews/:previewId/resource',
    { schema: { querystring: markdownPreviewResourceQuery } },
    async (request, reply) => {
      let context: MarkdownPreviewResourceContext;
      try {
        context = dependencies.markdownPreviews.resource(
          request.params.previewId,
          request.query.source,
        );
      } catch (error) {
        if (
          error instanceof MarkdownPreviewNotFoundError ||
          error instanceof MarkdownPreviewResourceNotFoundError
        ) {
          return reply.code(404).send({
            type: 'about:blank',
            title: 'Markdown preview resource not found',
            status: 404,
          });
        }
        throw error;
      }

      const workspaceId =
        context.kind === 'site'
          ? dependencies.sites.workspaceId(context.siteId)
          : context.workspaceId;
      const workspace = dependencies.workspaces.get(workspaceId);
      const { ref } = await dependencies.workspaces.findDocument(
        workspaceId,
        context.collection,
        context.documentId,
      );
      const sourcePath = await workspace.generator.resolveAssetSourcePath?.(
        workspace.config.workspace.root,
        ref,
        request.query.source,
      );
      if (!sourcePath) {
        return reply.code(404).send({
          type: 'about:blank',
          title: 'Markdown preview resource not found',
          status: 404,
        });
      }
      const absolutePath = await resolveWorkspacePath(
        workspace.config.workspace.root,
        sourcePath,
      );
      return reply
        .header('cache-control', 'no-store')
        .header(
          'content-security-policy',
          "sandbox; default-src 'none'; img-src 'self'; media-src 'self'; style-src 'none'; script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
        )
        .header('x-content-type-options', 'nosniff')
        .header('referrer-policy', 'no-referrer')
        .type(
          mediaTypes[extname(absolutePath).toLowerCase()] ??
            'application/octet-stream',
        )
        .send(await readFile(absolutePath));
    },
  );

  app.get<{ Params: { previewId: string; '*': string } }>(
    '/api/previews/:previewId/content/*',
    async (request, reply) => {
      const preview = dependencies.previews.get(request.params.previewId);
      const requestedPath = request.params['*'] || 'index.html';
      const candidate = requestedPath.endsWith('/')
        ? `${requestedPath}index.html`
        : requestedPath;
      let path: string;
      try {
        path = await resolveWorkspacePath(preview.outputDirectory, candidate);
      } catch (error) {
        const workspace = dependencies.workspaces.get(preview.workspaceId);
        const fallback = await workspace.generator.resolveAssetSourcePath?.(
          preview.sourceDirectory,
          preview.ref,
          `/${candidate}`,
        );
        if (!fallback) throw error;
        path = await resolveWorkspacePath(preview.sourceDirectory, fallback);
      }
      const contentType =
        mediaTypes[extname(path).toLowerCase()] ?? 'application/octet-stream';
      const content = await readFile(path);
      const previewPrefix = `/api/previews/${preview.id}/content`;
      reply
        .header(
          'content-security-policy',
          "sandbox; default-src 'self' data: blob:; font-src 'self' data: https:; img-src 'self' data: blob: https:; object-src 'none'; script-src 'none'; style-src 'self' 'unsafe-inline' https:; base-uri 'none'",
        )
        .header('x-content-type-options', 'nosniff')
        .header('referrer-policy', 'no-referrer')
        .header('cache-control', 'no-store')
        .type(contentType);
      return contentType.startsWith('text/') || contentType.includes('json')
        ? rewritePreviewText(
            content.toString('utf8'),
            contentType,
            previewPrefix,
            candidate,
          )
        : content;
    },
  );
}
