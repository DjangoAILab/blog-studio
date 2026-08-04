import {
  BlogStudioError,
  createContentHash,
  createWorkspaceId,
  type ContentQueryResult,
  type ContentState,
  type ContentSummary,
  type FrontMatterValue,
} from '@blog-studio/core';
import {
  RevisionConflictError,
  type DraftSnapshot,
  type SqliteDraftRepository,
} from '@blog-studio/persistence';

import type { SiteService } from './sites.js';
import type { WorkspaceService } from './workspaces.js';

export interface ContentQuery {
  readonly search?: string;
  readonly collection?: string;
  readonly state?: ContentState;
  readonly tag?: string;
  readonly from?: string;
  readonly to?: string;
  readonly page?: number;
  readonly pageSize?: number;
}

export class SourceRevisionConflictError extends BlogStudioError {
  public constructor(expected: string, actual: string) {
    super('DOCUMENT_CONFLICT', 'Canonical source changed since it was opened', {
      actualRevision: actual,
      expectedRevision: expected,
    });
    this.name = 'SourceRevisionConflictError';
  }
}

function stringValue(value: FrontMatterValue | undefined): string | undefined {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : undefined;
}

function stringList(value: FrontMatterValue | undefined): readonly string[] {
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function withinDate(
  value: string | undefined,
  from: string | undefined,
  to: string | undefined,
): boolean {
  if (!value) return from === undefined && to === undefined;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return false;
  return (
    (from === undefined || time >= Date.parse(from)) &&
    (to === undefined || time <= Date.parse(to))
  );
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export class ContentService {
  public constructor(
    private readonly sites: SiteService,
    private readonly workspaces: WorkspaceService,
    private readonly drafts: SqliteDraftRepository,
  ) {}

  public async list(
    siteId: string,
    query: ContentQuery,
  ): Promise<ContentQueryResult> {
    const site = this.sites.get(siteId);
    const workspaceId = this.sites.workspaceId(siteId);
    const workspace = this.workspaces.get(workspaceId);
    const root = workspace.config.workspace.root;
    const model = await workspace.generator.inspect(root);
    const summaries = (
      await Promise.all(
        model.collections.map(async (collection) =>
          workspace.generator.listDocuments(root, collection.id),
        ),
      )
    ).flat();
    const drafts = new Map(
      this.drafts
        .listMetadataForWorkspace(
          createWorkspaceId(workspace.config.workspace.id),
        )
        .map((draft) => [draft.documentId, draft] as const),
    );
    const allItems: ContentSummary[] = summaries.map((summary) => {
      const draft = drafts.get(summary.ref.documentId);
      const state: ContentState =
        summary.state === 'published' && draft ? 'modified' : summary.state;
      const title = stringValue(draft?.frontMatter.title) ?? summary.title;
      const tags = draft ? stringList(draft.frontMatter.tags) : summary.tags;
      return {
        siteId: site.id,
        documentId: summary.ref.documentId,
        collectionId: summary.ref.collectionId,
        path: summary.ref.path,
        title,
        tags,
        state,
        sourceState: summary.state,
        ...(draft?.savedAt || summary.updatedAt
          ? { updatedAt: draft?.savedAt ?? summary.updatedAt }
          : {}),
        ...(draft
          ? {
              workingCopy: {
                version: draft.version,
                savedAt: draft.savedAt,
                sourceRevision: draft.sourceRevision,
                stale: draft.sourceRevision !== summary.revision,
              },
            }
          : {}),
      };
    });
    const counts = {
      all: allItems.length,
      draft: allItems.filter((item) => item.state === 'draft').length,
      published: allItems.filter((item) => item.state === 'published').length,
      modified: allItems.filter((item) => item.state === 'modified').length,
    };
    const search = query.search ? normalize(query.search) : undefined;
    const tag = query.tag ? normalize(query.tag) : undefined;
    const filtered = allItems
      .filter((item) => !query.state || item.state === query.state)
      .filter(
        (item) => !query.collection || item.collectionId === query.collection,
      )
      .filter(
        (item) =>
          !search ||
          [item.title, item.path, item.collectionId, ...item.tags].some(
            (value) => normalize(value).includes(search),
          ),
      )
      .filter(
        (item) => !tag || item.tags.some((value) => normalize(value) === tag),
      )
      .filter((item) => withinDate(item.updatedAt, query.from, query.to))
      .sort(
        (left, right) =>
          (right.updatedAt ?? '').localeCompare(left.updatedAt ?? '') ||
          left.title.localeCompare(right.title),
      );
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const offset = (page - 1) * pageSize;
    return {
      items: filtered.slice(offset, offset + pageSize),
      page,
      pageSize,
      total: filtered.length,
      counts,
    };
  }

  public async read(siteId: string, collectionId: string, documentId: string) {
    const workspaceId = this.sites.workspaceId(siteId);
    const workspace = this.workspaces.get(workspaceId);
    const { ref } = await this.workspaces.findDocument(
      workspaceId,
      collectionId,
      documentId,
    );
    const source = await workspace.generator.readDocument(
      workspace.config.workspace.root,
      ref,
    );
    const draft = this.drafts.get(ref.workspaceId, ref.documentId);
    return {
      source,
      draft,
      stale: draft ? draft.sourceRevision !== source.revision : false,
    };
  }

  public async save(input: {
    readonly siteId: string;
    readonly collectionId: string;
    readonly documentId: string;
    readonly expectedVersion: number;
    readonly sourceRevision: string;
    readonly frontMatter: Readonly<Record<string, FrontMatterValue>>;
    readonly body: string;
    readonly savedAt?: string;
  }): Promise<DraftSnapshot> {
    const current = await this.read(
      input.siteId,
      input.collectionId,
      input.documentId,
    );
    if (current.source.revision !== input.sourceRevision) {
      throw new SourceRevisionConflictError(
        input.sourceRevision,
        current.source.revision,
      );
    }
    return this.drafts.save({
      workspaceId: current.source.ref.workspaceId,
      documentId: current.source.ref.documentId,
      expectedVersion: input.expectedVersion,
      sourceRevision: createContentHash(input.sourceRevision),
      frontMatter: input.frontMatter,
      body: input.body,
      savedAt: input.savedAt ?? new Date().toISOString(),
    });
  }

  public async discard(input: {
    readonly siteId: string;
    readonly collectionId: string;
    readonly documentId: string;
    readonly expectedVersion: number;
  }): Promise<void> {
    const current = await this.read(
      input.siteId,
      input.collectionId,
      input.documentId,
    );
    if (
      !current.draft ||
      !this.drafts.delete(
        current.source.ref.workspaceId,
        current.source.ref.documentId,
        input.expectedVersion,
      )
    ) {
      throw new RevisionConflictError(
        input.expectedVersion,
        current.draft?.version ?? 0,
      );
    }
  }
}
