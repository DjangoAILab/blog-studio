import {
  ADAPTER_API_VERSION,
  type CacheInvalidation,
  type CacheProvider,
  type CacheResult,
} from '@blog-studio/core';

export type TencentCacheMode = 'cdn' | 'edgeone';
export type TencentPurgeKind = 'url' | 'directory';

export interface TencentPurgeRequest {
  readonly mode: TencentCacheMode;
  readonly kind: TencentPurgeKind;
  readonly targets: readonly string[];
  readonly method: 'delete' | 'invalidate';
  readonly zoneId?: string;
}

export interface TencentCacheClient {
  submit(request: TencentPurgeRequest): Promise<{
    readonly taskId: string;
    readonly requestId: string;
  }>;
  status(input: {
    readonly mode: TencentCacheMode;
    readonly taskId: string;
    readonly zoneId?: string;
  }): Promise<'pending' | 'succeeded' | 'failed'>;
}

export interface TencentCacheProviderOptions {
  readonly client: TencentCacheClient;
  readonly mode: TencentCacheMode;
  readonly zoneId?: string;
  readonly directoryPurgeRoot?: string;
  readonly edgeOneBatchSize?: number;
  readonly maxPollAttempts?: number;
  readonly delay?: (attempt: number) => Promise<void>;
}

function batches<T>(
  values: readonly T[],
  size: number,
): readonly (readonly T[])[] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size)
    result.push(values.slice(index, index + size));
  return result;
}

function validateTargets(targets: readonly string[]): void {
  const unique = new Set<string>();
  for (const target of targets) {
    const url = new URL(target);
    if (!['http:', 'https:'].includes(url.protocol))
      throw new Error(`Cache target must be HTTP(S): ${target}`);
    if (url.username || url.password || url.hash)
      throw new Error(`Cache target contains unsupported URL parts: ${target}`);
    if (unique.has(url.toString()))
      throw new Error(`Duplicate cache target: ${target}`);
    unique.add(url.toString());
  }
}

export class TencentCacheProvider implements CacheProvider {
  public readonly apiVersion = ADAPTER_API_VERSION;
  public readonly id: string;
  public readonly displayName: string;
  readonly #client: TencentCacheClient;
  readonly #mode: TencentCacheMode;
  readonly #zoneId: string | undefined;
  readonly #directoryPurgeRoot: string | undefined;
  readonly #edgeOneBatchSize: number;
  readonly #maxPollAttempts: number;
  readonly #delay: (attempt: number) => Promise<void>;

  public constructor(options: TencentCacheProviderOptions) {
    this.#client = options.client;
    this.#mode = options.mode;
    this.#zoneId = options.zoneId;
    this.#directoryPurgeRoot = options.directoryPurgeRoot
      ? new URL(options.directoryPurgeRoot).toString()
      : undefined;
    this.#edgeOneBatchSize = options.edgeOneBatchSize ?? 100;
    this.#maxPollAttempts = options.maxPollAttempts ?? 20;
    this.#delay =
      options.delay ??
      (async (attempt) => {
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(10_000, 500 * 2 ** attempt)),
        );
      });
    this.id = options.mode === 'cdn' ? 'tencent-cdn' : 'tencent-edgeone';
    this.displayName =
      options.mode === 'cdn' ? 'Tencent CDN' : 'Tencent EdgeOne';
    if (options.mode === 'edgeone' && !options.zoneId)
      throw new Error('EdgeOne cache invalidation requires zoneId');
    if (this.#directoryPurgeRoot) {
      const root = new URL(this.#directoryPurgeRoot);
      if (
        !['http:', 'https:'].includes(root.protocol) ||
        root.username ||
        root.password ||
        root.search ||
        root.hash ||
        !root.pathname.endsWith('/')
      )
        throw new Error(
          'Tencent directory purge root must be an HTTP(S) directory URL',
        );
    }
    if (this.#edgeOneBatchSize < 1 || this.#edgeOneBatchSize > 1000)
      throw new Error('EdgeOne batch size must be between 1 and 1000');
    if (this.#maxPollAttempts < 1 || this.#maxPollAttempts > 100)
      throw new Error('Cache poll attempts must be between 1 and 100');
  }

  async #awaitTask(taskId: string): Promise<void> {
    for (let attempt = 0; attempt < this.#maxPollAttempts; attempt++) {
      const status = await this.#client.status({
        mode: this.#mode,
        taskId,
        ...(this.#zoneId ? { zoneId: this.#zoneId } : {}),
      });
      if (status === 'succeeded') return;
      if (status === 'failed')
        throw new Error(`Tencent cache task failed: ${taskId}`);
      if (attempt < this.#maxPollAttempts - 1) await this.#delay(attempt);
    }
    throw new Error(`Tencent cache task did not complete: ${taskId}`);
  }

  public async invalidate(input: CacheInvalidation): Promise<CacheResult> {
    validateTargets(input.urls);
    validateTargets(input.directories);
    const accepted = input.urls.length + input.directories.length;
    const urlBatchSize = this.#mode === 'cdn' ? 1000 : this.#edgeOneBatchSize;
    const directoryBatchSize =
      this.#mode === 'cdn' ? 500 : this.#edgeOneBatchSize;
    const directoryPurgeRoot = this.#directoryPurgeRoot;
    const requests = directoryPurgeRoot
      ? (() => {
          const root = new URL(directoryPurgeRoot);
          for (const target of [...input.urls, ...input.directories]) {
            const url = new URL(target);
            if (
              url.origin !== root.origin ||
              !url.pathname.startsWith(root.pathname)
            )
              throw new Error(
                `Cache target is outside configured directory purge root: ${target}`,
              );
          }
          return accepted === 0
            ? []
            : [
                {
                  kind: 'directory' as const,
                  targets: [directoryPurgeRoot],
                },
              ];
        })()
      : [
          ...batches(input.urls, urlBatchSize).map((targets) => ({
            kind: 'url' as const,
            targets,
          })),
          ...batches(input.directories, directoryBatchSize).map((targets) => ({
            kind: 'directory' as const,
            targets,
          })),
        ];
    const requestIds: string[] = [];
    for (const request of requests) {
      const result = await this.#client.submit({
        mode: this.#mode,
        kind: request.kind,
        targets: request.targets,
        method: request.kind === 'url' ? 'delete' : 'invalidate',
        ...(this.#zoneId ? { zoneId: this.#zoneId } : {}),
      });
      requestIds.push(result.requestId);
      await this.#awaitTask(result.taskId);
    }
    return {
      requestIds,
      accepted,
    };
  }
}
