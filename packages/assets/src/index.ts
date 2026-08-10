import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import { Worker } from 'node:worker_threads';

import {
  createContentHash,
  type AssetProvider,
  type AssetRecord,
  type AssetScope,
  type DocumentId,
  type ResourcePutInput,
  type ResourceRecord,
  type WorkspaceId,
} from '@blog-studio/core';

export type AssetPolicyErrorCode =
  | 'ASSET_SCOPE_REQUIRED'
  | 'ASSET_TOO_LARGE'
  | 'ASSET_MEDIA_UNSUPPORTED'
  | 'ASSET_MEDIA_MISMATCH'
  | 'ASSET_PIXEL_LIMIT'
  | 'ASSET_PROCESSING_TIMEOUT'
  | 'ASSET_PROCESSING_FAILED'
  | 'RESOURCE_EXECUTABLE_REJECTED'
  | 'RESOURCE_EXTENSION_MISMATCH';

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
  readonly enabled?: boolean;
  readonly format?: 'original' | 'webp';
  readonly quality?: number;
  readonly stripMetadata?: boolean;
  readonly maxInputBytes?: number;
  readonly maxInputPixels?: number;
  readonly maxWidth?: number;
  /** @deprecated Use quality. */
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
    let processed = image
      .rotate()
      .resize({
        width: workerData.maxWidth,
        fit: 'inside',
        withoutEnlargement: true,
      });
    if (!workerData.stripMetadata) processed = processed.keepMetadata();
    if (workerData.outputFormat === 'webp') {
      processed = processed.webp({
        quality: workerData.quality,
        effort: 4,
        smartSubsample: true,
      });
    } else if (workerData.inputMediaType === 'image/jpeg') {
      processed = processed.jpeg({ quality: workerData.quality });
    } else if (workerData.inputMediaType === 'image/png') {
      processed = processed.png();
    } else {
      processed = processed.webp({ quality: workerData.quality });
    }
    const output = await processed.toBuffer();
    parentPort.postMessage({ type: 'success', bytes: output });
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
  readonly #enabled: boolean;
  readonly #format: 'original' | 'webp';
  readonly #quality: number;
  readonly #stripMetadata: boolean;
  readonly #maxInputPixels: number;
  readonly #maxWidth: number;
  readonly #maxProcessingMilliseconds: number;
  readonly #maxWorkerHeapMegabytes: number;
  readonly #maxVipsCacheMegabytes: number;

  public constructor(
    private readonly provider: AssetProvider,
    policy: AssetPipelinePolicy = {},
  ) {
    this.#maxInputBytes = policy.maxInputBytes ?? 12 * 1024 * 1024;
    this.#enabled = policy.enabled ?? false;
    this.#format = policy.format ?? 'original';
    this.#quality = policy.quality ?? policy.webpQuality ?? 82;
    this.#stripMetadata = policy.stripMetadata ?? false;
    this.#maxInputPixels = policy.maxInputPixels ?? 40_000_000;
    this.#maxWidth = policy.maxWidth ?? 2400;
    this.#maxProcessingMilliseconds =
      policy.maxProcessingMilliseconds ?? 15_000;
    this.#maxWorkerHeapMegabytes = policy.maxWorkerHeapMegabytes ?? 256;
    this.#maxVipsCacheMegabytes = policy.maxVipsCacheMegabytes ?? 64;
  }

  async #process(bytes: Uint8Array, inputMediaType: string): Promise<Buffer> {
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
          outputFormat: this.#format,
          inputMediaType,
          quality: this.#quality,
          stripMetadata: this.#stripMetadata,
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

    const extension = extname(input.filename);
    const validExtensions: Readonly<Record<string, readonly string[]>> = {
      'image/png': ['.png'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/webp': ['.webp'],
    };
    if (
      !validExtensions[detectedMediaType]?.includes(extension.toLowerCase())
    ) {
      throw new AssetPolicyError(
        'RESOURCE_EXTENSION_MISMATCH',
        `Filename extension does not match ${detectedMediaType}`,
      );
    }
    const processed = this.#enabled
      ? await this.#process(input.bytes, detectedMediaType)
      : Buffer.from(input.bytes);

    const digest = createHash('sha256').update(processed).digest('hex');
    const basename = extension
      ? input.filename.slice(0, -extension.length)
      : input.filename;
    const outputExtension =
      this.#enabled && this.#format === 'webp'
        ? '.webp'
        : extension.toLowerCase();
    const outputMediaType =
      this.#enabled && this.#format === 'webp'
        ? 'image/webp'
        : detectedMediaType;
    return await this.provider.put({
      scope: input.scope,
      filename: `${digest}-${sanitizeAssetFilename(basename)}${outputExtension}`,
      mediaType: outputMediaType,
      bytes: processed,
      contentHash: createContentHash(`sha256:${digest}`),
    });
  }
}

