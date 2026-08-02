import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import { Worker } from 'node:worker_threads';

import {
  createContentHash,
  type AssetProvider,
  type AssetRecord,
  type AssetScope,
  type DocumentId,
  type WorkspaceId,
} from '@blog-studio/core';

export type AssetPolicyErrorCode =
  | 'ASSET_SCOPE_REQUIRED'
  | 'ASSET_TOO_LARGE'
  | 'ASSET_MEDIA_UNSUPPORTED'
  | 'ASSET_MEDIA_MISMATCH'
  | 'ASSET_PIXEL_LIMIT'
  | 'ASSET_PROCESSING_TIMEOUT'
  | 'ASSET_PROCESSING_FAILED';

export class AssetPolicyError extends Error {
  public constructor(
    public readonly code: AssetPolicyErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AssetPolicyError';
  }
}

export interface AssetPipelinePolicy {
  readonly maxInputBytes?: number;
  readonly maxInputPixels?: number;
  readonly maxWidth?: number;
  readonly webpQuality?: number;
  readonly maxProcessingMilliseconds?: number;
  readonly maxWorkerHeapMegabytes?: number;
  readonly maxVipsCacheMegabytes?: number;
}

export interface IngestAssetInput {
  readonly scope: AssetScope;
  readonly filename: string;
  readonly claimedMediaType: string;
  readonly bytes: Uint8Array;
}

export function sanitizeAssetFilename(value: string): string {
  const sanitized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return sanitized || 'asset';
}

export function sniffImageMediaType(bytes: Uint8Array): string {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  )
    return 'image/png';
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  )
    return 'image/jpeg';
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  )
    return 'image/webp';
  throw new AssetPolicyError(
    'ASSET_MEDIA_UNSUPPORTED',
    'Only validated PNG, JPEG, and WebP images are accepted',
  );
}

export function createArticleAssetScope(
  workspaceId: WorkspaceId,
  documentId: DocumentId,
  rootPrefix: string,
): AssetScope {
  const prefix = rootPrefix.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (
    !prefix ||
    prefix.split('/').some((segment) => !segment || segment === '..')
  )
    throw new AssetPolicyError(
      'ASSET_SCOPE_REQUIRED',
      'Asset root prefix must be a portable non-empty path',
    );
  return { workspaceId, documentId, prefix: `${prefix}/${documentId}` };
}

