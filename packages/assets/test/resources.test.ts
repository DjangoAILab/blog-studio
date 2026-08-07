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
  AssetPolicyError,
  createArticleAssetScope,
  ResourcePipeline,
} from '../src/index.js';

class RecordingProvider implements AssetProvider {
  public readonly apiVersion = ADAPTER_API_VERSION;
  public readonly id = 'resources';
  public readonly displayName = 'Resources';
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
      createdAt: '2026-08-04T00:00:00.000Z',
    });
  }

  public list(): Promise<readonly AssetRecord[]> {
    return Promise.resolve([]);
  }

  public delete(): Promise<void> {
    return Promise.resolve();
  }
}

const scope = createArticleAssetScope(
  createWorkspaceId('personal-blog'),
  createDocumentId('post-one'),
  'media/posts',
);
const png = new Uint8Array(
  await sharp({
    create: {
      width: 2,
      height: 2,
      channels: 4,
      background: { r: 10, g: 80, b: 160, alpha: 1 },
    },
  })
    .png()
    .toBuffer(),
);

describe('generic resource policy', () => {
  it('preserves optimized image handling behind the generic contract', async () => {
    const resource = await new ResourcePipeline(new RecordingProvider()).ingest(
      {
        scope,
        filename: 'Cover.png',
        claimedMediaType: 'image/png',
        bytes: png,
      },
    );
    expect(resource).toMatchObject({
      kind: 'image',
      mediaType: 'image/webp',
      inlinePreview: true,
    });
    expect(resource.insertion).toMatch(/^!\[Cover\.png\]\(https:\/\//);
  });

  it.each([
    [
      '../../Guide.PDF',
      'application/pdf',
      new TextEncoder().encode('%PDF-1.7\n'),
      true,
    ],
    [
      'notes.txt',
      'text/plain',
      new TextEncoder().encode('portable notes\n'),
      false,
    ],
    [
      'bundle.zip',
      'application/zip',
      new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      false,
    ],
  ] as const)(
    'stores %s unchanged with portable Markdown insertion',
    async (filename, mediaType, bytes, inlinePreview) => {
      const provider = new RecordingProvider();
      const resource = await new ResourcePipeline(provider).ingest({
        scope,
        filename,
        claimedMediaType: mediaType,
        bytes,
      });

      expect(provider.input?.bytes).toEqual(bytes);
      expect(provider.input?.filename).toMatch(
        /^[a-f0-9]{64}-(?:guide|notes|bundle)\.(?:pdf|txt|zip)$/,
      );
      expect(resource).toMatchObject({
        kind: 'attachment',
        originalFilename: filename.replace('../../', ''),
        mediaType,
        inlinePreview,
      });
      expect(resource.insertion).toMatch(/^\[[^\]]+\]\(https:\/\//);
    },
  );

  it('rejects executable signatures before trusting names or MIME claims', async () => {
    const pipeline = new ResourcePipeline(new RecordingProvider());
    await expect(
      pipeline.ingest({
        scope,
        filename: 'harmless.txt',
        claimedMediaType: 'text/plain',
        bytes: new Uint8Array([0x4d, 0x5a, 0x90, 0x00]),
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_EXECUTABLE_REJECTED' });
  });

  it('applies the explicit inline-preview policy', async () => {
    const resource = await new ResourcePipeline(new RecordingProvider(), {
      inlinePreviewMediaTypes: [],
    }).ingest({
      scope,
      filename: 'guide.pdf',
      claimedMediaType: 'application/pdf',
      bytes: new TextEncoder().encode('%PDF-1.7\n'),
    });
    expect(resource.inlinePreview).toBe(false);
  });

  it('rejects spoofed MIME, mismatched extensions, invalid UTF-8, and limits', async () => {
    const pipeline = new ResourcePipeline(new RecordingProvider(), {
      maxInputBytes: 8,
    });
    await expect(
      pipeline.ingest({
        scope,
        filename: 'guide.pdf',
        claimedMediaType: 'text/plain',
        bytes: new TextEncoder().encode('%PDF-1.7'),
      }),
    ).rejects.toMatchObject({ code: 'ASSET_MEDIA_MISMATCH' });
    await expect(
      pipeline.ingest({
        scope,
        filename: 'guide.txt',
        claimedMediaType: 'application/pdf',
        bytes: new TextEncoder().encode('%PDF-1.7'),
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_EXTENSION_MISMATCH' });
    await expect(
      pipeline.ingest({
        scope,
        filename: 'bad.txt',
        claimedMediaType: 'text/plain',
        bytes: new Uint8Array([0xc3, 0x28]),
      }),
    ).rejects.toBeInstanceOf(AssetPolicyError);
    await expect(
      pipeline.ingest({
        scope,
        filename: 'large.txt',
        claimedMediaType: 'text/plain',
        bytes: new TextEncoder().encode('123456789'),
      }),
    ).rejects.toMatchObject({ code: 'ASSET_TOO_LARGE' });
  });
});