export interface ResourcePipelinePolicy {
  readonly maxInputBytes?: number;
  readonly allowedMediaTypes?: readonly string[];
  readonly inlinePreviewMediaTypes?: readonly string[];
  readonly image?: AssetPipelinePolicy;
}

const genericResourceExtensions: Readonly<Record<string, readonly string[]>> = {
  'application/pdf': ['.pdf'],
  'application/zip': ['.zip'],
  'text/plain': ['.txt', '.md', '.csv', '.log'],
};

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function rejectExecutable(bytes: Uint8Array): void {
  if (
    startsWith(bytes, [0x4d, 0x5a]) ||
    startsWith(bytes, [0x7f, 0x45, 0x4c, 0x46]) ||
    startsWith(bytes, [0x23, 0x21]) ||
    startsWith(bytes, [0xcf, 0xfa, 0xed, 0xfe]) ||
    startsWith(bytes, [0xfe, 0xed, 0xfa, 0xcf])
  ) {
    throw new AssetPolicyError(
      'RESOURCE_EXECUTABLE_REJECTED',
      'Executable resources are not accepted',
    );
  }
}

function sniffGenericMediaType(
  bytes: Uint8Array,
  claimedMediaType: string,
): string {
  rejectExecutable(bytes);
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return 'application/pdf';
  }
  if (
    startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) ||
    startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])
  ) {
    return 'application/zip';
  }
  if (normalizeClaimedMediaType(claimedMediaType) === 'text/plain') {
    if (
      bytes.includes(0) ||
      bytes.some((value) => value < 0x09 || (value > 0x0d && value < 0x20))
    ) {
      throw new AssetPolicyError(
        'ASSET_MEDIA_MISMATCH',
        'Claimed text resource contains binary control bytes',
      );
    }
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new AssetPolicyError(
        'ASSET_MEDIA_MISMATCH',
        'Claimed text resource is not valid UTF-8',
      );
    }
    return 'text/plain';
  }
  throw new AssetPolicyError(
    'ASSET_MEDIA_UNSUPPORTED',
    'Resource content type is not allowed by the current policy',
  );
}

function markdownLabel(value: string): string {
  return value.replaceAll('[', '_').replaceAll(']', '_').replaceAll('\\', '_');
}

function originalFilename(value: string): string {
  const leaf = value.replaceAll('\\', '/').split('/').at(-1)?.trim() ?? '';
  const sanitized = [...leaf]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 0x1f || code === 0x7f ? '_' : character;
    })
    .join('')
    .slice(0, 180);
  if (!sanitized) {
    throw new AssetPolicyError(
      'RESOURCE_EXTENSION_MISMATCH',
      'Resource filename must contain a portable leaf name',
    );
  }
  return sanitized;
}

export class ResourcePipeline {
  readonly #maxInputBytes: number;
  readonly #allowedMediaTypes: ReadonlySet<string>;
  readonly #inlinePreviewMediaTypes: ReadonlySet<string>;
  readonly #images: AssetPipeline;

