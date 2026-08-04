import { createHash, randomUUID } from 'node:crypto';

import {
  BlogStudioError,
  createContentHash,
  createWorkspaceId,
  type ChangeSetPayload,
  type ChangeSetReview,
  type FrozenDocumentChange,
  type DocumentRef,
} from '@blog-studio/core';
import type {
  ChangeSetRecord,
  SqliteChangeSetRepository,
  SqliteDraftRepository,
} from '@blog-studio/persistence';

import type { SiteService } from './sites.js';
import type { WorkspaceService } from './workspaces.js';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value: unknown) {
  return createContentHash(
    `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`,
  );
}

function review(record: ChangeSetRecord): ChangeSetReview {
  return {
    id: record.id,
    status: record.status,
    fingerprint: createContentHash(record.fingerprint),
    payload: record.payload as ChangeSetPayload,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.appliedAt ? { appliedAt: record.appliedAt } : {}),
    ...(record.commitId ? { commitId: record.commitId } : {}),
  };
}

export class ChangeSetNotFoundError extends Error {
  public constructor(readonly id: string) {
    super(`Unknown ChangeSet: ${id}`);
    this.name = 'ChangeSetNotFoundError';
  }
}

export class ChangeSetConflictError extends BlogStudioError {
  public constructor(message: string) {
    super('CHANGE_SET_CONFLICT', message);
    this.name = 'ChangeSetConflictError';
  }
}

interface ApplyJournalDocument extends FrozenDocumentChange {
  readonly ref: DocumentRef;
}

interface ApplyJournal {
  readonly siteId: string;
  readonly documents: readonly ApplyJournalDocument[];
}

