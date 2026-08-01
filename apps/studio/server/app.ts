import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import cookie from '@fastify/cookie';
import {
  RevisionConflictError,
  SqliteDraftRepository,
  openStudioDatabase,
} from '@blog-studio/persistence';
import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from 'fastify';

import { registerApiRoutes } from './routes/api.js';
import { PreviewService } from './services/previews.js';
import { WorkspaceService } from './services/workspaces.js';

const SESSION_COOKIE = 'blog_studio_session';
const CSRF_COOKIE = 'blog_studio_csrf';
const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface StudioServerOptions {
  readonly configurationPaths: readonly string[];
  readonly allowedWorkspaceRoot: string;
  readonly databasePath: string;
  readonly authToken: string;
  readonly cookieSecret: string;
  readonly allowedOrigins: readonly string[];
  readonly secureCookies?: boolean;
  readonly logger?: FastifyServerOptions['logger'];
}

function equalSecret(left: string, right: string): boolean {
  const leftHash = createHash('sha256').update(left).digest();
  const rightHash = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

export async function createStudioServer(
  options: StudioServerOptions,
): Promise<FastifyInstance> {
  if (options.authToken.length < 16)
    throw new Error('Authentication token must contain at least 16 characters');
  if (options.cookieSecret.length < 32)
    throw new Error('Cookie secret must contain at least 32 characters');
  if (options.allowedOrigins.length === 0)
    throw new Error('At least one browser origin must be allowed');

  const logger =
    options.logger === undefined || options.logger === false
      ? false
      : {
          ...(options.logger === true ? {} : options.logger),
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.headers.x-csrf-token',
              'req.body.token',
              'res.headers.set-cookie',
              'body.token',
            ],
            censor: '[REDACTED]',
          },
        };
  const app = Fastify({
    bodyLimit: 2 * 1024 * 1024,
    logger,
    trustProxy: true,
  });
  await app.register(cookie, { secret: options.cookieSecret });

  const workspaces = await WorkspaceService.load({
    configurationPaths: options.configurationPaths,
    allowedWorkspaceRoot: options.allowedWorkspaceRoot,
  });
  const database = openStudioDatabase(options.databasePath);
  app.addHook('onClose', () => database.close());

  app.post<{ Body: { token: string } }>(
    '/api/session',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['token'],
          properties: { token: { type: 'string', maxLength: 1024 } },
        },
      },
    },
    async (request, reply) => {
      const origin = request.headers.origin;
      if (!origin || !options.allowedOrigins.includes(origin)) {
        return reply.code(403).send({
          type: 'about:blank',
          title: 'Origin rejected',
          status: 403,
        });
      }
      if (!equalSecret(request.body.token, options.authToken)) {
        return reply.code(401).send({
          type: 'about:blank',
          title: 'Authentication failed',
          status: 401,
        });
      }

      const cookieOptions = {
        path: '/',
        sameSite: 'strict' as const,
        secure: options.secureCookies ?? true,
        signed: true,
      };
      const csrf = randomBytes(32).toString('base64url');
      reply.setCookie(SESSION_COOKIE, 'authenticated', {
        ...cookieOptions,
        httpOnly: true,
      });
      reply.setCookie(CSRF_COOKIE, csrf, {
        ...cookieOptions,
        httpOnly: false,
      });
      return { authenticated: true, csrfToken: csrf };
    },
  );

  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0];
    if (path === '/api/health' || path === '/api/session') return;

    const session = request.cookies[SESSION_COOKIE];
    if (!session) {
      await reply.code(401).send({
        type: 'about:blank',
        title: 'Authentication required',
        status: 401,
      });
      return;
    }
    const unsignedSession = request.unsignCookie(session);
    if (!unsignedSession.valid || unsignedSession.value !== 'authenticated') {
      await reply.code(401).send({
        type: 'about:blank',
        title: 'Authentication required',
        status: 401,
      });
      return;
    }

    if (!unsafeMethods.has(request.method)) return;
    const origin = request.headers.origin;
    const csrfCookie = request.cookies[CSRF_COOKIE];
    const csrfHeader = request.headers['x-csrf-token'];
    const csrf = csrfCookie ? request.unsignCookie(csrfCookie) : undefined;
    if (
      !origin ||
      !options.allowedOrigins.includes(origin) ||
      !csrf?.valid ||
      typeof csrfHeader !== 'string' ||
      !equalSecret(csrf.value, csrfHeader)
    ) {
      await reply.code(403).send({
        type: 'about:blank',
        title: 'CSRF validation failed',
        status: 403,
      });
    }
  });

  registerApiRoutes(app, {
    workspaces,
    drafts: new SqliteDraftRepository(database),
    previews: new PreviewService(workspaces),
  });

  app.setErrorHandler((error, _request, reply) => {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const validationError =
      error !== null && typeof error === 'object' && 'validation' in error;
    const status =
      error instanceof RevisionConflictError
        ? 409
        : validationError
          ? 400
          : /^(Unknown|Unsupported)/.test(message)
            ? 404
            : 500;
    void reply.code(status).send({
      type: 'about:blank',
      title: status === 500 ? 'Internal server error' : message,
      status,
      ...(error instanceof RevisionConflictError
        ? { code: error.code, details: error.details }
        : {}),
    });
  });

  return app;
}