  public constructor(
    private readonly provider: AssetProvider,
    policy: ResourcePipelinePolicy = {},
  ) {
    this.#maxInputBytes = policy.maxInputBytes ?? 12 * 1024 * 1024;
    this.#allowedMediaTypes = new Set(
      policy.allowedMediaTypes ?? [
        'image/png',
        'image/jpeg',
        'image/webp',
        'application/pdf',
        'application/zip',
        'text/plain',
      ],
    );
    this.#inlinePreviewMediaTypes = new Set(
      policy.inlinePreviewMediaTypes ?? [
        'image/png',
        'image/jpeg',
        'image/webp',
        'application/pdf',
      ],
    );
    this.#images = new AssetPipeline(provider, {
      ...policy.image,
      maxInputBytes: Math.min(
        policy.image?.maxInputBytes ?? this.#maxInputBytes,
        this.#maxInputBytes,
      ),
    });
  }

  public async ingest(input: ResourcePutInput): Promise<ResourceRecord> {
    if (!input.scope.documentId) {
      throw new AssetPolicyError(
        'ASSET_SCOPE_REQUIRED',
        'New resources require an immutable document scope',
      );
    }
    if (input.bytes.byteLength > this.#maxInputBytes) {
      throw new AssetPolicyError(
        'ASSET_TOO_LARGE',
        `Resource exceeds the ${this.#maxInputBytes} byte input limit`,
      );
    }
    const displayFilename = originalFilename(input.filename);
    let imageMediaType: string | undefined;
    try {
      imageMediaType = sniffImageMediaType(input.bytes);
    } catch {
      imageMediaType = undefined;
    }
    if (imageMediaType) {
      if (!this.#allowedMediaTypes.has(imageMediaType)) {
        throw new AssetPolicyError(
          'ASSET_MEDIA_UNSUPPORTED',
          `${imageMediaType} is not allowed by the current resource policy`,
        );
      }
      const stored = await this.#images.ingest({
        ...input,
        filename: displayFilename,
      });
      return {
        ...stored,
        kind: 'image',
        originalFilename: displayFilename,
        inlinePreview: this.#inlinePreviewMediaTypes.has(imageMediaType),
        insertion: `![${markdownLabel(displayFilename)}](${stored.publicUrl})`,
      };
    }

    const detectedMediaType = sniffGenericMediaType(
      input.bytes,
      input.claimedMediaType,
    );
    const claimedMediaType = normalizeClaimedMediaType(input.claimedMediaType);
    if (claimedMediaType !== detectedMediaType) {
      throw new AssetPolicyError(
        'ASSET_MEDIA_MISMATCH',
        `Claimed media type ${input.claimedMediaType} does not match ${detectedMediaType}`,
      );
    }
    if (!this.#allowedMediaTypes.has(detectedMediaType)) {
      throw new AssetPolicyError(
        'ASSET_MEDIA_UNSUPPORTED',
        `${detectedMediaType} is not allowed by the current resource policy`,
      );
    }
    const extension = extname(displayFilename).toLowerCase();
    if (!genericResourceExtensions[detectedMediaType]?.includes(extension)) {
      throw new AssetPolicyError(
        'RESOURCE_EXTENSION_MISMATCH',
        `Filename extension ${extension || '(none)'} does not match ${detectedMediaType}`,
      );
    }
    const digest = createHash('sha256').update(input.bytes).digest('hex');
    const basename = displayFilename.slice(0, -extension.length);
    const stored = await this.provider.put({
      scope: input.scope,
      filename: `${digest}-${sanitizeAssetFilename(basename)}${extension}`,
      mediaType: detectedMediaType,
      bytes: input.bytes,
      contentHash: createContentHash(`sha256:${digest}`),
    });
    return {
      ...stored,
      kind: 'attachment',
      originalFilename: displayFilename,
      inlinePreview: this.#inlinePreviewMediaTypes.has(detectedMediaType),
      insertion: `[${markdownLabel(displayFilename)}](${stored.publicUrl})`,
    };
  }
}