export class ChangeSetService {
  public constructor(
    private readonly sites: SiteService,
    private readonly workspaces: WorkspaceService,
    private readonly drafts: SqliteDraftRepository,
    private readonly repository: SqliteChangeSetRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async prepare(siteId: string): Promise<ChangeSetReview> {
    const site = this.sites.get(siteId);
    const workspaceId = this.sites.workspaceId(siteId);
    const workspace = this.workspaces.get(workspaceId);
    const root = workspace.config.workspace.root;
    const repositoryStatus = await workspace.repository.status(
      createWorkspaceId(workspaceId),
      root,
    );
    const model = await workspace.generator.inspect(root);
    const summaries = (
      await Promise.all(
        model.collections.map((collection) =>
          workspace.generator.listDocuments(root, collection.id),
        ),
      )
    ).flat();
    const summaryById = new Map(
      summaries.map((summary) => [summary.ref.documentId, summary] as const),
    );
    const documents: FrozenDocumentChange[] = [];
    for (const metadata of this.drafts.listMetadataForWorkspace(
      createWorkspaceId(workspaceId),
    )) {
      const snapshot = this.drafts.get(
        metadata.workspaceId,
        metadata.documentId,
      );
      const summary = summaryById.get(metadata.documentId);
      if (!snapshot || !summary)
        throw new Error(`Draft source is missing: ${metadata.documentId}`);
      const source = await workspace.generator.readDocument(root, summary.ref);
      documents.push({
        documentId: metadata.documentId,
        collectionId: summary.ref.collectionId,
        path: summary.ref.path,
        sourceRevision: summary.revision,
        draftVersion: snapshot.version,
        draftSavedAt: snapshot.savedAt,
        originalFrontMatter: source.frontMatter,
        originalBody: source.body,
        frontMatter: snapshot.frontMatter,
        body: snapshot.body,
        state:
          snapshot.sourceRevision === summary.revision
            ? 'modified'
            : 'conflicted',
      });
    }
    documents.sort((left, right) => left.path.localeCompare(right.path));
    const preparedAt = this.now().toISOString();
    const frozen = {
      version: 1,
      siteId: site.id,
      workspaceId: createWorkspaceId(workspaceId),
      baseRevision: repositoryStatus.head,
      branch: repositoryStatus.branch,
      documents,
      repositoryChanges: [...repositoryStatus.changes].sort((left, right) =>
        left.path.localeCompare(right.path),
      ),
    } as const;
    const exactFingerprint = fingerprint(frozen);
    const payload: ChangeSetPayload = { ...frozen, preparedAt };
    return review(
      this.repository.prepare({
        id: `change-${randomUUID()}`,
        siteId,
        fingerprint: exactFingerprint,
        baseRevision: repositoryStatus.head,
        payload,
        at: preparedAt,
      }),
    );
  }

  public list(siteId: string): readonly ChangeSetReview[] {
    this.sites.get(siteId);
    return this.repository.listForSite(siteId).map(review);
  }

  public get(siteId: string, id: string): ChangeSetReview {
    const record = this.repository.get(id);
    if (!record || record.siteId !== siteId)
      throw new ChangeSetNotFoundError(id);
    return review(record);
  }

  public async apply(siteId: string, id: string): Promise<ChangeSetReview> {
    const changeSet = this.get(siteId, id);
    if (changeSet.status !== 'prepared')
      throw new ChangeSetConflictError('ChangeSet is no longer prepared');
    if (
      changeSet.payload.documents.some(
        (document) => document.state === 'conflicted',
      )
    )
      throw new ChangeSetConflictError(
        'ChangeSet contains conflicted documents',
      );
    const workspaceId = this.sites.workspaceId(siteId);
    const workspace = this.workspaces.get(workspaceId);
    const root = workspace.config.workspace.root;
    const repositoryStatus = await workspace.repository.status(
      createWorkspaceId(workspaceId),
      root,
    );
    if (
      repositoryStatus.head !== changeSet.payload.baseRevision ||
      canonical(repositoryStatus.changes) !==
        canonical(changeSet.payload.repositoryChanges)
    ) {
      this.repository.invalidate(id, this.now().toISOString());
      throw new ChangeSetConflictError(
        'Repository changed after ChangeSet preparation',
      );
    }
    const documents: ApplyJournalDocument[] = [];
    for (const frozen of changeSet.payload.documents) {
      const found = await this.workspaces.findDocument(
        workspaceId,
        frozen.collectionId,
        frozen.documentId,
      );
      const source = await workspace.generator.readDocument(root, found.ref);
      const draft = this.drafts.get(
        source.ref.workspaceId,
        source.ref.documentId,
      );
      if (
        source.revision !== frozen.sourceRevision ||
        !draft ||
        draft.version !== frozen.draftVersion ||
        draft.sourceRevision !== frozen.sourceRevision ||
        canonical(draft.frontMatter) !== canonical(frozen.frontMatter) ||
        draft.body !== frozen.body
      ) {
        this.repository.invalidate(id, this.now().toISOString());
        throw new ChangeSetConflictError(
          `Document changed after preparation: ${frozen.path}`,
        );
      }
      documents.push({ ...frozen, ref: source.ref });
    }
    const at = this.now().toISOString();
    const attempt = this.repository.beginApply({
      id: `apply-${randomUUID()}`,
      changeSetId: id,
      journal: { siteId, documents } satisfies ApplyJournal,
      at,
    });
    const applied: Array<{
      readonly document: ApplyJournalDocument;
      readonly revision: FrozenDocumentChange['sourceRevision'];
    }> = [];
    try {
      for (const document of documents) {
        const result = await workspace.generator.writeDocument(root, {
          ref: document.ref,
          expectedRevision: document.sourceRevision,
          frontMatter: document.frontMatter,
          body: document.body,
          modifiedAt: document.draftSavedAt,
        });
        applied.push({ document, revision: result.revision });
      }
      const appliedRecord = this.repository.finishApply(
        attempt.id,
        id,
        this.now().toISOString(),
      );
      for (const document of documents) {
        this.drafts.delete(
          document.ref.workspaceId,
          document.ref.documentId,
          document.draftVersion,
        );
      }
      return review(appliedRecord);
    } catch (error) {
      let recovered = true;
      for (const entry of applied.reverse()) {
        try {
          await workspace.generator.writeDocument(root, {
            ref: entry.document.ref,
            expectedRevision: entry.revision,
            frontMatter: entry.document.originalFrontMatter,
            body: entry.document.originalBody,
          });
        } catch {
          recovered = false;
        }
      }
      this.repository.markApplyRecovery(
        attempt.id,
        recovered ? 'rolled-back' : 'recovery-required',
        this.now().toISOString(),
      );
      if (!recovered) this.repository.invalidate(id, this.now().toISOString());
      throw error;
    }
  }

  public async recover(): Promise<void> {
    for (const attempt of this.repository.applying()) {
      const journal = attempt.journal as ApplyJournal;
      let recovered = true;
      try {
        const workspaceId = this.sites.workspaceId(journal.siteId);
        const workspace = this.workspaces.get(workspaceId);
        const root = workspace.config.workspace.root;
        for (const document of [...journal.documents].reverse()) {
          const current = await workspace.generator.readDocument(
            root,
            document.ref,
          );
          if (current.revision === document.sourceRevision) continue;
          if (
            canonical(current.frontMatter) !==
              canonical(document.frontMatter) ||
            current.body !== document.body
          ) {
            recovered = false;
            break;
          }
          await workspace.generator.writeDocument(root, {
            ref: document.ref,
            expectedRevision: current.revision,
            frontMatter: document.originalFrontMatter,
            body: document.originalBody,
          });
        }
      } catch {
        recovered = false;
      }
      this.repository.markApplyRecovery(
        attempt.id,
        recovered ? 'rolled-back' : 'recovery-required',
        this.now().toISOString(),
      );
      if (!recovered) {
        const record = this.repository.get(attempt.changeSetId);
        if (record?.status === 'prepared')
          this.repository.invalidate(
            attempt.changeSetId,
            this.now().toISOString(),
          );
      }
    }
  }

  public async commit(input: {
    readonly siteId: string;
    readonly changeSetId: string;
    readonly message: string;
    readonly paths: readonly string[];
  }): Promise<ChangeSetReview> {
    const changeSet = this.get(input.siteId, input.changeSetId);
    if (changeSet.status !== 'applied')
      throw new ChangeSetConflictError(
        'ChangeSet must be applied before commit',
      );
    const approved = new Set([
      ...changeSet.payload.documents.map((document) => document.path),
      ...changeSet.payload.repositoryChanges
        .filter(
          (entry) => entry.state !== 'ignored' && entry.state !== 'conflicted',
        )
        .map((entry) => entry.path),
    ]);
    const selected = new Set(input.paths);
    if ([...selected].some((path) => !approved.has(path)))
      throw new ChangeSetConflictError(
        'Commit selection contains a path outside the reviewed ChangeSet',
      );
    if (
      changeSet.payload.documents.some(
        (document) => !selected.has(document.path),
      )
    )
      throw new ChangeSetConflictError(
        'Every applied document must be included in the local commit',
      );
    const workspaceId = this.sites.workspaceId(input.siteId);
    const workspace = this.workspaces.get(workspaceId);
    const checkpoint = await workspace.repository.checkpoint(
      createWorkspaceId(workspaceId),
      workspace.config.workspace.root,
      input.message,
      [...selected],
    );
    return review(
      this.repository.markCommitted(
        input.changeSetId,
        checkpoint.commitId,
        this.now().toISOString(),
      ),
    );
  }
}
