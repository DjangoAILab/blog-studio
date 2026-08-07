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

const reservedFrontMatterKeys = new Set([
  '__proto__',
  'constructor',
  'prototype',
  'title',
  'date',
  'updated',
  'tags',
  'categories',
]);

const frontMatterKeySchema = z
  .string()
  .min(1)
  .max(80)
  .regex(
    /^[A-Za-z][A-Za-z0-9_-]*$/,
    'Front-matter field keys must start with a letter and use letters, numbers, hyphens, or underscores',
  )
  .refine(
    (value) => !reservedFrontMatterKeys.has(value),
    'Standard front-matter fields are managed by Studio and cannot be redefined',
  );

const frontMatterFieldSchema = z
  .object({
    label: z.string().trim().min(1).max(80),
    type: z.enum(['string', 'number', 'boolean', 'list', 'object']),
    description: z.string().trim().min(1).max(280).optional(),
    required: z.boolean().optional(),
    searchable: z.boolean().optional(),
    sortable: z.boolean().optional(),
    enum: z.array(z.string().trim().min(1).max(120)).min(1).max(100).optional(),
    default: jsonValueSchema.optional(),
  })
  .strict()
  .superRefine((field, context) => {
    if (field.enum && field.type !== 'string' && field.type !== 'list') {
      context.addIssue({
        code: 'custom',
        path: ['enum'],
        message: 'enum is only supported by string and list fields',
      });
    }
    if (
      field.sortable &&
      !['string', 'number', 'boolean'].includes(field.type)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sortable'],
        message: 'Only string, number, and boolean fields are sortable',
      });
    }
    if (field.default === undefined) return;
    const valid =
      (field.type === 'string' && typeof field.default === 'string') ||
      (field.type === 'number' && typeof field.default === 'number') ||
      (field.type === 'boolean' && typeof field.default === 'boolean') ||
      (field.type === 'list' && Array.isArray(field.default)) ||
      (field.type === 'object' &&
        field.default !== null &&
        typeof field.default === 'object' &&
        !Array.isArray(field.default));
    if (!valid) {
      context.addIssue({
        code: 'custom',
        path: ['default'],
        message: `default must match the ${field.type} field type`,
      });
    }
    if (
      field.enum &&
      typeof field.default === 'string' &&
      !field.enum.includes(field.default)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['default'],
        message: 'default must be one of enum values',
      });
    }
  });

const httpUrlSchema = z.url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === 'http:' || protocol === 'https:';
}, 'URL must use HTTP or HTTPS');

const localDevelopmentSchema = z
  .object({
    command: z
      .string()
      .min(1)
      .max(160)
      .regex(
        new RegExp('^(?:[A-Za-z0-9]|/)[A-Za-z0-9._/-]*$'),
        'Development command must be an executable path, not a shell expression',
      ),
    args: z.array(z.string().min(1).max(500)).max(40).default([]),
    baseUrl: httpUrlSchema,
    readinessPath: z
      .string()
      .max(512)
      .regex(
        /^\/[A-Za-z0-9._~!$&'()*+,;=:@/%-]*$/,
        'Readiness path must be an absolute URL path',
      )
      .optional(),
    environmentAllowlist: z
      .array(environmentVariableSchema)
      .max(40)
      .default([]),
    startupTimeoutMs: z.number().int().min(1_000).max(120_000).default(30_000),
    logLimit: z.number().int().min(10).max(2_000).default(500),
  })
  .strict();

/**
 * The owner-controlled portion of a Site configuration. Host configuration
 * retains workspace paths, adapter selection, credentials, publish targets,
 * and all command policy; keeping this schema narrow makes secret/path
 * exfiltration impossible through the Studio UI.
 */
export const ownerSiteConfigurationSchema = z
  .object({
    version: z.literal(CONFIG_SCHEMA_VERSION),
    content: z
      .object({
        fields: z
          .record(frontMatterKeySchema, frontMatterFieldSchema)
          .default({}),
      })
      .strict()
      .default({ fields: {} }),
    development: localDevelopmentSchema.optional(),
  })
  .strict();

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
    resources: z
      .object({
        maxInputBytes: z
          .number()
          .int()
          .positive()
          .max(100 * 1024 * 1024),
        allowedMediaTypes: z
          .array(
            z.enum([
              'image/png',
              'image/jpeg',
              'image/webp',
              'application/pdf',
              'application/zip',
              'text/plain',
            ]),
          )
          .min(1),
        inlinePreviewMediaTypes: z
          .array(
            z.enum([
              'image/png',
              'image/jpeg',
              'image/webp',
              'application/pdf',
              'application/zip',
              'text/plain',
            ]),
          )
          .optional(),
      })
      .strict()
      .superRefine((policy, context) => {
        for (const mediaType of policy.inlinePreviewMediaTypes ?? []) {
          if (!policy.allowedMediaTypes.includes(mediaType)) {
            context.addIssue({
              code: 'custom',
              path: ['inlinePreviewMediaTypes'],
              message: `${mediaType} must also appear in allowedMediaTypes`,
            });
          }
        }
      })
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
        fields: z
          .record(frontMatterKeySchema, frontMatterFieldSchema)
          .optional(),
      })
      .strict()
      .optional(),
    development: localDevelopmentSchema.optional(),
    verification: z
      .object({
        baseUrl: httpUrlSchema,
      })
      .strict()
      .optional(),
  })
  .strict();

export type BlogStudioConfig = z.infer<typeof blogStudioConfigSchema>;
export type OwnerSiteConfiguration = z.infer<
  typeof ownerSiteConfigurationSchema
>;
export type AdapterConfiguration = z.infer<typeof adapterConfigurationSchema>;

export function parseBlogStudioConfig(input: unknown): BlogStudioConfig {
  return blogStudioConfigSchema.parse(input);
}

export function parseOwnerSiteConfiguration(
  input: unknown,
): OwnerSiteConfiguration {
  return ownerSiteConfigurationSchema.parse(input);
}
