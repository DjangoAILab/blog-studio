import { BlogStudioError } from './errors.js';

declare const identifierBrand: unique symbol;
declare const hashBrand: unique symbol;

type Identifier<TName extends string> = string & {
  readonly [identifierBrand]: TName;
};

export type WorkspaceId = Identifier<'WorkspaceId'>;
export type DocumentId = Identifier<'DocumentId'>;
export type AssetId = Identifier<'AssetId'>;
export type ReleaseId = Identifier<'ReleaseId'>;
export type JobId = Identifier<'JobId'>;
export type ContentHash = `sha256:${string}` & {
  readonly [hashBrand]: 'ContentHash';
};

const identifierPattern = /^[a-z0-9][a-z0-9._-]*$/;

function createIdentifier<TName extends string>(
  kind: TName,
  value: string,
): Identifier<TName> {
  if (
    value.length === 0 ||
    value.length > 128 ||
    !identifierPattern.test(value) ||
    value.includes('..')
  ) {
    throw new BlogStudioError(
      'INVALID_IDENTIFIER',
      `${kind} must be a portable lowercase identifier`,
      { kind, value },
    );
  }

  return value as Identifier<TName>;
}

export const createWorkspaceId = (value: string): WorkspaceId =>
  createIdentifier('WorkspaceId', value);

export const createDocumentId = (value: string): DocumentId =>
  createIdentifier('DocumentId', value);

export const createAssetId = (value: string): AssetId =>
  createIdentifier('AssetId', value);

export const createReleaseId = (value: string): ReleaseId =>
  createIdentifier('ReleaseId', value);

export const createJobId = (value: string): JobId =>
  createIdentifier('JobId', value);

export function createContentHash(value: string): ContentHash {
  if (!/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new BlogStudioError(
      'INVALID_CONTENT_HASH',
      'Content hash must be a lowercase sha256 digest',
      { value },
    );
  }

  return value as ContentHash;
}
