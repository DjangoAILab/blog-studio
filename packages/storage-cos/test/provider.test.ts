import { createHash } from 'node:crypto';

import { assertAssetProviderConformance } from '@blog-studio/adapter-testkit';
import {
  createContentHash,
  createDocumentId,
  createWorkspaceId,
} from '@blog-studio/core';
import { describe, expect, it } from 'vitest';

import {
  TencentCosAssetProvider,
  type CosClient,
  type CosObjectSummary,
} from '../src/index.js';

class FakeCosClient implements CosClient {
  public readonly objects = new Map<
    string,
    CosObjectSummary & { body: Uint8Array }
  >();
  public putAttempts = 0;
  public failures = 0;

  public putObject(input: {
    readonly key: string;
    readonly body: Uint8Array;
  }): Promise<void> {
    this.putAttempts++;
    if (this.failures-- > 0)
      return Promise.reject(
        Object.assign(new Error('busy'), { statusCode: 503 }),
      );
    this.objects.set(input.key, {
      key: input.key,
      size: input.body.byteLength,
      lastModified: '2026-08-02T00:00:00.000Z',
      body: input.body,
    });
    return Promise.resolve();
  }

  public listObjects(input: { readonly prefix: string }): Promise<{
    readonly objects: readonly CosObjectSummary[];
  }> {
    return Promise.resolve({
      objects: [...this.objects.values()].filter((item) =>
        item.key.startsWith(input.prefix),
      ),
    });
  }

  public deleteObject(input: { readonly key: string }): Promise<void> {
    this.objects.delete(input.key);
    return Promise.resolve();
  }
}

function assetScope(prefix = 'media/posts/post-one') {
  return {
    workspaceId: createWorkspaceId('personal-blog'),
    documentId: createDocumentId('post-one'),
    prefix,
  };
}

function fixture(client = new FakeCosClient()) {
  return new TencentCosAssetProvider({
    client,
    bucket: 'example-123456',
    region: 'ap-shanghai',
    publicBaseUrl: 'https://assets.example/',
    managedPrefix: 'media/posts',
    protectedPrefixes: ['static'],
    retryDelay: async () => {},
  });
}

describe('Tencent COS asset provider', () => {
  it('passes provider conformance without exposing credentials', async () => {
    await assertAssetProviderConformance(() => {
      const bytes = new Uint8Array([1, 2, 3]);
      const digest = createHash('sha256').update(bytes).digest('hex');
      const scope = assetScope();
      return {
        provider: fixture(),
        scope,
        input: {
          scope,
          filename: `${digest}-cover.webp`,
          mediaType: 'image/webp',
          bytes,
          contentHash: createContentHash(`sha256:${digest}`),
        },
      };
    });
  });

  it('retries bounded transient failures and awaits success', async () => {
    const client = new FakeCosClient();
    client.failures = 2;
    const provider = fixture(client);
    const bytes = new Uint8Array([4, 5, 6]);
    const digest = createHash('sha256').update(bytes).digest('hex');
    await provider.put({
      scope: assetScope(),
      filename: `${digest}-retry.webp`,
      mediaType: 'image/webp',
      bytes,
      contentHash: createContentHash(`sha256:${digest}`),
    });
    expect(client.putAttempts).toBe(3);
  });

  it('rejects every operation outside the managed prefix', async () => {
    const provider = fixture();
    await expect(
      provider.list(assetScope('static/assets/post-one')),
    ).rejects.toThrow(/managed prefix/i);
  });
});
