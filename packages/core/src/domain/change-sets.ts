import type { RepositoryChange } from '../adapters/repository.js';
import type { FrontMatterValue } from './documents.js';
import type {
  ContentHash,
  DocumentId,
  SiteId,
  WorkspaceId,
} from './identifiers.js';

export type ChangeSetStatus =
  'prepared' | 'applied' | 'committed' | 'superseded' | 'invalidated';

export interface FrozenDocumentChange {
  readonly documentId: DocumentId;
  readonly collectionId: string;
  readonly path: string;
  readonly sourceRevision: ContentHash;
  readonly draftVersion: number;
  readonly draftSavedAt: string;
  readonly originalFrontMatter: Readonly<Record<string, FrontMatterValue>>;
  readonly originalBody: string;
  readonly frontMatter: Readonly<Record<string, FrontMatterValue>>;
  readonly body: string;
  readonly state: 'modified' | 'conflicted';
}

export interface ChangeSetPayload {
  readonly version: 1;
  readonly siteId: SiteId;
  readonly workspaceId: WorkspaceId;
  readonly baseRevision: ContentHash;
  readonly branch: string;
  readonly documents: readonly FrozenDocumentChange[];
  readonly repositoryChanges: readonly RepositoryChange[];
  readonly preparedAt: string;
}

export interface ChangeSetReview {
  readonly id: string;
  readonly status: ChangeSetStatus;
  readonly fingerprint: ContentHash;
  readonly payload: ChangeSetPayload;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly appliedAt?: string;
  readonly commitId?: string;
}