function normalizeClaimedMediaType(value: string): string {
  return value.split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

interface ImageWorkerMessage {
  readonly type: 'success' | 'policy-error' | 'processing-error';
  readonly bytes?: Uint8Array;
  readonly code?: AssetPolicyErrorCode;
  readonly message?: string;
}

const imageWorkerSource = String.raw`
const { parentPort, workerData } = require('node:worker_threads');

void (async () => {
  try {
    const sharpModule = await import(workerData.sharpModuleUrl);
    const sharp = sharpModule.default;
    sharp.cache({
      memory: workerData.maxVipsCacheMegabytes,
      files: 0,
      items: 20,
    });
    sharp.concurrency(1);
    const image = sharp(Buffer.from(workerData.bytes), {
      failOn: 'warning',
      limitInputPixels: false,
      sequentialRead: true,
    });
    const metadata = await image.metadata();
    const pixels = (metadata.width ?? 0) * (metadata.height ?? 0);
    if (pixels <= 0 || pixels > workerData.maxInputPixels) {
      parentPort.postMessage({
        type: 'policy-error',
        code: 'ASSET_PIXEL_LIMIT',
        message: 'Image exceeds the ' + workerData.maxInputPixels + ' pixel limit',
      });
      return;
    }
    const processed = await image
      .rotate()
      .resize({
        width: workerData.maxWidth,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({
        quality: workerData.webpQuality,
        effort: 4,
        smartSubsample: true,
      })
      .toBuffer();
    parentPort.postMessage({ type: 'success', bytes: processed });
  } catch (error) {
    parentPort.postMessage({
      type: 'processing-error',
      message: error instanceof Error ? error.message : 'unknown error',
    });
  }
})();
`;

export class AssetPipeline {
  readonly #maxInputBytes: number;
  readonly #maxInputPixels: number;
  readonly #maxWidth: number;
  readonly #webpQuality: number;
  readonly #maxProcessingMilliseconds: number;
  readonly #maxWorkerHeapMegabytes: number;
  readonly #maxVipsCacheMegabytes: number;

  public constructor(
    private readonly provider: AssetProvider,
    policy: AssetPipelinePolicy = {},
  ) {
    this.#maxInputBytes = policy.maxInputBytes ?? 12 * 1024 * 1024;
    this.#maxInputPixels = policy.maxInputPixels ?? 40_000_000;
    this.#maxWidth = policy.maxWidth ?? 2400;
    this.#webpQuality = policy.webpQuality ?? 82;
    this.#maxProcessingMilliseconds =
      policy.maxProcessingMilliseconds ?? 15_000;
    this.#maxWorkerHeapMegabytes = policy.maxWorkerHeapMegabytes ?? 256;
    this.#maxVipsCacheMegabytes = policy.maxVipsCacheMegabytes ?? 64;
  }

  async #process(bytes: Uint8Array): Promise<Buffer> {
    return await new Promise<Buffer>((resolve, reject) => {
      const worker = new Worker(imageWorkerSource, {
        eval: true,
        resourceLimits: {
          maxOldGenerationSizeMb: this.#maxWorkerHeapMegabytes,
          maxYoungGenerationSizeMb: 32,
          stackSizeMb: 4,
        },
        workerData: {
          bytes,
          sharpModuleUrl: import.meta.resolve('sharp'),
          maxInputPixels: this.#maxInputPixels,
          maxWidth: this.#maxWidth,
          webpQuality: this.#webpQuality,
          maxVipsCacheMegabytes: this.#maxVipsCacheMegabytes,
        },
      });
      let settled = false;
      const finish = (
        result: { readonly bytes: Uint8Array } | { readonly error: Error },
      ) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void worker.terminate();
        if ('error' in result) reject(result.error);
        else resolve(Buffer.from(result.bytes));
      };
      const timer = setTimeout(() => {
        finish({
          error: new AssetPolicyError(
            'ASSET_PROCESSING_TIMEOUT',
            `Image processing exceeded ${this.#maxProcessingMilliseconds} ms`,
          ),
        });
      }, this.#maxProcessingMilliseconds);
      worker.once('message', (message: ImageWorkerMessage) => {
        if (message.type === 'success' && message.bytes) {
          finish({ bytes: message.bytes });
          return;
        }
        if (message.type === 'policy-error' && message.code) {
          finish({
            error: new AssetPolicyError(
              message.code,
              message.message ?? 'Image violates the configured policy',
            ),
          });
          return;
        }
        finish({
          error: new AssetPolicyError(
            'ASSET_PROCESSING_FAILED',
            `Image processing failed: ${message.message ?? 'unknown error'}`,
          ),
        });
      });
      worker.once('error', (error) => {
        finish({
          error: new AssetPolicyError(
            'ASSET_PROCESSING_FAILED',
            `Image processing failed: ${error.message}`,
          ),
        });
      });
      worker.once('exit', (code) => {
        if (code !== 0)
          finish({
            error: new AssetPolicyError(
              'ASSET_PROCESSING_FAILED',
              `Image processing worker exited with code ${code}`,
            ),
          });
      });
    });
  }

  public async ingest(input: IngestAssetInput): Promise<AssetRecord> {
    if (!input.scope.documentId)
      throw new AssetPolicyError(
        'ASSET_SCOPE_REQUIRED',
        'New assets require an immutable document scope',
      );
    if (input.bytes.byteLength > this.#maxInputBytes)
      throw new AssetPolicyError(
        'ASSET_TOO_LARGE',
        `Image exceeds the ${this.#maxInputBytes} byte input limit`,
      );

    const detectedMediaType = sniffImageMediaType(input.bytes);
    if (normalizeClaimedMediaType(input.claimedMediaType) !== detectedMediaType)
      throw new AssetPolicyError(
        'ASSET_MEDIA_MISMATCH',
        `Claimed media type ${input.claimedMediaType} does not match ${detectedMediaType}`,
      );

    const processed = await this.#process(input.bytes);

    const digest = createHash('sha256').update(processed).digest('hex');
    const extension = extname(input.filename);
    const basename = extension
      ? input.filename.slice(0, -extension.length)
      : input.filename;
    return await this.provider.put({
      scope: input.scope,
      filename: `${digest}-${sanitizeAssetFilename(basename)}.webp`,
      mediaType: 'image/webp',
      bytes: processed,
      contentHash: createContentHash(`sha256:${digest}`),
    });
  }
}
