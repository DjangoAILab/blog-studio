import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import {
  ADAPTER_API_VERSION,
  createReleaseId,
  type ManifestEntry,
  type PublishEventSink,
  type PublishInput,
  type PublishPlan,
  type Publisher,
  type ReleaseRecord,
} from '@blog-studio/core';
import { createPublishPlan } from '@blog-studio/release';

export interface CosPublisherClient {
  putObject(input: {
    readonly bucket: string;
    readonly region: string;
    readonly key: string;
    readonly body: Uint8Array;
    readonly contentType: string;
    readonly cacheControl: string;
    readonly metadata: Readonly<Record<string, string>>;
  }): Promise<void>;
  getObject(input: {
    readonly bucket: string;
    readonly region: string;
    readonly key: string;
  }): Promise<Uint8Array>;
  copyObject(input: {
    readonly bucket: string;
    readonly region: string;
    readonly sourceKey: string;
    readonly destinationKey: string;
  }): Promise<void>;
  deleteObject(input: {
    readonly bucket: string;
    readonly region: string;
    readonly key: string;
  }): Promise<void>;
}

export interface TencentCosPublisherOptions {
  readonly client: CosPublisherClient;
  readonly bucket: string;
  readonly region: string;
  readonly targetPrefix: string;
  readonly statePrefix: string;
  readonly protectedPrefixes?: readonly string[];
  readonly concurrency?: number;
  readonly maxAttempts?: number;
  readonly retryDelay?: (attempt: number) => Promise<void>;
  readonly now?: () => Date;
}

interface RollbackState {
  readonly version: 1;
  readonly plan: PublishPlan;
  readonly backedUpPaths: readonly string[];
}

function portablePrefix(value: string): string {
  const prefix = value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (
    !prefix ||
    prefix.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new Error(`Invalid COS prefix: ${value}`);
  return prefix;
}

function isProtected(path: string, prefixes: readonly string[]): boolean {
  return prefixes.some(
    (prefix) =>
      path === prefix || path.startsWith(`${prefix.replace(/\/$/, '')}/`),
  );
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

function isNotFound(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    (error as { statusCode?: number }).statusCode === 404,
  );
}

function cacheControl(entry: ManifestEntry): string {
  return entry.cacheClass === 'immutable'
    ? 'public, max-age=31536000, immutable'
    : entry.cacheClass === 'page'
      ? 'public, max-age=0, must-revalidate'
      : 'public, max-age=60, must-revalidate';
}

async function mapBounded<T>(
  values: readonly T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (cursor < values.length) {
        const index = cursor++;
        await worker(values[index]!, index);
      }
    },
  );
  const results = await Promise.allSettled(workers);
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (failure) throw failure.reason;
}

async function readVerified(
  root: string,
  entry: ManifestEntry,
): Promise<Uint8Array> {
  const canonicalRoot = resolve(root);
  const candidate = resolve(canonicalRoot, ...entry.path.split('/'));
  const rel = relative(canonicalRoot, candidate);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw new Error(`Publish source escaped root: ${entry.path}`);
  const bytes = await readFile(candidate);
  const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  if (bytes.byteLength !== entry.byteLength || digest !== entry.contentHash)
    throw new Error(`Source hash or size mismatch: ${entry.path}`);
  return bytes;
}

export class TencentCosPublisher implements Publisher {
  public readonly apiVersion = ADAPTER_API_VERSION;
  public readonly id = 'tencent-cos';
  public readonly displayName = 'Tencent COS publisher';
  readonly #client: CosPublisherClient;
  readonly #bucket: string;
  readonly #region: string;
  readonly #targetPrefix: string;
  readonly #statePrefix: string;
  readonly #protectedPrefixes: readonly string[];
  readonly #concurrency: number;
  readonly #maxAttempts: number;
  readonly #retryDelay: (attempt: number) => Promise<void>;
  readonly #now: () => Date;

