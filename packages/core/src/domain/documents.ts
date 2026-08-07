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
  /** Original YAML between front-matter delimiters, retained for lossless edits. */
  readonly frontMatterSource?: string;
  /** Parse diagnostic when canonical front matter cannot be represented safely. */
  readonly frontMatterParseError?: string;
  readonly body: string;
  readonly raw: string;
  readonly format: 'markdown' | 'mdx';
}

export interface WriteDocumentInput {
  readonly ref: DocumentRef;
  readonly expectedRevision: ContentHash;
  readonly frontMatter: Readonly<Record<string, FrontMatterValue>>;
  /**
   * A validated replacement YAML mapping for source-repair operations. Normal
   * authoring deliberately omits it so key-level edits retain CST formatting.
   */
  readonly frontMatterSource?: string;
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
  readonly categories?: readonly string[];
  /** Original publication time declared by the content source. */
  readonly publishedAt?: string;
  /** Content-maintained timestamp, such as front-matter `updated`. */
  readonly contentUpdatedAt?: string;
  /** Filesystem mtime used only for diagnostics and external-change detection. */
  readonly filesystemModifiedAt?: string;
  /** @deprecated Use contentUpdatedAt or filesystemModifiedAt explicitly. */
  readonly updatedAt?: string;
  readonly state: 'draft' | 'published';
}

export type ContentState = 'draft' | 'published' | 'modified';

export const contentSortFields = [
  'activityAt',
  'publishedAt',
  'contentUpdatedAt',
  'filesystemModifiedAt',
  'title',
  'state',
  'path',
] as const;

export type ContentSortField = (typeof contentSortFields)[number];
export type ContentSortDirection = 'asc' | 'desc';

export interface ContentSummary {
  readonly siteId: SiteId;
  readonly documentId: DocumentId;
  readonly collectionId: string;
  readonly path: string;
  readonly title: string;
  readonly tags: readonly string[];
  readonly categories: readonly string[];
  readonly state: ContentState;
  readonly sourceState: 'draft' | 'published' | 'unavailable';
  readonly publishedAt?: string;
  readonly contentUpdatedAt?: string;
  readonly filesystemModifiedAt?: string;
  readonly workingCopySavedAt?: string;
  /** The meaningful most-recent activity time used by the default sort. */
  readonly activityAt?: string;
  /** @deprecated Use activityAt explicitly. */
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
  readonly facets: {
    readonly collections: readonly {
      readonly id: string;
      readonly count: number;
    }[];
    readonly tags: readonly {
      readonly name: string;
      readonly count: number;
    }[];
    readonly dateRange: {
      readonly from?: string;
      readonly to?: string;
    };
  };
  readonly issues: readonly {
    readonly collectionId: string;
    readonly kind: 'collection-unavailable';
    readonly message: string;
  }[];
}

export interface ContentCollection {
  readonly id: string;
  readonly label: string;
  readonly formats: readonly ('markdown' | 'mdx')[];
  readonly canCreate: boolean;
  readonly canDelete: boolean;
}
