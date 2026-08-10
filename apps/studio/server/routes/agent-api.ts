import type { FastifyInstance } from 'fastify';
import type { AgentAttachmentRecord } from '@blog-studio/persistence';

import type {
  AgentPublishedEvent,
  SiteAgentSessionService,
} from '../services/site-agent-sessions.js';
import type { SiteAgentMessageContext } from '../services/site-agent-context.js';

const siteSessionParams = {
  type: 'object',
  additionalProperties: false,
  required: ['siteId', 'sessionId'],
  properties: {
    siteId: { type: 'string', pattern: '^site-[a-z0-9-]+$' },
    sessionId: {
      type: 'string',
      pattern: '^agent-session-[a-f0-9-]+$',
    },
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

const turnParams = {
  type: 'object',
  additionalProperties: false,
  required: ['siteId', 'sessionId', 'turnId'],
  properties: {
    ...siteSessionParams.properties,
    turnId: { type: 'string', pattern: '^agent-turn-[a-f0-9-]+$' },
  },
} as const;

const attachmentParams = {
  type: 'object',
  additionalProperties: false,
  required: ['siteId', 'sessionId', 'attachmentId'],
  properties: {
    ...siteSessionParams.properties,
    attachmentId: {
      type: 'string',
      pattern: '^agent-attachment-[a-f0-9-]+$',
    },
  },
} as const;

const messageContextSchema = {
  anyOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'documentId', 'collectionId'],
      properties: {
        type: { const: 'article' },
        documentId: { type: 'string', minLength: 1, maxLength: 512 },
        collectionId: { type: 'string', minLength: 1, maxLength: 256 },
        title: { type: 'string', maxLength: 1_000 },
        path: { type: 'string', maxLength: 2_000 },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: [
        'type',
        'documentId',
        'collectionId',
        'sourceRevision',
        'body',
      ],
      properties: {
        type: { const: 'editor-buffer' },
        documentId: { type: 'string', minLength: 1, maxLength: 512 },
        collectionId: { type: 'string', minLength: 1, maxLength: 256 },
        sourceRevision: { type: 'string', minLength: 1, maxLength: 512 },
        body: { type: 'string', maxLength: 120_000 },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'documentId', 'startLine', 'endLine', 'text'],
      properties: {
        type: { const: 'markdown-selection' },
        documentId: { type: 'string', minLength: 1, maxLength: 512 },
        startLine: { type: 'integer', minimum: 1 },
        endLine: { type: 'integer', minimum: 1 },
        text: { type: 'string', minLength: 1, maxLength: 60_000 },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'message'],
      properties: {
        type: { const: 'preview-error' },
        message: { type: 'string', minLength: 1, maxLength: 20_000 },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'content'],
      properties: {
        type: { const: 'diff' },
        content: { type: 'string', minLength: 1, maxLength: 100_000 },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'changeSetId'],
      properties: {
        type: { const: 'change-set' },
        changeSetId: { type: 'string', minLength: 1, maxLength: 512 },
        summary: { type: 'string', maxLength: 20_000 },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'path'],
      properties: {
        type: { const: 'file' },
        path: { type: 'string', minLength: 1, maxLength: 2_000 },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'attachmentId'],
      properties: {
        type: { type: 'string', enum: ['attachment', 'image'] },
        attachmentId: {
          type: 'string',
          pattern: '^agent-attachment-[a-f0-9-]+$',
        },
      },
    },
  ],
} as const;

function writeSse(
  raw: NodeJS.WritableStream,
  event: AgentPublishedEvent,
): void {
  raw.write(`id: ${event.sequence}\n`);
  raw.write(`event: ${event.type}\n`);
  raw.write(`data: ${JSON.stringify(event)}\n\n`);
}

function publicAttachment(
  attachment: AgentAttachmentRecord,
): Omit<AgentAttachmentRecord, 'storageKey'> {
  const { storageKey: _storageKey, ...view } = attachment;
  void _storageKey;
  return view;
}

