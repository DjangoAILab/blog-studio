import { Buffer } from 'node:buffer';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  parseBlogStudioConfigYaml,
  type BlogStudioConfig,
} from '@blog-studio/config';
import { describe, expect, it, vi } from 'vitest';

import {
  TencentCdnSdkClient,
  TencentCosSdkClient,
  TencentEdgeOneSdkClient,
  createTencentProviderFactories,
  type TencentSdkFactories,
} from '../providers/tencent.js';
import type { WorkspaceHandle } from '../services/workspaces.js';

function cosSdk() {
  return {
    putObject: vi.fn().mockResolvedValue({}),
    getObject: vi.fn().mockResolvedValue({ Body: Buffer.from('state') }),
    putObjectCopy: vi.fn().mockResolvedValue({}),
    getBucket: vi.fn().mockResolvedValue({
      IsTruncated: 'true',
      NextMarker: 'next-key',
      Contents: [
        {
          Key: 'media/posts/doc/hash-image.webp',
          Size: '42',
          LastModified: '2026-08-02T00:00:00.000Z',
        },
      ],
    }),
    deleteObject: vi.fn().mockResolvedValue({}),
  };
}

describe('Tencent COS SDK bridge', () => {
  it('maps object operations, metadata, copy sources, and pagination', async () => {
    const sdk = cosSdk();
    const client = new TencentCosSdkClient(sdk);
    await client.putObject({
      bucket: 'example-123',
      region: 'ap-guangzhou',
      key: 'site/文章.html',
      body: Buffer.from('body'),
      contentType: 'text/html',
      cacheControl: 'no-cache',
      metadata: { 'blog-studio-release': 'release-1' },
    });
    expect(sdk.putObject).toHaveBeenCalledWith(
      expect.objectContaining({
        Bucket: 'example-123',
        Region: 'ap-guangzhou',
        Key: 'site/文章.html',
        'x-cos-meta-blog-studio-release': 'release-1',
      }),
    );

    await expect(
      client.getObject({
        bucket: 'example-123',
        region: 'ap-guangzhou',
        key: 'state.json',
      }),
    ).resolves.toEqual(Buffer.from('state'));
    await client.copyObject({
      bucket: 'example-123',
      region: 'ap-guangzhou',
      sourceKey: 'site/中文 name.html',
      destinationKey: 'rollback/site.html',
    });
    expect(sdk.putObjectCopy).toHaveBeenCalledWith(
      expect.objectContaining({
        CopySource:
          'example-123.cos.ap-guangzhou.myqcloud.com/site/%E4%B8%AD%E6%96%87%20name.html',
      }),
    );

    await expect(
      client.listObjects({
        bucket: 'example-123',
        region: 'ap-guangzhou',
        prefix: 'media/posts/doc/',
        continuationToken: 'previous-key',
      }),
    ).resolves.toEqual({
      objects: [
        {
          key: 'media/posts/doc/hash-image.webp',
          size: 42,
          lastModified: '2026-08-02T00:00:00.000Z',
        },
      ],
      nextContinuationToken: 'next-key',
    });
    expect(sdk.getBucket).toHaveBeenCalledWith(
      expect.objectContaining({ Marker: 'previous-key', MaxKeys: 1000 }),
    );

    await client.deleteObject({
      bucket: 'example-123',
      region: 'ap-guangzhou',
      key: 'site/old.html',
    });
    expect(sdk.deleteObject).toHaveBeenCalledOnce();
  });

  it('rejects malformed object sizes instead of leaking NaN into asset records', async () => {
    const sdk = cosSdk();
    sdk.getBucket.mockResolvedValueOnce({
      IsTruncated: 'false',
      Contents: [
        {
          Key: 'media/posts/doc/hash-image.webp',
          Size: '42px',
          LastModified: '2026-08-02T00:00:00.000Z',
        },
      ],
    });
    const client = new TencentCosSdkClient(sdk);
    await expect(
      client.listObjects({
        bucket: 'example-123',
        region: 'ap-guangzhou',
        prefix: 'media/posts/doc/',
      }),
    ).rejects.toThrow('COS returned an invalid size');
  });
});

