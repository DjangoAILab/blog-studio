import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createStudioServer, type StudioAuthenticationMode } from './app.js';
import { createTencentProviderFactories } from './providers/tencent.js';
import { OpenAiCompatibleVisionAdapter } from './services/site-agent-vision.js';

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requiredSecret(name: string): string {
  const direct = process.env[name]?.trim();
  if (direct) return direct;
  const file = process.env[`${name}_FILE`]?.trim();
  if (!file) throw new Error(`${name} or ${name}_FILE is required`);
  const value = readFileSync(file, 'utf8').trim();
  if (!value) throw new Error(`${name}_FILE must not be empty`);
  return value;
}

function optionalSecret(name: string): string | undefined {
  const direct = process.env[name]?.trim();
  if (direct) return direct;
  const file = process.env[`${name}_FILE`]?.trim();
  if (!file) return undefined;
  const value = readFileSync(file, 'utf8').trim();
  if (!value) throw new Error(`${name}_FILE must not be empty`);
  return value;
}

function listEnvironment(name: string): readonly string[] {
  const values = requiredEnvironment(name)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (values.length === 0) throw new Error(`${name} must contain a value`);
  return values;
}

function portEnvironment(): number {
  const value = Number.parseInt(process.env.BLOG_STUDIO_PORT ?? '4310', 10);
  if (!Number.isInteger(value) || value < 1 || value > 65_535)
    throw new Error('BLOG_STUDIO_PORT must be a valid TCP port');
  return value;
}

function authenticationModeEnvironment(): StudioAuthenticationMode {
  const value = process.env.BLOG_STUDIO_AUTH_MODE?.trim() || 'none';
  if (value !== 'none' && value !== 'password')
    throw new Error('BLOG_STUDIO_AUTH_MODE must be either none or password');
  return value;
}

const providerFactories = createTencentProviderFactories();
const legacyAuthToken = optionalSecret('BLOG_STUDIO_AUTH_TOKEN');
const agentRuntimeDirectory =
  process.env.BLOG_STUDIO_AGENT_RUNTIME_DIRECTORY?.trim();
const visionEndpoint = process.env.BLOG_STUDIO_VISION_ENDPOINT?.trim();
const visionApiKey = optionalSecret('BLOG_STUDIO_VISION_API_KEY');
const app = await createStudioServer({
  configurationPaths: listEnvironment('BLOG_STUDIO_CONFIG_PATHS'),
  allowedWorkspaceRoot: requiredEnvironment('BLOG_STUDIO_WORKSPACE_ROOT'),
  databasePath: requiredEnvironment('BLOG_STUDIO_DATABASE_PATH'),
  authenticationMode: authenticationModeEnvironment(),
  ...(legacyAuthToken ? { authToken: legacyAuthToken } : {}),
  cookieSecret: requiredSecret('BLOG_STUDIO_COOKIE_SECRET'),
  allowedOrigins: listEnvironment('BLOG_STUDIO_ALLOWED_ORIGINS'),
  secureCookies: process.env.BLOG_STUDIO_SECURE_COOKIES !== 'false',
  allowLegacyReleaseApi:
    process.env.BLOG_STUDIO_ALLOW_LEGACY_RELEASE_API === 'true',
  clientDirectory: resolve(
    process.env.BLOG_STUDIO_CLIENT_DIRECTORY ??
      fileURLToPath(new URL('../client', import.meta.url)),
  ),
  ...(agentRuntimeDirectory
    ? { agentRuntimeDirectory: resolve(agentRuntimeDirectory) }
    : {}),
  logger: true,
  ...(visionEndpoint
    ? {
        agentVisionAdapter: new OpenAiCompatibleVisionAdapter({
          endpoint: visionEndpoint,
          model: requiredEnvironment('BLOG_STUDIO_VISION_MODEL'),
          ...(visionApiKey ? { apiKey: visionApiKey } : {}),
        }),
      }
    : {}),
  ...providerFactories,
});

await app.listen({
  host: process.env.BLOG_STUDIO_HOST ?? '0.0.0.0',
  port: portEnvironment(),
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().finally(() => process.exit(0));
  });
}
