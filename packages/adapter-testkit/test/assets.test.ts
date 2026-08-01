import {
  ADAPTER_API_VERSION,
  createAssetId,
  createContentHash,
  createDocumentId,
  createWorkspaceId,
  type AssetDeleteInput,
  type AssetProvider,
  type AssetPutInput,
  type AssetRecord,
  type AssetScope,
} from '@blog-studio/core';
import { describe, expect, it } from 'vitest';

import {
  assertAdapterDescriptor,
  assertAssetProviderConformance,
} from '../src/index.js';

class MemoryAssetProvider implements AssetProvider {
  public readonly apiVersion = ADAPTER_API_VERSION;
  public readonly id = 'memory-assets';
  public readonly displayName = 'Memory assets';
  readonly #assets = new Map<string, AssetRecord>();

  public async put(input: AssetPutInput): Promise<AssetRecord> {
    const asset: AssetRecord = {
      id: createAssetId('asset-memory'),
      workspaceId: input.scope.workspaceId,
      ...(input.scope.documentId === undefined
        ? {}
        : { documentId: input.scope.documentId }),
      key: `${input.scope.prefix}/${input.filename}`,
      publicUrl: `https://example.com/${input.scope.prefix}/${input.filename}`,
      mediaType: input.mediaType,
      byteLength: input.bytes.byteLength,
      contentHash: input.contentHash,
      createdAt: '2026-08-02T00:00:00.000Z',
    };
    this.#assets.set(asset.id, asset);
    return Promise.resolve(asset);
  }

  public async list(scope: AssetScope): Promise<readonly AssetRecord[]> {
    return Promise.resolve(
      [...this.#assets.values()].filter(
        (asset) =>
          asset.workspaceId === scope.workspaceId &&
          asset.key.startsWith(scope.prefix),
      ),
    );
  }

  public async delete(input: AssetDeleteInput): Promise<void> {
    this.#assets.delete(input.assetId);
    return Promise.resolve();
  }
}

describe('adapter testkit', () => {
  it('accepts a conforming asset provider', async () => {
    await expect(
      assertAssetProviderConformance(() => {
        const scope = {
          workspaceId: createWorkspaceId('personal-blog'),
          documentId: createDocumentId('post-one'),
          prefix: 'media/posts/post-one',
        };
        return {
          provider: new MemoryAssetProvider(),
          scope,
          input: {
            scope,
            filename: 'cover.webp',
            mediaType: 'image/webp',
            bytes: new Uint8Array([1, 2, 3]),
            contentHash: createContentHash(`sha256:${'a'.repeat(64)}`),
          },
        };
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects a malformed descriptor', () => {
    expect(() =>
      assertAdapterDescriptor({
        apiVersion: ADAPTER_API_VERSION,
        id: 'Not Portable',
        displayName: 'Broken',
      }),
    ).toThrow(/kebab-case/);
  });
});
