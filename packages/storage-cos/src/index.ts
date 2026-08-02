import { createHash } from 'node:crypto';

import {
  ADAPTER_API_VERSION,
  createAssetId,
  createContentHash,
  type AssetDeleteInput,
  type AssetProvider,
  type AssetPutInput,
  type AssetRecord,
  type AssetScope,
  type ContentHash,
} from '@blog-studio/core';

export interface CosObjectSummary {
  readonly key: string;
  readonly size: number;
  readonly lastModified: string;
}

export interface CosClient {
  putObject(input: {
    readonly bucket: string;
    readonly region: string;
    readonly key: string;
    readonly body: Uint8Array;
    readonly contentType: string;
    readonly cacheControl: string;
    readonly metadata: Readonly<Record<string, string>>;
  }): Promise<void>;
  listObjects(input: {
    readonly bucket: string;
    readonly region: string;
    readonly prefix: string;
    readonly continuationToken?: string;
  }): Promise<{
    readonly objects: readonly CosObjectSummary[];
    readonly nextContinuationToken?: string;
  }>;
  deleteObject(input: {
    readonly bucket: string;
    readonly region: string;
    readonly key: string;
  }): Promise<void>;
}

export interface TencentCosAssetProviderOptions {
  readonly client: CosClient;
  readonly bucket: string;
  readonly region: string;
  readonly publicBaseUrl: string;
  readonly managedPrefix: string;
  readonly protectedPrefixes?: readonly string[];
  readonly maxAttempts?: number;
  readonly retryDelay?: (attempt: number) => Promise<void>;
}

