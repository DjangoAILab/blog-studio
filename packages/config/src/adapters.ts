import type { BlogStudioConfig } from './schema.js';

export type AdapterKind =
  'generator' | 'repository' | 'assets' | 'publish' | 'cache';

export type AdapterRegistry = Readonly<
  Record<AdapterKind, ReadonlySet<string>>
>;

export class UnknownAdapterError extends Error {
  public constructor(
    public readonly kind: AdapterKind,
    public readonly adapterId: string,
  ) {
    super(`Unknown ${kind} adapter "${adapterId}"`);
    this.name = 'UnknownAdapterError';
  }
}

export function assertKnownAdapters(
  config: BlogStudioConfig,
  registry: AdapterRegistry,
): void {
  const configuredAdapters: ReadonlyArray<
    readonly [AdapterKind, string | undefined]
  > = [
    ['generator', config.generator.adapter],
    ['repository', config.repository.adapter],
    ['assets', config.assets.adapter],
    ['publish', config.publish.adapter],
    ['cache', config.cache?.adapter],
  ];

  for (const [kind, adapterId] of configuredAdapters) {
    if (adapterId !== undefined && !registry[kind].has(adapterId)) {
      throw new UnknownAdapterError(kind, adapterId);
    }
  }
}
