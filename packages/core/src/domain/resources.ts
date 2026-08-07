import type { AssetRecord, AssetScope } from './assets.js';

export type ResourceKind = 'image' | 'attachment';

export interface ResourcePolicy {
  readonly allowedMediaTypes: readonly string[];
  readonly maxInputBytes: number;
  readonly inlinePreviewMediaTypes: readonly string[];
  readonly naming: 'immutable-sha256';
  readonly storageScope: 'document';
}

export interface ResourceRecord extends AssetRecord {
  readonly kind: ResourceKind;
  readonly originalFilename: string;
  readonly inlinePreview: boolean;
  readonly insertion: string;
}

export interface ResourcePutInput {
  readonly scope: AssetScope;
  readonly filename: string;
  readonly claimedMediaType: string;
  readonly bytes: Uint8Array;
}