function portablePrefix(value: string): string {
  const prefix = value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (
    !prefix ||
    prefix.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new Error(`Invalid asset prefix: ${value}`);
  return prefix;
}

function isWithinPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function hashBytes(bytes: Uint8Array): ContentHash {
  return createContentHash(
    `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  );
}

function mediaTypeFor(path: string): string {
  if (path.endsWith('.webp')) return 'image/webp';
  if (path.endsWith('.png')) return 'image/png';
  if (/\.jpe?g$/i.test(path)) return 'image/jpeg';
  return 'application/octet-stream';
}

function isRetryable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { statusCode?: number; code?: string };
  return (
    value.statusCode === 429 ||
    (value.statusCode !== undefined && value.statusCode >= 500) ||
    ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'].includes(value.code ?? '')
  );
}

export class TencentCosAssetProvider implements AssetProvider {
  public readonly apiVersion = ADAPTER_API_VERSION;
  public readonly id = 'tencent-cos';
  public readonly displayName = 'Tencent COS assets';
  readonly #client: CosClient;
  readonly #bucket: string;
  readonly #region: string;
  readonly #publicBaseUrl: URL;
  readonly #managedPrefix: string;
  readonly #protectedPrefixes: readonly string[];
  readonly #maxAttempts: number;
  readonly #retryDelay: (attempt: number) => Promise<void>;

  public constructor(options: TencentCosAssetProviderOptions) {
    this.#client = options.client;
    this.#bucket = options.bucket;
    this.#region = options.region;
    this.#publicBaseUrl = new URL(
      options.publicBaseUrl.endsWith('/')
        ? options.publicBaseUrl
        : `${options.publicBaseUrl}/`,
    );
    this.#managedPrefix = portablePrefix(options.managedPrefix);
    this.#protectedPrefixes = (options.protectedPrefixes ?? []).map(
      portablePrefix,
    );
    this.#maxAttempts = options.maxAttempts ?? 3;
    this.#retryDelay =
      options.retryDelay ??
      (async (attempt) => {
        await new Promise((resolve) => setTimeout(resolve, 50 * 2 ** attempt));
      });
    if (this.#maxAttempts < 1 || this.#maxAttempts > 8)
      throw new Error('COS maxAttempts must be between 1 and 8');
    if (
      this.#protectedPrefixes.some(
        (prefix) =>
          isWithinPrefix(this.#managedPrefix, prefix) ||
          isWithinPrefix(prefix, this.#managedPrefix),
      )
    )
      throw new Error('Managed and protected asset prefixes must not overlap');
  }

  #assertManaged(scope: AssetScope): string {
    const prefix = portablePrefix(scope.prefix);
    if (!isWithinPrefix(prefix, this.#managedPrefix))
      throw new Error('Asset scope is outside the managed prefix');
    if (this.#protectedPrefixes.some((item) => isWithinPrefix(prefix, item)))
      throw new Error('Asset scope targets a protected legacy prefix');
    return prefix;
  }

  async #retry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < this.#maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (!isRetryable(error) || attempt === this.#maxAttempts - 1)
          throw error;
        await this.#retryDelay(attempt);
      }
    }
    throw lastError;
  }

  #record(
    scope: AssetScope,
    object: CosObjectSummary,
  ): AssetRecord | undefined {
    const filename = object.key.split('/').at(-1) ?? '';
    const digest = /^([a-f0-9]{64})-/.exec(filename)?.[1];
    if (!digest) return undefined;
    const idHash = createHash('sha256').update(object.key).digest('hex');
    return {
      id: createAssetId(`asset-${idHash.slice(0, 24)}`),
      workspaceId: scope.workspaceId,
      ...(scope.documentId ? { documentId: scope.documentId } : {}),
      key: object.key,
      publicUrl: new URL(
        object.key.split('/').map(encodeURIComponent).join('/'),
        this.#publicBaseUrl,
      ).toString(),
      mediaType: mediaTypeFor(filename),
      byteLength: object.size,
      contentHash: createContentHash(`sha256:${digest}`),
      createdAt: object.lastModified,
    };
  }

  public async put(input: AssetPutInput): Promise<AssetRecord> {
    const prefix = this.#assertManaged(input.scope);
    if (hashBytes(input.bytes) !== input.contentHash)
      throw new Error('Asset bytes do not match the declared content hash');
    if (!/^[a-f0-9]{64}-[a-z0-9][a-z0-9-]*\.[a-z0-9]+$/.test(input.filename))
      throw new Error('Asset filename must be sanitized and content-addressed');
    if (!input.filename.startsWith(input.contentHash.slice(7)))
      throw new Error('Asset filename does not match its content hash');
    const key = `${prefix}/${input.filename}`;
    await this.#retry(async () =>
      this.#client.putObject({
        bucket: this.#bucket,
        region: this.#region,
        key,
        body: input.bytes,
        contentType: input.mediaType,
        cacheControl: 'public, max-age=31536000, immutable',
        metadata: {
          'blog-studio-hash': input.contentHash,
          'blog-studio-workspace': input.scope.workspaceId,
          ...(input.scope.documentId
            ? { 'blog-studio-document': input.scope.documentId }
            : {}),
        },
      }),
    );
    return this.#record(input.scope, {
      key,
      size: input.bytes.byteLength,
      lastModified: new Date().toISOString(),
    })!;
  }

  public async list(scope: AssetScope): Promise<readonly AssetRecord[]> {
    const prefix = `${this.#assertManaged(scope)}/`;
    const objects: CosObjectSummary[] = [];
    let continuationToken: string | undefined;
    do {
      const page = await this.#retry(async () =>
        this.#client.listObjects({
          bucket: this.#bucket,
          region: this.#region,
          prefix,
          ...(continuationToken === undefined ? {} : { continuationToken }),
        }),
      );
      objects.push(...page.objects);
      continuationToken = page.nextContinuationToken;
    } while (continuationToken !== undefined);
    return objects
      .map((object) => this.#record(scope, object))
      .filter((record) => record !== undefined);
  }

  public async delete(input: AssetDeleteInput): Promise<void> {
    const asset = (await this.list(input.scope)).find(
      (record) => record.id === input.assetId,
    );
    if (!asset) throw new Error(`Unknown asset: ${input.assetId}`);
    if (asset.contentHash !== input.expectedContentHash)
      throw new Error('Asset content hash changed; refusing deletion');
    await this.#retry(async () =>
      this.#client.deleteObject({
        bucket: this.#bucket,
        region: this.#region,
        key: asset.key,
      }),
    );
  }
}
