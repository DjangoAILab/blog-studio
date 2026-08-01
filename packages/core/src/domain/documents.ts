import type { ContentHash, DocumentId, WorkspaceId } from './identifiers.js';

export type FrontMatterValue =
  | string
  | number
  | boolean
  | null
  | readonly FrontMatterValue[]
  | { readonly [key: string]: FrontMatterValue };

export interface DocumentRef {
  readonly workspaceId: WorkspaceId;
  readonly collectionId: string;
  readonly documentId: DocumentId;
  readonly path: string;
}

export interface DocumentSource {
  readonly ref: DocumentRef;
  readonly revision: ContentHash;
  readonly frontMatter: Readonly<Record<string, FrontMatterValue>>;
  readonly body: string;
  readonly raw: string;
  readonly format: 'markdown' | 'mdx';
}

export interface WriteDocumentInput {
  readonly ref: DocumentRef;
  readonly expectedRevision: ContentHash;
  readonly frontMatter: Readonly<Record<string, FrontMatterValue>>;
  readonly body: string;
}

export interface WriteDocumentResult {
  readonly revision: ContentHash;
  readonly changed: boolean;
}

export interface DocumentSummary {
  readonly ref: DocumentRef;
  readonly title: string;
  readonly updatedAt?: string;
  readonly state: 'draft' | 'published';
}

export interface ContentCollection {
  readonly id: string;
  readonly label: string;
  readonly formats: readonly ('markdown' | 'mdx')[];
  readonly canCreate: boolean;
  readonly canDelete: boolean;
}