describe('Tencent cache SDK bridges', () => {
  it('maps CDN URL/directory purge and aggregate task status', async () => {
    const sdk = {
      PurgeUrlsCache: vi
        .fn()
        .mockResolvedValue({ TaskId: 'cdn-url', RequestId: 'request-url' }),
      PurgePathCache: vi
        .fn()
        .mockResolvedValue({ TaskId: 'cdn-path', RequestId: 'request-path' }),
      DescribePurgeTasks: vi.fn().mockResolvedValue({
        PurgeLogs: [
          { TaskId: 'cdn-url', Status: 'done' },
          { TaskId: 'cdn-url', Status: 'done' },
        ],
      }),
    };
    const client = new TencentCdnSdkClient(sdk);
    await expect(
      client.submit({
        mode: 'cdn',
        kind: 'url',
        targets: ['https://blog.example.com/index.html'],
        method: 'delete',
      }),
    ).resolves.toEqual({ taskId: 'cdn-url', requestId: 'request-url' });
    expect(sdk.PurgeUrlsCache).toHaveBeenCalledWith({
      Urls: ['https://blog.example.com/index.html'],
      UrlEncode: true,
    });

    await client.submit({
      mode: 'cdn',
      kind: 'directory',
      targets: ['https://blog.example.com/posts/'],
      method: 'invalidate',
    });
    expect(sdk.PurgePathCache).toHaveBeenCalledWith({
      Paths: ['https://blog.example.com/posts/'],
      FlushType: 'flush',
      UrlEncode: true,
    });
    await expect(
      client.status({ mode: 'cdn', taskId: 'cdn-url' }),
    ).resolves.toBe('succeeded');
  });

  it('maps EdgeOne requests, requires a zone, and treats terminal errors as failure', async () => {
    const sdk = {
      CreatePurgeTask: vi.fn().mockResolvedValue({
        JobId: 'edge-job',
        RequestId: 'edge-request',
        FailedList: [],
      }),
      DescribePurgeTasks: vi.fn().mockResolvedValue({
        Tasks: [{ JobId: 'edge-job', Status: 'timeout' }],
      }),
    };
    const client = new TencentEdgeOneSdkClient(sdk);
    await expect(
      client.submit({
        mode: 'edgeone',
        kind: 'directory',
        targets: ['https://blog.example.com/posts/'],
        method: 'invalidate',
        zoneId: 'zone-example',
      }),
    ).resolves.toEqual({ taskId: 'edge-job', requestId: 'edge-request' });
    expect(sdk.CreatePurgeTask).toHaveBeenCalledWith({
      ZoneId: 'zone-example',
      Type: 'purge_prefix',
      Method: 'invalidate',
      Targets: ['https://blog.example.com/posts/'],
    });
    await client.submit({
      mode: 'edgeone',
      kind: 'url',
      targets: ['https://blog.example.com/index.html'],
      method: 'delete',
      zoneId: 'zone-example',
    });
    expect(sdk.CreatePurgeTask).toHaveBeenLastCalledWith({
      ZoneId: 'zone-example',
      Type: 'purge_url',
      Targets: ['https://blog.example.com/index.html'],
    });
    await expect(
      client.status({
        mode: 'edgeone',
        taskId: 'edge-job',
        zoneId: 'zone-example',
      }),
    ).resolves.toBe('failed');
  });
});

