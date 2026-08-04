import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import {
  assertKnownAdapters,
  createBlogStudioJsonSchema,
  parseBlogStudioConfig,
  parseBlogStudioConfigYaml,
  type BlogStudioConfig,
} from '../src/index.js';

const validConfig = {
  version: 1,
  workspace: {
    id: 'personal-blog',
    root: '/workspaces/personal-blog',
  },
  generator: {
    adapter: 'hexo',
    options: {
      config: '_config.yml',
    },
  },
  repository: {
    adapter: 'local-git',
    options: {
      remote: 'origin',
    },
  },
  assets: {
    adapter: 'tencent-cos',
    credentials: {
      secretId: { env: 'TENCENT_SECRET_ID' },
      secretKey: { env: 'TENCENT_SECRET_KEY' },
    },
    options: {
      keyPrefix: 'media/posts',
    },
  },
  publish: {
    adapter: 'tencent-cos',
  },
  cache: {
    adapter: 'tencent-cdn',
  },
  content: {
    collections: {
      posts: {
        path: 'source/_posts',
        assetScope: 'media/posts/{documentId}',
      },
    },
  },
  verification: {
    baseUrl: 'https://blog.example.com',
  },
} as const;

describe('blog-studio configuration schema', () => {
  it('parses and normalizes a valid v1 configuration', () => {
    const result = parseBlogStudioConfig(validConfig);

    expect(result.version).toBe(1);
    expect(result.generator.options).toEqual({ config: '_config.yml' });
    expect(result.publish.options).toEqual({});
  });

  it('accepts optional user-facing Site identity without requiring it from v0.1', () => {
    const legacy = parseBlogStudioConfig(validConfig);
    expect(legacy.site).toBeUndefined();

    const withSite = parseBlogStudioConfig({
      ...validConfig,
      site: {
        displayName: '王二的博客',
        canonicalUrl: 'https://blog.wj2015.com',
      },
    });
    expect(withSite.site).toEqual({
      displayName: '王二的博客',
      canonicalUrl: 'https://blog.wj2015.com',
    });
    expect(() =>
      parseBlogStudioConfig({
        ...validConfig,
        site: { displayName: '', canonicalUrl: 'file:///tmp/blog' },
      }),
    ).toThrow();
    expect(() =>
      parseBlogStudioConfig({
        ...validConfig,
        resources: {
          maxInputBytes: 1024,
          allowedMediaTypes: ['text/plain'],
          inlinePreviewMediaTypes: ['application/pdf'],
        },
      }),
    ).toThrow();
  });

  it('accepts a bounded generic resource policy', () => {
    const result = parseBlogStudioConfig({
      ...validConfig,
      resources: {
        maxInputBytes: 8 * 1024 * 1024,
        allowedMediaTypes: ['image/png', 'application/pdf', 'text/plain'],
        inlinePreviewMediaTypes: ['image/png'],
      },
    });
    expect(result.resources).toEqual({
      maxInputBytes: 8 * 1024 * 1024,
      allowedMediaTypes: ['image/png', 'application/pdf', 'text/plain'],
      inlinePreviewMediaTypes: ['image/png'],
    });
    expect(() =>
      parseBlogStudioConfig({
        ...validConfig,
        resources: {
          maxInputBytes: 0,
          allowedMediaTypes: ['application/x-executable'],
        },
      }),
    ).toThrow();
  });

  it('parses YAML using the same strict schema', () => {
    const result = parseBlogStudioConfigYaml(`
version: 1
workspace:
  id: personal-blog
  root: /workspaces/personal-blog
generator:
  adapter: hexo
repository:
  adapter: local-git
assets:
  adapter: filesystem
publish:
  adapter: filesystem
`);

    expect(result.workspace.id).toBe('personal-blog');
    expect(result.assets.options).toEqual({});
  });

  it('rejects unknown top-level keys', () => {
    expect(() =>
      parseBlogStudioConfig({ ...validConfig, surprise: true }),
    ).toThrow(ZodError);
  });

  it('rejects a relative or traversal workspace root', () => {
    expect(() =>
      parseBlogStudioConfig({
        ...validConfig,
        workspace: { ...validConfig.workspace, root: '../personal-blog' },
      }),
    ).toThrow(/absolute path/);
  });

  it('requires credentials to reference environment variables', () => {
    expect(() =>
      parseBlogStudioConfig({
        ...validConfig,
        assets: {
          adapter: 'tencent-cos',
          credentials: { secretKey: 'plaintext-secret' },
        },
      }),
    ).toThrow(ZodError);
  });

  it('rejects malformed environment variable names', () => {
    expect(() =>
      parseBlogStudioConfig({
        ...validConfig,
        assets: {
          adapter: 'tencent-cos',
          credentials: { secretKey: { env: 'not-valid' } },
        },
      }),
    ).toThrow(/environment variable/);
  });

  it('rejects an adapter that is unavailable in the registry', () => {
    const config = parseBlogStudioConfig(validConfig);

    expect(() =>
      assertKnownAdapters(config, {
        generator: new Set(['generic-command']),
        repository: new Set(['local-git']),
        assets: new Set(['tencent-cos']),
        publish: new Set(['tencent-cos']),
        cache: new Set(['tencent-cdn']),
      }),
    ).toThrow(/Unknown generator adapter "hexo"/);
  });

  it('accepts all adapters exposed by the registry', () => {
    const config: BlogStudioConfig = parseBlogStudioConfig(validConfig);

    expect(() =>
      assertKnownAdapters(config, {
        generator: new Set(['hexo']),
        repository: new Set(['local-git']),
        assets: new Set(['tencent-cos']),
        publish: new Set(['tencent-cos']),
        cache: new Set(['tencent-cdn']),
      }),
    ).not.toThrow();
  });

  it('keeps the committed JSON Schema synchronized', () => {
    const schemaPath = resolve(
      import.meta.dirname,
      '../../../schemas/blog-studio.v1.schema.json',
    );
    const committedSchema = JSON.parse(
      readFileSync(schemaPath, 'utf8'),
    ) as unknown;

    expect(committedSchema).toEqual(createBlogStudioJsonSchema());
  });

  it('keeps the public example configuration valid', () => {
    const examplePath = resolve(
      import.meta.dirname,
      '../../../examples/config/blog-studio.yml',
    );

    expect(() =>
      parseBlogStudioConfigYaml(readFileSync(examplePath, 'utf8')),
    ).not.toThrow();
  });
});
