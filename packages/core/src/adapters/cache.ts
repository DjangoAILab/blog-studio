import type { AdapterDescriptor } from './common.js';

export interface CacheInvalidation {
  readonly urls: readonly string[];
  readonly directories: readonly string[];
}

export interface CacheResult {
  readonly requestIds: readonly string[];
  readonly accepted: number;
}

export interface CacheProvider extends AdapterDescriptor {
  invalidate(input: CacheInvalidation): Promise<CacheResult>;
}
