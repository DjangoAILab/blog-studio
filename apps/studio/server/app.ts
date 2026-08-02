import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { dirname, join } from 'node:path';

import cookie from '@fastify/cookie';
import staticFiles from '@fastify/static';
import { AssetPolicyError } from '@blog-studio/assets';
import { BlogStudioError } from '@blog-studio/core';
import {
  ActiveReleaseConflictError,
  RevisionConflictError,
  SqliteDraftRepository,
  SqliteReleaseRepository,
  openStudioDatabase,
} from '@blog-studio/persistence';
import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from 'fastify';

import { registerApiRoutes } from './routes/api.js';
import { PreviewService } from './services/previews.js';
import {
  BaselineAdoptionRequiredError,
  BaselineAlreadyAdoptedError,
  ReleaseService,
  type ReleaseServiceOptions,
} from './services/releases.js';
import {
  WorkspaceService,
  type AssetProviderFactory,
} from './services/workspaces.js';

const SESSION_COOKIE = 'blog_studio_session';
const CSRF_COOKIE = 'blog_studio_csrf';
const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface StudioServerOptions {
  readonly configurationPaths: readonly string[];
  readonly allowedWorkspaceRoot: string;
  readonly databasePath: string;
  readonly releaseStateDirectory?: string;
  readonly authToken: string;
  readonly cookieSecret: string;
  readonly allowedOrigins: readonly string[];
  readonly secureCookies?: boolean;
  readonly clientDirectory?: string;
  readonly logger?: FastifyServerOptions['logger'];
  readonly releaseVerifierFactory?: ReleaseServiceOptions['verifierFactory'];
  readonly assetFactories?: Readonly<Record<string, AssetProviderFactory>>;
  readonly publisherFactories?: ReleaseServiceOptions['publisherFactories'];
  readonly cacheFactories?: ReleaseServiceOptions['cacheFactories'];
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
    bodyLimit: 13 * 1024 * 1024,
    logger,
    trustProxy: true,
  });
  app.addContentTypeParser(
    /^image\/(?:png|jpeg|webp)(?:;.*)?$/,
    { parseAs: 'buffer' },
    (_request, body, done) => done(null, body),
  );
  await app.register(cookie, { secret: options.cookieSecret });

  const workspaces = await WorkspaceService.load({
    configurationPaths: options.configurationPaths,
    allowedWorkspaceRoot: options.allowedWorkspaceRoot,
    ...(options.assetFactories
      ? { assetFactories: options.assetFactories }
      : {}),
  });
  const database = openStudioDatabase(options.databasePath);
  const drafts = new SqliteDraftRepository(database);
  const previews = new PreviewService(workspaces);
  const releases = new ReleaseService({
    workspaces,
    repository: new SqliteReleaseRepository(database),
    drafts,
    stateDirectory:
      options.releaseStateDirectory ??
      join(dirname(options.databasePath), 'release-state'),
    ...(options.releaseVerifierFactory
      ? { verifierFactory: options.releaseVerifierFactory }
      : {}),
    ...(options.publisherFactories
      ? { publisherFactories: options.publisherFactories }
      : {}),
    ...(options.cacheFactories
      ? { cacheFactories: options.cacheFactories }
      : {}),
  });
  await releases.recover();
  const previewReaper = setInterval(() => {
    void previews.reapExpired().catch((error: unknown) => {
      app.log.error({ err: error }, 'Failed to reap expired previews');
    });
  }, 60_000);
  previewReaper.unref();
  app.addHook('onClose', async () => {
    clearInterval(previewReaper);
    await previews.dispose();
    await releases.dispose();
    database.close();
  });

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
    if (!path?.startsWith('/api/')) return;
    if (path === '/api/health' || path === '/api/session') return;
    if (request.method === 'GET' && path.startsWith('/api/previews/')) return;

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

  app.setErrorHandler((error, request, reply) => {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const validationError =
      error !== null && typeof error === 'object' && 'validation' in error;
    const declaredStatus =
      error !== null &&
      typeof error === 'object' &&
      'statusCode' in error &&
      typeof error.statusCode === 'number' &&
      error.statusCode >= 400 &&
      error.statusCode < 500
        ? error.statusCode
        : undefined;
    const status =
      error instanceof RevisionConflictError
        ? 409
        : error instanceof BlogStudioError && error.code === 'DOCUMENT_CONFLICT'
          ? 409
          : error instanceof ActiveReleaseConflictError
            ? 409
            : error instanceof BaselineAdoptionRequiredError ||
                error instanceof BaselineAlreadyAdoptedError ||
                message ===
                  'Existing deployment baseline must be adopted before publishing' ||
                message === 'A verified baseline already exists'
              ? 409
              : error instanceof AssetPolicyError
                ? error.code === 'ASSET_TOO_LARGE'
                  ? 413
                  : 422
                : message === 'Draft source revision conflict'
                  ? 409
                  : message.startsWith('Invalid Hexo document date:')
                    ? 422
                    : validationError
                      ? 400
                      : declaredStatus !== undefined
                        ? declaredStatus
                        : /^(Unknown|Unsupported)/.test(message)
                          ? 404
                          : 500;
    if (status === 500)
      request.log.error({ err: error }, 'Unhandled Studio request error');
    void reply.code(status).send({
      type: 'about:blank',
      title: status === 500 ? 'Internal server error' : message,
      status,
      ...(error instanceof RevisionConflictError ||
      error instanceof BlogStudioError
        ? { code: error.code, details: error.details }
        : {}),
    });
  });

  registerApiRoutes(app, {
    workspaces,
    drafts,
    previews,
    releases,
  });

  if (options.clientDirectory) {
    await app.register(staticFiles, {
      root: options.clientDirectory,
      index: false,
      immutable: true,
      maxAge: '30d',
      setHeaders(reply) {
        reply.header(
          'Content-Security-Policy',
          "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self' data:; form-action 'self'; frame-ancestors 'none'; frame-src 'self'; img-src 'self' data: blob:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'",
        );
        reply.header('X-Content-Type-Options', 'nosniff');
      },
    });
    app.get('/', (_request, reply) =>
      reply.sendFile('index.html', { immutable: false, maxAge: 0 }),
    );
  }

  return app;
}