export function registerAgentApiRoutes(
  app: FastifyInstance,
  sessions: SiteAgentSessionService,
): void {
  const rateWindows = new Map<string, { count: number; expiresAt: number }>();
  app.addHook('onRequest', (request, reply, done) => {
    if (!request.url.includes('/agent/')) {
      done();
      return;
    }
    const now = Date.now();
    const key = `${request.ip}:${request.method === 'GET' ? 'read' : 'write'}`;
    const current = rateWindows.get(key);
    const window =
      current && current.expiresAt > now
        ? current
        : { count: 0, expiresAt: now + 60_000 };
    window.count++;
    rateWindows.set(key, window);
    const limit = request.method === 'GET' ? 300 : 120;
    if (window.count <= limit) {
      done();
      return;
    }
    void reply
      .header('retry-after', Math.ceil((window.expiresAt - now) / 1000))
      .code(429)
      .send({
        type: 'about:blank',
        title: 'Agent API rate limit exceeded',
        status: 429,
      });
  });
  app.get<{ Params: { siteId: string } }>(
    '/api/sites/:siteId/agent/preferences',
    { schema: { params: siteParams } },
    (request) => sessions.preferenceDefaults(request.params.siteId),
  );

  app.put<{
    Params: { siteId: string };
    Body: {
      scope: 'global' | 'site';
      mode: 'approval' | 'yolo' | null;
    };
  }>(
    '/api/sites/:siteId/agent/preferences',
    {
      schema: {
        params: siteParams,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['scope', 'mode'],
          properties: {
            scope: { type: 'string', enum: ['global', 'site'] },
            mode: {
              anyOf: [
                { type: 'string', enum: ['approval', 'yolo'] },
                { type: 'null' },
              ],
            },
          },
        },
      },
    },
    (request, reply) => {
      if (request.body.scope === 'global') {
        if (!request.body.mode) {
          return reply.code(422).send({
            type: 'about:blank',
            title: 'The global Agent mode cannot inherit from another scope',
            status: 422,
          });
        }
        sessions.setGlobalApprovalMode(
          request.params.siteId,
          request.body.mode,
        );
      } else {
        sessions.setSiteApprovalMode(request.params.siteId, request.body.mode);
      }
      return sessions.preferenceDefaults(request.params.siteId);
    },
  );
  app.get<{
    Params: { siteId: string };
    Querystring: { includeArchived?: boolean };
  }>(
    '/api/sites/:siteId/agent/sessions',
    {
      schema: {
        params: siteParams,
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { includeArchived: { type: 'boolean' } },
        },
      },
    },
    (request) => ({
      sessions: sessions.list(
        request.params.siteId,
        request.query.includeArchived ?? false,
      ),
    }),
  );

  app.post<{
    Params: { siteId: string };
    Body: { displayName: string; approvalMode?: 'approval' | 'yolo' };
  }>(
    '/api/sites/:siteId/agent/sessions',
    {
      schema: {
        params: siteParams,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['displayName'],
          properties: {
            displayName: { type: 'string', minLength: 1, maxLength: 120 },
            approvalMode: { type: 'string', enum: ['approval', 'yolo'] },
          },
        },
      },
    },
    async (request, reply) =>
      reply.code(201).send(
        await sessions.create({
          siteId: request.params.siteId,
          displayName: request.body.displayName,
          ...(request.body.approvalMode
            ? { approvalMode: request.body.approvalMode }
            : {}),
        }),
      ),
  );

  app.get<{ Params: { siteId: string; sessionId: string } }>(
    '/api/sites/:siteId/agent/sessions/:sessionId',
    { schema: { params: siteSessionParams } },
    (request) =>
      sessions.details(request.params.siteId, request.params.sessionId),
  );

  app.patch<{
    Params: { siteId: string; sessionId: string };
    Body: { displayName?: string; approvalMode?: 'approval' | 'yolo' | null };
  }>(
    '/api/sites/:siteId/agent/sessions/:sessionId',
    {
      schema: {
        params: siteSessionParams,
        body: {
          type: 'object',
          additionalProperties: false,
          minProperties: 1,
          properties: {
            displayName: { type: 'string', minLength: 1, maxLength: 120 },
            approvalMode: {
              anyOf: [
                { type: 'string', enum: ['approval', 'yolo'] },
                { type: 'null' },
              ],
            },
          },
        },
      },
    },
    (request) => {
      let session = request.body.displayName
        ? sessions.rename(
            request.params.siteId,
            request.params.sessionId,
            request.body.displayName,
          )
        : undefined;
      if (request.body.approvalMode !== undefined) {
        session = sessions.setSessionApprovalMode(
          request.params.siteId,
          request.params.sessionId,
          request.body.approvalMode,
        );
      }
      return session;
    },
  );

  app.post<{ Params: { siteId: string; sessionId: string } }>(
    '/api/sites/:siteId/agent/sessions/:sessionId/archive',
    { schema: { params: siteSessionParams } },
    (request) =>
      sessions.archive(request.params.siteId, request.params.sessionId),
  );

  app.post<{ Params: { siteId: string; sessionId: string } }>(
    '/api/sites/:siteId/agent/sessions/:sessionId/restore',
    { schema: { params: siteSessionParams } },
    (request) =>
      sessions.restore(request.params.siteId, request.params.sessionId),
  );

  app.post<{
    Params: { siteId: string; sessionId: string };
    Body: {
      text: string;
      contexts?: SiteAgentMessageContext[];
      attachmentIds?: string[];
    };
  }>(
    '/api/sites/:siteId/agent/sessions/:sessionId/messages',
    {
      schema: {
        params: siteSessionParams,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['text'],
          properties: {
            text: { type: 'string', minLength: 1, maxLength: 200_000 },
            contexts: {
              type: 'array',
              maxItems: 16,
              items: messageContextSchema,
            },
            attachmentIds: {
              type: 'array',
              maxItems: 8,
              uniqueItems: true,
              items: {
                type: 'string',
                pattern: '^agent-attachment-[a-f0-9-]+$',
              },
            },
          },
        },
      },
    },
    (request, reply) =>
      reply.code(202).send(
        sessions.submitMessage({
          siteId: request.params.siteId,
          sessionId: request.params.sessionId,
          text: request.body.text,
          ...(request.body.contexts ? { contexts: request.body.contexts } : {}),
          ...(request.body.attachmentIds
            ? { attachmentIds: request.body.attachmentIds }
            : {}),
        }),
      ),
  );

  app.post<{
    Params: { siteId: string; sessionId: string };
    Body: Buffer;
  }>(
    '/api/sites/:siteId/agent/sessions/:sessionId/attachments',
    { schema: { params: siteSessionParams } },
    async (request, reply) => {
      const encodedFilename = request.headers['x-blog-studio-filename'];
      if (typeof encodedFilename !== 'string') {
        return reply.code(400).send({
          type: 'about:blank',
          title: 'Missing Agent attachment filename',
          status: 400,
        });
      }
      let filename: string;
      try {
        filename = decodeURIComponent(encodedFilename);
      } catch {
        return reply.code(400).send({
          type: 'about:blank',
          title: 'Invalid Agent attachment filename encoding',
          status: 400,
        });
      }
      if (!Buffer.isBuffer(request.body)) {
        return reply.code(400).send({
          type: 'about:blank',
          title: 'Agent attachment body must be binary data',
          status: 400,
        });
      }
      const attachment = await sessions.uploadAttachment({
        siteId: request.params.siteId,
        sessionId: request.params.sessionId,
        filename,
        claimedMimeType:
          request.headers['content-type'] ?? 'application/octet-stream',
        bytes: request.body,
      });
      return reply.code(201).send({
        attachment: publicAttachment(attachment),
      });
    },
  );

  app.get<{
    Params: { siteId: string; sessionId: string; attachmentId: string };
  }>(
    '/api/sites/:siteId/agent/sessions/:sessionId/attachments/:attachmentId',
    { schema: { params: attachmentParams } },
    async (request, reply) => {
      const { attachment, bytes } = await sessions.attachmentBytes(
        request.params.siteId,
        request.params.sessionId,
        request.params.attachmentId,
      );
      return reply
        .header('cache-control', 'private, no-store')
        .header('x-content-type-options', 'nosniff')
        .type(attachment.mimeType)
        .send(bytes);
    },
  );

  app.post<{
    Params: { siteId: string; sessionId: string; attachmentId: string };
  }>(
    '/api/sites/:siteId/agent/sessions/:sessionId/attachments/:attachmentId/vision/retry',
    { schema: { params: attachmentParams } },
    async (request) => ({
      attachment: publicAttachment(await sessions.retryVision(request.params)),
    }),
  );

  app.post<{
    Params: { siteId: string; sessionId: string; turnId: string };
  }>(
    '/api/sites/:siteId/agent/sessions/:sessionId/turns/:turnId/cancel',
    { schema: { params: turnParams } },
    async (request, reply) =>
      reply
        .code(200)
        .send(
          await sessions.cancel(
            request.params.siteId,
            request.params.sessionId,
            request.params.turnId,
          ),
        ),
  );

  app.post<{
    Params: {
      siteId: string;
      sessionId: string;
      turnId: string;
      toolCallId: string;
    };
    Body: { decision: 'approved' | 'rejected' };
  }>(
    '/api/sites/:siteId/agent/sessions/:sessionId/turns/:turnId/approvals/:toolCallId',
    {
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['siteId', 'sessionId', 'turnId', 'toolCallId'],
          properties: {
            ...turnParams.properties,
            toolCallId: { type: 'string', minLength: 1, maxLength: 256 },
          },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['decision'],
          properties: {
            decision: { type: 'string', enum: ['approved', 'rejected'] },
          },
        },
      },
    },
    (request) =>
      sessions.decideApproval({ ...request.params, ...request.body }),
  );

  app.get<{
    Params: { siteId: string; sessionId: string };
    Querystring: { after?: number };
  }>(
    '/api/sites/:siteId/agent/sessions/:sessionId/events',
    {
      schema: {
        params: siteSessionParams,
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { after: { type: 'integer', minimum: 0 } },
        },
      },
    },
    (request, reply) => {
      const { siteId, sessionId } = request.params;
      let cursor = request.query.after ?? 0;
      const initial = sessions.events(siteId, sessionId, cursor);
      const initiallyActive = sessions.activeTurn(siteId, sessionId);
      reply.hijack();
      reply.raw.writeHead(200, {
        'cache-control': 'no-cache, no-store',
        connection: 'keep-alive',
        'content-type': 'text/event-stream; charset=utf-8',
        'x-accel-buffering': 'no',
        'x-content-type-options': 'nosniff',
      });
      const send = (event: AgentPublishedEvent) => {
        if (event.sequence <= cursor) return;
        cursor = event.sequence;
        writeSse(reply.raw, event);
        if (event.payload.terminal === true) close();
      };
      let closed = false;
      let unsubscribe = () => {};
      const close = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        reply.raw.end();
      };
      request.raw.once('close', close);
      unsubscribe = sessions.subscribe(sessionId, send);
      for (const event of initial) send(event);
      if (closed) return;
      for (const event of sessions.events(siteId, sessionId, cursor))
        send(event);
      if (closed) return;
      const active = sessions.activeTurn(siteId, sessionId);
      if (!active && !initiallyActive) {
        reply.raw.write(
          `event: snapshot\ndata: ${JSON.stringify({ terminal: true, cursor })}\n\n`,
        );
        close();
      }
    },
  );
}
