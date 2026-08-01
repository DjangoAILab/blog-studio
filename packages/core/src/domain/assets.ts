import type {
  AssetId,
  ContentHash,
  DocumentId,
  WorkspaceId,
} from './identifiers.js';

export interface AssetScope {
  readonly workspaceId: WorkspaceId;
  readonly documentId?: DocumentId;
  readonly prefix: string;
}

export interface AssetRecord {
  readonly id: AssetId;
  readonly workspaceId: WorkspaceId;
  readonly documentId?: DocumentId;
  readonly key: string;
  readonly publicUrl: string;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly contentHash: ContentHash;
  readonly createdAt: string;
}

export interface AssetPutInput {
  readonly scope: AssetScope;
  readonly filename: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
  readonly contentHash: ContentHash;
}

export interface AssetDeleteInput {
  readonly scope: AssetScope;
  readonly assetId: AssetId;
  readonly expectedContentHash: ContentHash;
}
