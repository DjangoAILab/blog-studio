import {
  BlogStudioError,
  createDocumentId,
  createWorkspaceId,
  type ContentSortDirection,
  type ContentSortField,
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
import { parseDocument } from 'yaml';

import type { SiteService } from './sites.js';
import type { WorkspaceService } from './workspaces.js';

export interface ContentQuery {
  readonly search?: string;
  readonly collection?: string;
  readonly state?: ContentState;
  readonly tag?: string;
  readonly from?: string;
  readonly to?: string;
  readonly sort?: ContentSortField;
  readonly direction?: ContentSortDirection;
  readonly page?: number;
  readonly pageSize?: number;
}

function supportedFrontMatter(
  value: unknown,
): value is Readonly<Record<string, FrontMatterValue>> {
  if (value === null || Array.isArray(value) || typeof value !== 'object')
    return false;
  const supportedValue = (
    candidate: unknown,
  ): candidate is FrontMatterValue => {
    if (
      candidate === null ||
      typeof candidate === 'string' ||
      typeof candidate === 'number' ||
      typeof candidate === 'boolean'
    )
      return true;
    if (Array.isArray(candidate)) return candidate.every(supportedValue);
    return (
      typeof candidate === 'object' &&
      Object.values(candidate as Record<string, unknown>).every(supportedValue)
    );
  };
  return Object.values(value).every(supportedValue);
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

function sortValue(
  item: ContentSummary,
  sort: ContentSortField,
): string | undefined {
  switch (sort) {
    case 'activityAt':
      return item.activityAt;
    case 'publishedAt':
      return item.publishedAt;
    case 'contentUpdatedAt':
      return item.contentUpdatedAt;
    case 'filesystemModifiedAt':
      return item.filesystemModifiedAt;
    case 'title':
      return item.title;
    case 'state':
      return item.state;
    case 'path':
      return item.path;
  }
}

function compareContent(
  left: ContentSummary,
  right: ContentSummary,
  sort: ContentSortField,
  direction: ContentSortDirection,
): number {
  const leftValue = sortValue(left, sort);
  const rightValue = sortValue(right, sort);
  if (!leftValue && rightValue) return 1;
  if (leftValue && !rightValue) return -1;
  if (leftValue && rightValue) {
    const comparison = leftValue.localeCompare(rightValue);
    if (comparison !== 0) return direction === 'asc' ? comparison : -comparison;
  }
  return left.documentId.localeCompare(right.documentId);
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
    const collectionResults = await Promise.all(
      model.collections.map(async (collection) => {
        try {
          return {
            collectionId: collection.id,
            items: await workspace.generator.listDocuments(root, collection.id),
          };
        } catch (error) {
          return {
            collectionId: collection.id,
            items: [],
            issue: {
              collectionId: collection.id,
              kind: 'collection-unavailable' as const,
              message:
                error instanceof Error
                  ? error.message
                  : 'Collection could not be inspected',
            },
          };
        }
      }),
    );
    const summaries = collectionResults.flatMap((result) => result.items);
    const issues = collectionResults.flatMap((result) =>
      result.issue ? [result.issue] : [],
    );
    const dirtyPaths = await this.#dirtyPaths(workspace, workspaceId);
    const allItems: ContentSummary[] = summaries.map((summary) => {
      const dirty = dirtyPaths.has(summary.ref.path);
      const state: ContentState =
        summary.state === 'published' && dirty ? 'modified' : summary.state;
      const publishedAt = summary.publishedAt;
      const contentUpdatedAt = summary.contentUpdatedAt ?? summary.updatedAt;
      const filesystemModifiedAt = summary.filesystemModifiedAt;
      const activityAt = contentUpdatedAt ?? publishedAt ?? filesystemModifiedAt;
      return {
        siteId: site.id,
        documentId: summary.ref.documentId,
        collectionId: summary.ref.collectionId,
        path: summary.ref.path,
        title: summary.title,
        tags: summary.tags,
        categories: summary.categories ?? [],
        state,
        sourceState: summary.state,
        ...(publishedAt ? { publishedAt } : {}),
        ...(contentUpdatedAt ? { contentUpdatedAt } : {}),
        ...(filesystemModifiedAt ? { filesystemModifiedAt } : {}),
        ...(activityAt ? { activityAt, updatedAt: activityAt } : {}),
      };
    });
    const counts = {
      all: allItems.length,
      draft: allItems.filter((item) => item.state === 'draft').length,
      published: allItems.filter((item) => item.state === 'published').length,
      modified: allItems.filter((item) => item.state === 'modified').length,
    };
    const collectionCounts = new Map<string, number>();
    const tagCounts = new Map<
      string,
      { readonly name: string; count: number }
    >();
    const dates: string[] = [];
    for (const item of allItems) {
      collectionCounts.set(
        item.collectionId,
        (collectionCounts.get(item.collectionId) ?? 0) + 1,
      );
      for (const name of item.tags) {
        const key = normalize(name);
        const current = tagCounts.get(key);
        if (current) current.count += 1;
        else tagCounts.set(key, { name, count: 1 });
      }
      if (item.activityAt && Number.isFinite(Date.parse(item.activityAt)))
        dates.push(item.activityAt);
    }
    dates.sort();
    const firstDate = dates[0];
    const lastDate = dates.at(-1);
    const facets: ContentQueryResult['facets'] = {
      collections: [...collectionCounts]
        .map(([id, count]) => ({ id, count }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      tags: [...tagCounts.values()].sort((left, right) =>
        left.name.localeCompare(right.name),
      ),
      dateRange: {
        ...(firstDate ? { from: firstDate } : {}),
        ...(lastDate ? { to: lastDate } : {}),
      },
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
          [
            item.title,
            item.path,
            item.collectionId,
            ...item.tags,
            ...item.categories,
          ].some((value) => normalize(value).includes(search)),
      )
      .filter(
        (item) => !tag || item.tags.some((value) => normalize(value) === tag),
      )
      .filter((item) => withinDate(item.activityAt, query.from, query.to))
      .sort((left, right) =>
        compareContent(
          left,
          right,
          query.sort ?? 'activityAt',
          query.direction ?? 'desc',
        ),
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
      facets,
      issues,
    };
  }

  public async discardUnavailable(input: {
    readonly siteId: string;
    readonly documentId: string;
    readonly expectedVersion: number;
  }): Promise<void> {
    const workspaceId = this.sites.workspaceId(input.siteId);
    const workspace = this.workspaces.get(workspaceId);
    const root = workspace.config.workspace.root;
    const model = await workspace.generator.inspect(root);
    for (const collection of model.collections) {
      try {
        const documents = await workspace.generator.listDocuments(
          root,
          collection.id,
        );
        if (documents.some((item) => item.ref.documentId === input.documentId))
          throw new BlogStudioError(
            'DOCUMENT_CONFLICT',
            'Canonical source is available; use the normal discard flow',
            { documentId: input.documentId },
          );
      } catch (error) {
        if (error instanceof BlogStudioError) throw error;
      }
    }
    const current = this.drafts.get(
      createWorkspaceId(workspace.config.workspace.id),
      createDocumentId(input.documentId),
    );
    if (
      !current ||
      !this.drafts.delete(
        current.workspaceId,
        current.documentId,
        input.expectedVersion,
      )
    )
      throw new RevisionConflictError(
        input.expectedVersion,
        current?.version ?? 0,
      );
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
    return {
      source,
      draft: null,
      stale: false,
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
    if (current.source.frontMatterParseError) {
      throw new Error(
        'This document has invalid front matter and must be repaired in source mode before it can be saved.',
      );
    }
    const workspaceId = this.sites.workspaceId(input.siteId);
    const workspace = this.workspaces.get(workspaceId);
    const savedAt = input.savedAt ?? new Date().toISOString();
    try {
      await workspace.generator.writeDocument(workspace.config.workspace.root, {
        ref: current.source.ref,
        expectedRevision: current.source.revision,
        frontMatter: input.frontMatter,
        body: input.body,
        modifiedAt: savedAt,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        /revision conflict/i.test(error.message)
      ) {
        const latest = await workspace.generator.readDocument(
          workspace.config.workspace.root,
          current.source.ref,
        );
        throw new SourceRevisionConflictError(
          input.sourceRevision,
          latest.revision,
        );
      }
      throw error;
    }
    const source = await workspace.generator.readDocument(
      workspace.config.workspace.root,
      current.source.ref,
    );
    return {
      workspaceId: source.ref.workspaceId,
      documentId: source.ref.documentId,
      version: 1,
      sourceRevision: source.revision,
      frontMatter: source.frontMatter,
      ...(source.frontMatterSource
        ? { frontMatterSource: source.frontMatterSource }
        : {}),
      body: source.body,
      savedAt,
    };
  }

  public async repairFrontMatter(input: {
    readonly siteId: string;
    readonly collectionId: string;
    readonly documentId: string;
    readonly sourceRevision: string;
    readonly frontMatterSource: string;
  }) {
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
    if (!current.source.frontMatterParseError)
      throw new Error('Front matter is already valid and does not need repair');
    const document = parseDocument(input.frontMatterSource);
    if (document.errors.length > 0)
      throw new Error(
        `Front matter YAML is invalid: ${document.errors[0]?.message ?? 'unknown YAML error'}`,
      );
    const frontMatter = document.toJSON() as unknown;
    if (!supportedFrontMatter(frontMatter))
      throw new Error(
        'Front matter YAML must be a mapping of supported values',
      );
    const workspaceId = this.sites.workspaceId(input.siteId);
    const workspace = this.workspaces.get(workspaceId);
    await workspace.generator.writeDocument(workspace.config.workspace.root, {
      ref: current.source.ref,
      expectedRevision: current.source.revision,
      frontMatter,
      frontMatterSource: input.frontMatterSource,
      body: current.source.body,
    });
    return await workspace.generator.readDocument(
      workspace.config.workspace.root,
      current.source.ref,
    );
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
    const workspaceId = this.sites.workspaceId(input.siteId);
    const workspace = this.workspaces.get(workspaceId);
    const restore = workspace.repository as {
      restorePath?(root: string, path: string): Promise<void>;
    };
    if (!restore.restorePath) {
      throw new BlogStudioError(
        'DOCUMENT_CONFLICT',
        'This repository cannot restore a committed file version',
        { path: current.source.ref.path },
      );
    }
    try {
      await restore.restorePath(
        workspace.config.workspace.root,
        current.source.ref.path,
      );
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !/No committed version/i.test(error.message)
      ) {
        throw new BlogStudioError(
          'DOCUMENT_CONFLICT',
          error instanceof Error
            ? error.message
            : 'No committed version is available to restore',
          { path: current.source.ref.path },
        );
      }
      const title = current.source.frontMatter.title;
      await workspace.generator.writeDocument(workspace.config.workspace.root, {
        ref: current.source.ref,
        expectedRevision: current.source.revision,
        frontMatter: {
          ...current.source.frontMatter,
          ...(typeof title === 'string' ? { title } : {}),
        },
        body: '',
      });
    }
  }

  async #dirtyPaths(
    workspace: ReturnType<WorkspaceService['get']>,
    workspaceId: string,
  ): Promise<ReadonlySet<string>> {
    try {
      const status = await workspace.repository.status(
        createWorkspaceId(workspaceId),
        workspace.config.workspace.root,
      );
      return new Set(status.dirtyPaths);
    } catch {
      return new Set();
    }
  }
}
