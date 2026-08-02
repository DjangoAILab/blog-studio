import {
  ADAPTER_API_VERSION,
  createDocumentId,
  createWorkspaceId,
  type AssetProvider,
  type AssetPutInput,
  type AssetRecord,
} from '@blog-studio/core';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import {
  AssetPipeline,
  AssetPolicyError,
  createArticleAssetScope,
  sanitizeAssetFilename,
  sniffImageMediaType,
} from '../src/index.js';

const png = new Uint8Array(
  await sharp({
    create: {
      width: 2,
      height: 2,
      channels: 4,
      background: { r: 250, g: 90, b: 55, alpha: 1 },
    },
  })
    .png()
    .toBuffer(),
);

class RecordingProvider implements AssetProvider {
  public readonly apiVersion = ADAPTER_API_VERSION;
  public readonly id = 'recording-assets';
  public readonly displayName = 'Recording assets';
  public input?: AssetPutInput;

  public put(input: AssetPutInput): Promise<AssetRecord> {
    this.input = input;
    return Promise.resolve({
      id: `asset-${input.contentHash.slice(7, 31)}` as AssetRecord['id'],
      workspaceId: input.scope.workspaceId,
      ...(input.scope.documentId ? { documentId: input.scope.documentId } : {}),
      key: `${input.scope.prefix}/${input.filename}`,
      publicUrl: `https://assets.example/${input.scope.prefix}/${input.filename}`,
      mediaType: input.mediaType,
      byteLength: input.bytes.byteLength,
      contentHash: input.contentHash,
      createdAt: '2026-08-02T00:00:00.000Z',
    });
  }

  public list(): Promise<readonly AssetRecord[]> {
    return Promise.resolve([]);
  }

  public delete(): Promise<void> {
    return Promise.resolve();
  }
}

describe('asset policy', () => {
  it('sanitizes unsafe and non-portable names', () => {
    expect(sanitizeAssetFilename('../../ Résumé 终稿.PNG')).toBe('resume-png');
    expect(sanitizeAssetFilename('...')).toBe('asset');
  });

  it('sniffs content independently from the extension', () => {
    expect(sniffImageMediaType(png)).toBe('image/png');
    expect(() => sniffImageMediaType(new Uint8Array([1, 2, 3]))).toThrow(
      AssetPolicyError,
    );
  });

  it('requires immutable document-scoped keys', () => {
    expect(
      createArticleAssetScope(
        createWorkspaceId('personal-blog'),
        createDocumentId('post-one'),
        'media/posts',
      ),
    ).toEqual({
      workspaceId: 'personal-blog',
      documentId: 'post-one',
      prefix: 'media/posts/post-one',
    });
  });

  it('rejects claimed MIME mismatches and byte limits', async () => {
    const pipeline = new AssetPipeline(new RecordingProvider(), {
      maxInputBytes: png.byteLength - 1,
    });
    const scope = createArticleAssetScope(
      createWorkspaceId('personal-blog'),
      createDocumentId('post-one'),
      'media/posts',
    );
    await expect(
      pipeline.ingest({
        scope,
        filename: 'pixel.jpg',
        claimedMediaType: 'image/jpeg',
        bytes: png,
      }),
    ).rejects.toMatchObject({ code: 'ASSET_TOO_LARGE' });

    const mismatchPipeline = new AssetPipeline(new RecordingProvider());
    await expect(
      mismatchPipeline.ingest({
        scope,
        filename: 'pixel.jpg',
        claimedMediaType: 'image/jpeg',
        bytes: png,
      }),
    ).rejects.toMatchObject({ code: 'ASSET_MEDIA_MISMATCH' });
  });

  it('strips metadata and creates deterministic content-addressed WebP names', async () => {
    const provider = new RecordingProvider();
    const pipeline = new AssetPipeline(provider, { maxWidth: 1200 });
    const scope = createArticleAssetScope(
      createWorkspaceId('personal-blog'),
      createDocumentId('post-one'),
      'media/posts',
    );
    const first = await pipeline.ingest({
      scope,
      filename: 'My Screenshot.PNG',
      claimedMediaType: 'image/png',
      bytes: png,
    });
    const second = await pipeline.ingest({
      scope,
      filename: 'My Screenshot.PNG',
      claimedMediaType: 'image/png',
      bytes: png,
    });

    expect(first.contentHash).toBe(second.contentHash);
    expect(first.mediaType).toBe('image/webp');
    expect(provider.input?.filename).toMatch(
      /^[a-f0-9]{64}-my-screenshot\.webp$/,
    );
    expect(provider.input?.scope.documentId).toBe('post-one');
  });

  it('rejects images whose decoded dimensions exceed the pixel budget', async () => {
    const scope = createArticleAssetScope(
      createWorkspaceId('personal-blog'),
      createDocumentId('post-one'),
      'media/posts',
    );
    const pipeline = new AssetPipeline(new RecordingProvider(), {
      maxInputPixels: 0,
    });
    await expect(
      pipeline.ingest({
        scope,
        filename: 'pixel.png',
        claimedMediaType: 'image/png',
        bytes: png,
      }),
    ).rejects.toMatchObject({ code: 'ASSET_PIXEL_LIMIT' });
  });

  it('terminates processing that exceeds its execution budget', async () => {
    const provider = new RecordingProvider();
    const scope = createArticleAssetScope(
      createWorkspaceId('personal-blog'),
      createDocumentId('post-one'),
      'media/posts',
    );
    const pipeline = new AssetPipeline(provider, {
      maxProcessingMilliseconds: 1,
      maxWorkerHeapMegabytes: 64,
      maxVipsCacheMegabytes: 8,
    });
    await expect(
      pipeline.ingest({
        scope,
        filename: 'pixel.png',
        claimedMediaType: 'image/png',
        bytes: png,
      }),
    ).rejects.toMatchObject({ code: 'ASSET_PROCESSING_TIMEOUT' });
    expect(provider.input).toBeUndefined();
  });
});