  public constructor(options: TencentCosPublisherOptions) {
    this.#client = options.client;
    this.#bucket = options.bucket;
    this.#region = options.region;
    this.#targetPrefix = portablePrefix(options.targetPrefix);
    this.#statePrefix = portablePrefix(options.statePrefix);
    this.#protectedPrefixes = options.protectedPrefixes ?? [];
    this.#concurrency = options.concurrency ?? 6;
    this.#maxAttempts = options.maxAttempts ?? 3;
    this.#retryDelay =
      options.retryDelay ??
      (async (attempt) => {
        await new Promise((resolveDelay) =>
          setTimeout(resolveDelay, 100 * 2 ** attempt),
        );
      });
    this.#now = options.now ?? (() => new Date());
    if (this.#targetPrefix === this.#statePrefix)
      throw new Error('COS target and state prefixes must be different');
    if (this.#concurrency < 1 || this.#concurrency > 32)
      throw new Error('COS publish concurrency must be between 1 and 32');
    if (this.#maxAttempts < 1 || this.#maxAttempts > 8)
      throw new Error('COS maxAttempts must be between 1 and 8');
  }

  #targetKey(path: string): string {
    return `${this.#targetPrefix}/${path}`;
  }

  #releaseKey(releaseId: string, suffix: string): string {
    createReleaseId(releaseId);
    return `${this.#statePrefix}/releases/${releaseId}/${suffix}`;
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

  public plan(input: PublishInput): Promise<PublishPlan> {
    const plan = createPublishPlan(
      input.outputDirectory,
      input.manifest,
      input.previousManifest,
      this.#protectedPrefixes,
    );
    const unknownProtected = plan.additions.find((entry) =>
      isProtected(entry.path, this.#protectedPrefixes),
    );
    if (unknownProtected)
      throw new Error(
        `Protected object ${unknownProtected.path} requires an imported baseline manifest`,
      );
    return Promise.resolve(plan);
  }

  async #get(key: string): Promise<Uint8Array> {
    return await this.#retry(async () =>
      this.#client.getObject({
        bucket: this.#bucket,
        region: this.#region,
        key,
      }),
    );
  }

  async #prepare(plan: PublishPlan): Promise<RollbackState> {
    const stateKey = this.#releaseKey(plan.releaseId, 'rollback.json');
    try {
      return JSON.parse(
        Buffer.from(await this.#get(stateKey)).toString('utf8'),
      ) as RollbackState;
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
    const backedUpPaths = [...plan.changes, ...plan.deletions].map(
      (entry) => entry.path,
    );
    await mapBounded(backedUpPaths, this.#concurrency, async (path) => {
      await this.#retry(async () =>
        this.#client.copyObject({
          bucket: this.#bucket,
          region: this.#region,
          sourceKey: this.#targetKey(path),
          destinationKey: this.#releaseKey(plan.releaseId, `files/${path}`),
        }),
      );
    });
    const state: RollbackState = { version: 1, plan, backedUpPaths };
    await this.#retry(async () =>
      this.#client.putObject({
        bucket: this.#bucket,
        region: this.#region,
        key: stateKey,
        body: Buffer.from(`${JSON.stringify(state)}\n`),
        contentType: 'application/json',
        cacheControl: 'no-store',
        metadata: { 'blog-studio-state': 'rollback' },
      }),
    );
    return state;
  }

  public async apply(
    plan: PublishPlan,
    phase: 'assets' | 'pages',
    events: PublishEventSink,
  ) {
    const selected = [...plan.additions, ...plan.changes].filter((entry) =>
      phase === 'assets'
        ? entry.cacheClass === 'immutable'
        : entry.cacheClass !== 'immutable',
    );
    const sources = new Map<string, Uint8Array>();
    await mapBounded(selected, this.#concurrency, async (entry) => {
      sources.set(entry.path, await readVerified(plan.sourceDirectory, entry));
    });
    await this.#prepare(plan);
    let uploaded = 0;
    await mapBounded(selected, this.#concurrency, async (entry) => {
      await this.#retry(async () =>
        this.#client.putObject({
          bucket: this.#bucket,
          region: this.#region,
          key: this.#targetKey(entry.path),
          body: sources.get(entry.path)!,
          contentType: entry.mediaType,
          cacheControl: cacheControl(entry),
          metadata: {
            'blog-studio-release': plan.releaseId,
            'blog-studio-hash': entry.contentHash,
          },
        }),
      );
      uploaded++;
      events({
        at: this.#now().toISOString(),
        stage: phase === 'assets' ? 'uploading-assets' : 'uploading-pages',
        level: 'info',
        message: `Uploaded ${entry.path}`,
        completed: uploaded,
        total: selected.length,
      });
    });
    let deleted = 0;
    if (phase === 'pages') {
      await mapBounded(plan.deletions, this.#concurrency, async (entry) => {
        if (isProtected(entry.path, plan.protectedPrefixes)) return;
        await this.#retry(async () =>
          this.#client.deleteObject({
            bucket: this.#bucket,
            region: this.#region,
            key: this.#targetKey(entry.path),
          }),
        );
        deleted++;
      });
    }
    return { uploaded, deleted };
  }

  public async finalize(plan: PublishPlan) {
    const bytes = Buffer.from(`${JSON.stringify(plan.manifest)}\n`);
    const keys = [
      this.#releaseKey(plan.releaseId, 'manifest.json'),
      `${this.#statePrefix}/active-manifest.json`,
    ];
    await mapBounded(keys, this.#concurrency, async (key) => {
      await this.#retry(async () =>
        this.#client.putObject({
          bucket: this.#bucket,
          region: this.#region,
          key,
          body: bytes,
          contentType: 'application/json',
          cacheControl: 'no-store',
          metadata: { 'blog-studio-state': 'manifest' },
        }),
      );
    });
    return {
      manifestPath: `${this.#statePrefix}/active-manifest.json`,
      uploaded: plan.additions.length + plan.changes.length,
      deleted: plan.deletions.length,
    };
  }

  public async rollback(release: ReleaseRecord) {
    const state = JSON.parse(
      Buffer.from(
        await this.#get(this.#releaseKey(release.id, 'rollback.json')),
      ).toString('utf8'),
    ) as RollbackState;
    if (state.version !== 1 || state.plan.releaseId !== release.id)
      throw new Error(
        'COS rollback state does not match the requested release',
      );
    const backedUp = new Set(state.backedUpPaths);
    const affected = [
      ...new Set(
        [
          ...state.plan.additions,
          ...state.plan.changes,
          ...state.plan.deletions,
        ].map((entry) => entry.path),
      ),
    ];
    let restoredFiles = 0;
    await mapBounded(affected, this.#concurrency, async (path) => {
      if (backedUp.has(path)) {
        await this.#retry(async () =>
          this.#client.copyObject({
            bucket: this.#bucket,
            region: this.#region,
            sourceKey: this.#releaseKey(release.id, `files/${path}`),
            destinationKey: this.#targetKey(path),
          }),
        );
        restoredFiles++;
      } else if (!isProtected(path, state.plan.protectedPrefixes)) {
        await this.#retry(async () =>
          this.#client.deleteObject({
            bucket: this.#bucket,
            region: this.#region,
            key: this.#targetKey(path),
          }),
        );
      }
    });
    const activeKey = `${this.#statePrefix}/active-manifest.json`;
    if (state.plan.previousManifest) {
      await this.#retry(async () =>
        this.#client.putObject({
          bucket: this.#bucket,
          region: this.#region,
          key: activeKey,
          body: Buffer.from(`${JSON.stringify(state.plan.previousManifest)}\n`),
          contentType: 'application/json',
          cacheControl: 'no-store',
          metadata: { 'blog-studio-state': 'manifest' },
        }),
      );
    } else {
      await this.#retry(async () =>
        this.#client.deleteObject({
          bucket: this.#bucket,
          region: this.#region,
          key: activeKey,
        }),
      );
    }
    return { restoredReleaseId: release.id, restoredFiles };
  }
}
