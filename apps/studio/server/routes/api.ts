import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';

import { resolveWorkspacePath } from '@blog-studio/adapter-command';
import { createArticleAssetScope } from '@blog-studio/assets';
import {
  createContentHash,
  createDocumentId,
  createWorkspaceId,
  type FrontMatterValue,
} from '@blog-studio/core';
import {
  RevisionConflictError,
  type SqliteDraftRepository,
} from '@blog-studio/persistence';
import type { FastifyInstance } from 'fastify';

import type { PreviewService } from '../services/previews.js';
import {
  BASELINE_ADOPTION_CONFIRMATION,
  type ReleaseService,
} from '../services/releases.js';
import type { WorkspaceService } from '../services/workspaces.js';

interface ApiDependencies {
  readonly workspaces: WorkspaceService;
  readonly drafts: SqliteDraftRepository;
  readonly previews: PreviewService;
  readonly releases: ReleaseService;
}

const workspaceParams = {
  type: 'object',
  additionalProperties: false,
  required: ['workspaceId'],
  properties: {
    workspaceId: { type: 'string', pattern: '^[a-z0-9][a-z0-9._-]*$' },
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
  app.get('/api/health', () => ({ status: 'ok' as const }));

  app.get('/api/workspaces', () => ({
    workspaces: dependencies.workspaces.list().map((workspace) => ({
      id: workspace.config.workspace.id,
      generator: workspace.generator.id,
      capabilities: workspace.generator.capabilities,
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
      const preview = await dependencies.previews.start({
        workspaceId: request.params.workspaceId,
        ref,
        sourceRevision: source.revision,
        ...(draft === null ? {} : { draft }),
      });
      return {
        preview: {
          id: preview.id,
          workspaceId: preview.workspaceId,
          files: preview.manifest.length,
          createdAt: preview.createdAt,
          expiresAt: preview.expiresAt,
          url: `/api/previews/${preview.id}/content${preview.contentPath}`,
        },
      };
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
