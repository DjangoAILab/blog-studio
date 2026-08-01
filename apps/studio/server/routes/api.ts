import { createContentHash, type FrontMatterValue } from '@blog-studio/core';
import type { SqliteDraftRepository } from '@blog-studio/persistence';
import type { FastifyInstance } from 'fastify';

import type { PreviewService } from '../services/previews.js';
import type { WorkspaceService } from '../services/workspaces.js';

interface ApiDependencies {
  readonly workspaces: WorkspaceService;
  readonly drafts: SqliteDraftRepository;
  readonly previews: PreviewService;
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

const collectionQuery = {
  type: 'object',
  additionalProperties: false,
  required: ['collection'],
  properties: { collection: { type: 'string', minLength: 1, maxLength: 64 } },
} as const;

export function registerApiRoutes(
  app: FastifyInstance,
  dependencies: ApiDependencies,
): void {
  app.get('/api/health', () => ({ status: 'ok' as const }));

  app.get('/api/workspaces', () => ({
    workspaces: dependencies.workspaces.list().map(({ config, generator }) => ({
      id: config.workspace.id,
      generator: generator.id,
      capabilities: generator.capabilities,
    })),
  }));

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

  app.post<{ Params: { workspaceId: string } }>(
    '/api/workspaces/:workspaceId/preview',
    { schema: { params: workspaceParams } },
    async (request) => {
      const preview = await dependencies.previews.start(
        request.params.workspaceId,
      );
      return {
        preview: {
          id: preview.id,
          workspaceId: preview.workspaceId,
          files: preview.manifest.length,
          createdAt: preview.createdAt,
          expiresAt: preview.expiresAt,
          url: `/api/previews/${preview.id}/content/`,
        },
      };
    },
  );

  app.delete<{ Params: { workspaceId: string } }>(
    '/api/workspaces/:workspaceId/preview',
    { schema: { params: workspaceParams } },
    (request) => ({
      stopped: dependencies.previews.stop(request.params.workspaceId),
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
      const path = await resolveWorkspacePath(
        preview.outputDirectory,
        candidate,
      );
      const types: Readonly<Record<string, string>> = {
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
      reply
        .header(
          'content-security-policy',
          "sandbox allow-scripts; default-src 'self' data: blob:; object-src 'none'; base-uri 'none'",
        )
        .header('x-content-type-options', 'nosniff')
        .header('cache-control', 'no-store')
        .type(types[extname(path).toLowerCase()] ?? 'application/octet-stream');
      return await readFile(path);
    },
  );
}
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

import { resolveWorkspacePath } from '@blog-studio/adapter-command';
