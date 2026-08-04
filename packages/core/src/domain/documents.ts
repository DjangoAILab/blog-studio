import type {
  ContentHash,
  DocumentId,
  SiteId,
  WorkspaceId,
} from './identifiers.js';

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
  /** Stable source timestamp for generators whose output depends on file metadata. */
  readonly modifiedAt?: string;
}

export interface WriteDocumentResult {
  readonly revision: ContentHash;
  readonly changed: boolean;
}

export interface CreateDocumentInput {
  readonly collectionId: string;
  readonly title: string;
  readonly slug: string;
  readonly createdAt: string;
}

export interface CreateDocumentResult {
  readonly source: DocumentSource;
}

export interface PromoteDocumentInput {
  readonly ref: DocumentRef;
  readonly targetCollectionId: string;
  readonly expectedRevision: ContentHash;
}

export interface PromoteDocumentResult {
  readonly ref: DocumentRef;
  readonly revision: ContentHash;
}

export interface DocumentSummary {
  readonly ref: DocumentRef;
  readonly revision: ContentHash;
  readonly title: string;
  readonly tags: readonly string[];
  readonly updatedAt?: string;
  readonly state: 'draft' | 'published';
}

export type ContentState = 'draft' | 'published' | 'modified';

export interface ContentSummary {
  readonly siteId: SiteId;
  readonly documentId: DocumentId;
  readonly collectionId: string;
  readonly path: string;
  readonly title: string;
  readonly tags: readonly string[];
  readonly state: ContentState;
  readonly sourceState: 'draft' | 'published';
  readonly updatedAt?: string;
  readonly workingCopy?: {
    readonly version: number;
    readonly savedAt: string;
    readonly sourceRevision: ContentHash;
    readonly stale: boolean;
  };
}

export interface ContentQueryResult {
  readonly items: readonly ContentSummary[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly counts: Readonly<Record<'all' | ContentState, number>>;
}

export interface ContentCollection {
  readonly id: string;
  readonly label: string;
  readonly formats: readonly ('markdown' | 'mdx')[];
  readonly canCreate: boolean;
  readonly canDelete: boolean;
}