describe('Tencent production provider factories', () => {
  const config = parseBlogStudioConfigYaml(`
version: 1
workspace:
  id: reference-blog
  root: /workspaces/reference-blog
generator:
  adapter: hexo
  options: {}
repository:
  adapter: local-git
  options: {}
assets:
  adapter: tencent-cos
  options:
    bucket: example-123
    region: ap-guangzhou
    publicBaseUrl: https://blog.example.com/
    managedPrefix: media/posts
    protectedPrefixes: [static]
  credentials:
    secretId: { env: TEST_TENCENT_SECRET_ID }
    secretKey: { env: TEST_TENCENT_SECRET_KEY }
publish:
  adapter: tencent-cos
  options:
    targetId: staging
    bucket: example-123
    region: ap-guangzhou
    targetPrefix: blog-studio-staging/site
    statePrefix: blog-studio-staging/state
    protectedPrefixes: [static]
  credentials:
    secretId: { env: TEST_TENCENT_SECRET_ID }
    secretKey: { env: TEST_TENCENT_SECRET_KEY }
cache:
  adapter: tencent-edgeone
  options:
    zoneId: zone-example
  credentials:
    secretId: { env: TEST_TENCENT_SECRET_ID }
    secretKey: { env: TEST_TENCENT_SECRET_KEY }
verification:
  baseUrl: https://staging.example.com/
`);

  it('resolves server-only credential references and exposes all built-ins', async () => {
    const sdk = cosSdk();
    const sdkFactories: TencentSdkFactories = {
      cos: vi.fn(() => sdk as never),
      cdn: vi.fn(() => ({}) as never),
      teo: vi.fn(() => ({}) as never),
    };
    const factories = createTencentProviderFactories(
      {
        TEST_TENCENT_SECRET_ID: 'server-secret-id',
        TEST_TENCENT_SECRET_KEY: 'server-secret-key',
      },
      sdkFactories,
    );
    const assets = await factories.assetFactories['tencent-cos']!(config);
    const workspace = {
      config,
      configurationPath: '/config/blog-studio.yml',
      generator: {} as never,
      repository: {} as never,
      assetProvider: assets.provider,
      assetRootPrefix: assets.rootPrefix,
      assets: {} as never,
      resources: {} as never,
    } satisfies WorkspaceHandle;

    expect(assets.provider.id).toBe('tencent-cos');
    expect(
      factories.publisherFactories['tencent-cos']!(workspace, '/state').id,
    ).toBe('tencent-cos');
    expect(factories.cacheFactories['tencent-edgeone']!(workspace)?.id).toBe(
      'tencent-edgeone',
    );
    expect(sdkFactories.cos).toHaveBeenCalledWith({
      secretId: 'server-secret-id',
      secretKey: 'server-secret-key',
    });
  });

  it('passes an explicitly scoped directory purge root to Tencent CDN', async () => {
    const cdn = {
      PurgeUrlsCache: vi.fn().mockResolvedValue({}),
      PurgePathCache: vi
        .fn()
        .mockResolvedValue({ TaskId: 'path-task', RequestId: 'path-request' }),
      DescribePurgeTasks: vi.fn().mockResolvedValue({
        PurgeLogs: [{ TaskId: 'path-task', Status: 'done' }],
      }),
    };
    const cdnConfig = {
      ...config,
      cache: {
        ...config.cache!,
        adapter: 'tencent-cdn',
        options: {
          directoryPurgeRoot: 'https://staging.example.com/releases/v0.1/',
        },
      },
    } satisfies BlogStudioConfig;
    const factories = createTencentProviderFactories(
      {
        TEST_TENCENT_SECRET_ID: 'server-secret-id',
        TEST_TENCENT_SECRET_KEY: 'server-secret-key',
      },
      {
        cos: () => cosSdk(),
        cdn: () => cdn,
        teo: () => ({}) as never,
      },
    );
    const provider = factories.cacheFactories['tencent-cdn']!({
      config: cdnConfig,
      configurationPath: '/config/blog-studio.yml',
      generator: {} as never,
      repository: {} as never,
      assetProvider: {} as never,
      assetRootPrefix: 'assets',
      assets: {} as never,
      resources: {} as never,
    });
    await provider?.invalidate({
      urls: ['https://staging.example.com/releases/v0.1/index.html'],
      directories: [],
    });
    expect(cdn.PurgeUrlsCache).not.toHaveBeenCalled();
    expect(cdn.PurgePathCache).toHaveBeenCalledWith({
      Paths: ['https://staging.example.com/releases/v0.1/'],
      FlushType: 'flush',
      UrlEncode: true,
    });
  });

  it('fails closed when a referenced credential is unavailable', () => {
    const factories = createTencentProviderFactories(
      {},
      {
        cos: () => cosSdk(),
        cdn: () => ({}) as never,
        teo: () => ({}) as never,
      },
    );
    expect(() => factories.assetFactories['tencent-cos']!(config)).toThrow(
      'Environment variable TEST_TENCENT_SECRET_ID or TEST_TENCENT_SECRET_ID_FILE is required',
    );
  });

  it('reads credentials from Docker-compatible secret files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'blog-studio-tencent-'));
    try {
      const secretIdPath = join(directory, 'secret-id');
      const secretKeyPath = join(directory, 'secret-key');
      await writeFile(secretIdPath, 'file-secret-id\n', { mode: 0o600 });
      await writeFile(secretKeyPath, 'file-secret-key\n', { mode: 0o600 });
      const sdk = cosSdk();
      const sdkFactories: TencentSdkFactories = {
        cos: vi.fn(() => sdk as never),
        cdn: vi.fn(() => ({}) as never),
        teo: vi.fn(() => ({}) as never),
      };
      const factories = createTencentProviderFactories(
        {
          TEST_TENCENT_SECRET_ID_FILE: secretIdPath,
          TEST_TENCENT_SECRET_KEY_FILE: secretKeyPath,
        },
        sdkFactories,
      );
      await factories.assetFactories['tencent-cos']!(config);
      expect(sdkFactories.cos).toHaveBeenCalledWith({
        secretId: 'file-secret-id',
        secretKey: 'file-secret-key',
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
