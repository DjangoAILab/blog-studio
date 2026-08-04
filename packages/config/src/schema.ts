import { isAbsolute, normalize } from 'node:path';

import { z } from 'zod';

export const CONFIG_SCHEMA_VERSION = 1 as const;

const adapterIdSchema = z
  .string()
  .min(1)
  .regex(
    /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/,
    'Adapter ID must use lowercase kebab-case',
  );

const environmentVariableSchema = z
  .string()
  .regex(
    /^[A-Z_][A-Z0-9_]*$/,
    'Credential env must be a valid environment variable name',
  );

export const secretReferenceSchema = z
  .object({
    env: environmentVariableSchema,
  })
  .strict();

const relativeWorkspacePathSchema = z
  .string()
  .min(1)
  .refine((value) => {
    const normalized = normalize(value);
    return !isAbsolute(value) && !/^\.\.(?:[\\/]|$)/.test(normalized);
  }, 'Path must stay relative to the workspace root');

const jsonValueSchema = z.json();

export const adapterConfigurationSchema = z
  .object({
    adapter: adapterIdSchema,
    options: z.record(z.string(), jsonValueSchema).default({}),
    credentials: z.record(z.string().min(1), secretReferenceSchema).optional(),
  })
  .strict();

const collectionSchema = z
  .object({
    path: relativeWorkspacePathSchema,
    draftPath: relativeWorkspacePathSchema.optional(),
    assetScope: z.string().min(1).optional(),
  })
  .strict();

const httpUrlSchema = z.url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === 'http:' || protocol === 'https:';
}, 'URL must use HTTP or HTTPS');

export const blogStudioConfigSchema = z
  .object({
    version: z.literal(CONFIG_SCHEMA_VERSION),
    site: z
      .object({
        displayName: z.string().trim().min(1).max(120),
        canonicalUrl: httpUrlSchema.optional(),
      })
      .strict()
      .optional(),
    workspace: z
      .object({
        id: z
          .string()
          .min(1)
          .max(64)
          .regex(
            /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/,
            'Workspace ID must use lowercase kebab-case',
          ),
        root: z
          .string()
          .min(1)
          .refine(isAbsolute, 'Workspace root must be an absolute path'),
      })
      .strict(),
    generator: adapterConfigurationSchema,
    repository: adapterConfigurationSchema,
    assets: adapterConfigurationSchema,
    publish: adapterConfigurationSchema,
    cache: adapterConfigurationSchema.optional(),
    content: z
      .object({
        collections: z.record(z.string().min(1), collectionSchema),
      })
      .strict()
      .optional(),
    verification: z
      .object({
        baseUrl: httpUrlSchema,
      })
      .strict()
      .optional(),
  })
  .strict();

export type BlogStudioConfig = z.infer<typeof blogStudioConfigSchema>;
export type AdapterConfiguration = z.infer<typeof adapterConfigurationSchema>;

export function parseBlogStudioConfig(input: unknown): BlogStudioConfig {
  return blogStudioConfigSchema.parse(input);
}
