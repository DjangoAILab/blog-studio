import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';

import {
  createReleaseId,
  createWorkspaceId,
  transitionRelease,
  type CacheInvalidation,
  type CacheProvider,
  type DocumentRef,
  type Publisher,
  type ReleaseRecord,
  type ReleaseManifest,
  type ReleaseStatus,
} from '@blog-studio/core';
import type {
  DraftSnapshot,
  SqliteChangeSetRepository,
  SqliteDraftRepository,
  SqliteReleaseRepository,
  StoredRelease,
} from '@blog-studio/persistence';
import { FilesystemPublisher } from '@blog-studio/publisher-filesystem';
import {
  HttpReleaseVerifier,
  RELEASE_MARKER_PATH,
  ReleaseOrchestrator,
  createReleaseManifest,
  hashReleaseManifest,
  type ReleaseVerifier,
} from '@blog-studio/release';

import type { WorkspaceHandle, WorkspaceService } from './workspaces.js';
import type { SiteService } from './sites.js';
import { createWorkspaceSandbox } from './workspace-sandbox.js';

export interface ReleaseDetails extends StoredRelease {
  readonly events: ReturnType<SqliteReleaseRepository['events']>;
}

export const BASELINE_ADOPTION_CONFIRMATION = 'ADOPT EXISTING DEPLOYMENT';

export class BaselineAdoptionRequiredError extends Error {
  public constructor() {
    super('Existing deployment baseline must be adopted before publishing');
    this.name = 'BaselineAdoptionRequiredError';
  }
}

export class BaselineAlreadyAdoptedError extends Error {
  public constructor() {
    super('A verified baseline already exists');
    this.name = 'BaselineAlreadyAdoptedError';
  }
}

export interface ReleaseServiceOptions {
  readonly workspaces: WorkspaceService;
  readonly repository: SqliteReleaseRepository;
  readonly drafts: SqliteDraftRepository;
  readonly sites: SiteService;
  readonly changeSets: SqliteChangeSetRepository;
  readonly stateDirectory: string;
  readonly verifierFactory?: (workspace: WorkspaceHandle) => ReleaseVerifier;
  readonly publisherFactories?: Readonly<
    Record<
      string,
      (workspace: WorkspaceHandle, stateDirectory: string) => Publisher
    >
  >;
  readonly cacheFactories?: Readonly<
    Record<string, (workspace: WorkspaceHandle) => CacheProvider | undefined>
  >;
  readonly now?: () => Date;
}

function stringOption(
  options: Readonly<Record<string, unknown>>,
  key: string,
  fallback?: string,
): string {
  const value = options[key] ?? fallback;
  if (typeof value !== 'string' || value.trim().length === 0)
    throw new Error(`publish.options.${key} must be a non-empty string`);
  return value;
}

function stringArrayOption(
  options: Readonly<Record<string, unknown>>,
  key: string,
): readonly string[] {
  const value = options[key];
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))
    throw new Error(`publish.options.${key} must be an array of strings`);
  return value as readonly string[];
}

function booleanOption(
  options: Readonly<Record<string, unknown>>,
  key: string,
  fallback = false,
): boolean {
  const value = options[key] ?? fallback;
  if (typeof value !== 'boolean')
    throw new Error(`publish.options.${key} must be a boolean`);
  return value;
}

function releaseTarget(workspace: WorkspaceHandle): string {
  return stringOption(
    workspace.config.publish.options,
    'targetId',
    workspace.config.publish.adapter === 'none' ? 'disabled' : 'production',
  );
}

function interruptedTerminal(status: ReleaseStatus): ReleaseStatus {
  return status === 'queued' ? 'canceled' : 'failed';
}

function rollbackInvalidation(
  current: ReleaseManifest,
  previous: ReleaseManifest,
  baseUrl: string,
): CacheInvalidation {
  const paths = new Set(
    [...current.entries, ...previous.entries]
      .filter((entry) => entry.cacheClass !== 'immutable')
      .map((entry) => entry.path),
  );
  return {
    urls: [...paths].map((path) => new URL(path, baseUrl).toString()),
    directories: [
      ...new Set(
        [...paths]
          .filter((path) => path.endsWith('.html'))
          .map((path) => new URL('.', new URL(path, baseUrl)).toString()),
      ),
    ],
  };
}

export class ReleaseService {
  readonly #active = new Map<string, AbortController>();
  readonly #runs = new Set<Promise<void>>();
  readonly #now: () => Date;

  public constructor(private readonly options: ReleaseServiceOptions) {
    this.#now = options.now ?? (() => new Date());
  }

  public target(workspace: WorkspaceHandle): {
    readonly id: string;
    readonly adapter: string;
    readonly configured: boolean;
    readonly baselineAdoption: 'disabled' | 'required' | 'complete';
  } {
    const adapter = workspace.config.publish.adapter;
    const configured =
      adapter === 'none'
        ? false
        : adapter === 'filesystem'
          ? typeof workspace.config.publish.options.directory === 'string'
          : Boolean(this.options.publisherFactories?.[adapter]);
    const adoptionEnabled = booleanOption(
      workspace.config.publish.options,
      'allowBaselineAdoption',
    );
    const adopted = Boolean(
      this.options.repository.latestSucceededManifest(
        createWorkspaceId(workspace.config.workspace.id),
        releaseTarget(workspace),
      ),
    );
    return {
      id: releaseTarget(workspace),
      adapter,
      configured,
      baselineAdoption: adoptionEnabled
        ? adopted
          ? 'complete'
          : 'required'
        : 'disabled',
    };
  }

  #publisher(workspace: WorkspaceHandle): Publisher {
    const adapter = workspace.config.publish.adapter;
    if (adapter === 'none') throw new Error('Publishing is disabled');
    const factory = this.options.publisherFactories?.[adapter];
    if (factory) return factory(workspace, this.options.stateDirectory);
    if (adapter === 'filesystem') {
      return new FilesystemPublisher({
        targetDirectory: stringOption(
          workspace.config.publish.options,
          'directory',
        ),
        stateDirectory: join(
          this.options.stateDirectory,
          workspace.config.workspace.id,
          releaseTarget(workspace),
        ),
        protectedPrefixes: stringArrayOption(
          workspace.config.publish.options,
          'protectedPrefixes',
        ),
      });
    }
    throw new Error(`Unsupported publish adapter: ${adapter}`);
  }

  #cache(workspace: WorkspaceHandle): CacheProvider | undefined {
    const adapter = workspace.config.cache?.adapter ?? 'none';
    if (adapter === 'none') return undefined;
    const factory = this.options.cacheFactories?.[adapter];
    if (!factory) throw new Error(`Unsupported cache adapter: ${adapter}`);
    return factory(workspace);
  }

  public list(workspaceId: string): readonly ReleaseDetails[] {
    return this.options.repository
      .list(createWorkspaceId(workspaceId))
      .map((stored) => ({
        ...stored,
        events: this.options.repository.events(stored.release.id),
      }));
  }

  public get(workspaceId: string, releaseId: string): ReleaseDetails {
    const stored = this.options.repository.get(createReleaseId(releaseId));
    if (
      !stored ||
      stored.release.workspaceId !== createWorkspaceId(workspaceId)
    )
      throw new Error(`Unknown release: ${releaseId}`);
    return {
      ...stored,
      events: this.options.repository.events(stored.release.id),
    };
  }

  public async start(
    workspaceId: string,
    targetId?: string,
    draftInput?: {
      readonly collectionId: string;
      readonly documentId: string;
      readonly version: number;
    },
    source?: { readonly changeSetId: string; readonly commitId: string },
  ): Promise<ReleaseDetails> {
    const workspace = this.options.workspaces.get(workspaceId);
    const configuredTarget = releaseTarget(workspace);
    if (targetId !== undefined && targetId !== configuredTarget)
      throw new Error(`Unknown release target: ${targetId}`);
    this.#publisher(workspace);
    this.#cache(workspace);
    if (!workspace.config.verification)
      throw new Error('Publishing requires verification.baseUrl');

    const previous = this.options.repository.latestSucceeded(
      createWorkspaceId(workspaceId),
      configuredTarget,
    );
    if (
      booleanOption(
        workspace.config.publish.options,
        'allowBaselineAdoption',
      ) &&
      !previous
    )
      throw new BaselineAdoptionRequiredError();

    let draft:
      | { readonly snapshot: DraftSnapshot; readonly ref: DocumentRef }
      | undefined;
    if (draftInput) {
      const { ref } = await this.options.workspaces.findDocument(
        workspaceId,
        draftInput.collectionId,
        draftInput.documentId,
      );
      const snapshot = this.options.drafts.get(ref.workspaceId, ref.documentId);
      if (!snapshot || snapshot.version !== draftInput.version)
        throw new Error('Draft changed before release started');
      draft = { snapshot, ref };
    }

    const now = this.#now().toISOString();
    const release: ReleaseRecord = {
      id: createReleaseId(`release-${randomUUID()}`),
      workspaceId: createWorkspaceId(workspaceId),
      targetId: configuredTarget,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
      stages: [],
      ...(previous ? { previousReleaseId: previous.release.id } : {}),
      ...(source
        ? {
            sourceChangeSetId: source.changeSetId,
            sourceCommitId: source.commitId,
          }
        : {}),
    };
    const stored = this.options.repository.create(release);
    const controller = new AbortController();
    this.#active.set(release.id, controller);
    const run = this.#execute(
      workspace,
      release,
      controller.signal,
      draft,
    ).finally(() => {
      this.#active.delete(release.id);
    });
    this.#runs.add(run);
    void run.then(
      () => this.#runs.delete(run),
      () => this.#runs.delete(run),
    );
    return { ...stored, events: [] };
  }

  public async startCommittedChangeSet(input: {
    readonly siteId: string;
    readonly changeSetId: string;
    readonly targetId?: string;
    readonly confirmation: string;
  }): Promise<ReleaseDetails> {
    if (input.confirmation !== 'RELEASE COMMITTED CHANGESET')
      throw new Error('Remote release confirmation did not match');
    const site = this.options.sites.get(input.siteId);
    const record = this.options.changeSets.get(input.changeSetId);
    if (
      !record ||
      record.siteId !== site.id ||
      record.status !== 'committed' ||
      !record.commitId
    )
      throw new Error('Remote release requires a committed ChangeSet');
    const workspaceId = this.options.sites.workspaceId(input.siteId);
    const workspace = this.options.workspaces.get(workspaceId);
    const repositoryStatus = await workspace.repository.status(
      createWorkspaceId(workspaceId),
      workspace.config.workspace.root,
    );
    const expectedHead = createHash('sha256')
      .update(record.commitId)
      .digest('hex');
    if (repositoryStatus.head !== `sha256:${expectedHead}`)
      throw new Error('Committed ChangeSet is not the current Site revision');
    return await this.start(workspaceId, input.targetId, undefined, {
      changeSetId: record.id,
      commitId: record.commitId,
    });
  }

  public adoptBaseline(
    workspaceId: string,
    targetId: string | undefined,
    confirmation: string,
  ): ReleaseDetails {
    if (confirmation !== BASELINE_ADOPTION_CONFIRMATION)
      throw new Error('Baseline adoption confirmation did not match');
    const workspace = this.options.workspaces.get(workspaceId);
    const configuredTarget = releaseTarget(workspace);
    if (targetId !== undefined && targetId !== configuredTarget)
      throw new Error(`Unknown release target: ${targetId}`);
    if (
      !booleanOption(workspace.config.publish.options, 'allowBaselineAdoption')
    )
      throw new Error('Baseline adoption is not enabled for this target');
    if (!workspace.config.verification)
      throw new Error('Baseline adoption requires verification.baseUrl');
    if (
      this.options.repository.latestSucceededManifest(
        createWorkspaceId(workspaceId),
        configuredTarget,
      )
    )
      throw new BaselineAlreadyAdoptedError();
    const publisher = this.#publisher(workspace);
    if (!publisher.adoptBaseline)
      throw new Error('Publisher does not support baseline adoption');
    this.#cache(workspace);

    const now = this.#now().toISOString();
    const release: ReleaseRecord = {
      id: createReleaseId(`release-${randomUUID()}`),
      workspaceId: createWorkspaceId(workspaceId),
      targetId: configuredTarget,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
      stages: [],
    };
    const stored = this.options.repository.create(release);
    const controller = new AbortController();
    this.#active.set(release.id, controller);
    const run = this.#execute(
      workspace,
      release,
      controller.signal,
      undefined,
      { adoptBaseline: true },
    ).finally(() => {
      this.#active.delete(release.id);
    });
    this.#runs.add(run);
    void run.then(
      () => this.#runs.delete(run),
      () => this.#runs.delete(run),
    );
    return { ...stored, events: [] };
  }

  async #execute(
    workspace: WorkspaceHandle,
    release: ReleaseRecord,
    signal: AbortSignal,
    draft?: { readonly snapshot: DraftSnapshot; readonly ref: DocumentRef },
    execution?: { readonly adoptBaseline?: boolean },
  ): Promise<void> {
    let persistedStatus = release.status;
    const previousManifest = this.options.repository.latestSucceededManifest(
      release.workspaceId,
      release.targetId,
    );
    const cache = this.#cache(workspace);
    const sandbox =
      draft || release.sourceCommitId
        ? await createWorkspaceSandbox(
            workspace,
            'release',
            release.sourceCommitId,
          )
        : undefined;
    try {
      const prepareDraft = async (workspaceRoot: string) => {
        if (!draft) return;
        const current = await workspace.generator.readDocument(
          workspaceRoot,
          draft.ref,
        );
        if (current.revision !== draft.snapshot.sourceRevision)
          throw new Error('Draft source revision conflict');
        const written = await workspace.generator.writeDocument(workspaceRoot, {
          ref: draft.ref,
          expectedRevision: draft.snapshot.sourceRevision,
          frontMatter: draft.snapshot.frontMatter,
          body: draft.snapshot.body,
          modifiedAt: release.createdAt,
        });
        if (draft.ref.collectionId === 'drafts') {
          if (!workspace.generator.promoteDocument)
            throw new Error(
              `Generator ${workspace.generator.id} does not support draft promotion`,
            );
          await workspace.generator.promoteDocument(workspaceRoot, {
            ref: draft.ref,
            targetCollectionId: 'posts',
            expectedRevision: written.revision,
          });
        }
      };
      const result = await new ReleaseOrchestrator({
        generator: workspace.generator,
        publisher: this.#publisher(workspace),
        ...(cache ? { cache } : {}),
        verifier:
          this.options.verifierFactory?.(workspace) ??
          new HttpReleaseVerifier(),
        baseUrl: workspace.config.verification!.baseUrl,
        protectedPrefixes: stringArrayOption(
          workspace.config.publish.options,
          'protectedPrefixes',
        ),
        ...(draft
          ? {
              prepare: () => prepareDraft(sandbox!.workspaceRoot),
              commit: async () => {
                await prepareDraft(workspace.config.workspace.root);
                if (
                  !this.options.drafts.delete(
                    draft.snapshot.workspaceId,
                    draft.snapshot.documentId,
                    draft.snapshot.version,
                  )
                )
                  throw new Error('Draft changed while committing release');
              },
            }
          : {}),
        onUpdate: (next) => {
          if (!this.options.repository.update(next, persistedStatus))
            throw new Error(
              `Release state changed concurrently: ${release.id}`,
            );
          persistedStatus = next.status;
          return Promise.resolve();
        },
        onEvent: (event) =>
          this.options.repository.appendEvent(release.id, event),
      }).run({
        release,
        workspaceRoot:
          sandbox?.workspaceRoot ?? workspace.config.workspace.root,
        ...(previousManifest ? { previousManifest } : {}),
        ...(execution?.adoptBaseline ? { adoptBaseline: true } : {}),
        signal,
      });
      if (result.manifest)
        this.options.repository.saveManifest(release.id, result.manifest);
    } finally {
      await sandbox?.dispose();
    }
  }

  public cancel(workspaceId: string, releaseId: string): ReleaseDetails {
    const details = this.get(workspaceId, releaseId);
    if (!this.#active.get(releaseId)) return details;
    this.#active.get(releaseId)!.abort();
    return details;
  }

  public rollback(workspaceId: string, releaseId: string): ReleaseDetails {
    const details = this.get(workspaceId, releaseId);
    const workspace = this.options.workspaces.get(workspaceId);
    if (details.release.status !== 'succeeded' || !details.manifest)
      throw new Error('Only a verified release can be rolled back');
    if (!details.release.previousReleaseId)
      throw new Error('Release has no previous verified version');
    const previous = this.options.repository.get(
      details.release.previousReleaseId,
    );
    if (!previous?.manifest || previous.release.status !== 'succeeded')
      throw new Error('Previous verified release manifest is unavailable');
    this.#publisher(workspace);
    this.#cache(workspace);

    const rollbackRequired = transitionRelease(
      details.release,
      'rollback-required',
      this.#now().toISOString(),
    );
    if (!this.options.repository.update(rollbackRequired, 'succeeded'))
      throw new Error(`Release state changed concurrently: ${releaseId}`);
    const run = this.#executeRollback(
      workspace,
      rollbackRequired,
      details.manifest,
      previous.manifest,
    );
    this.#runs.add(run);
    void run.then(
      () => this.#runs.delete(run),
      () => this.#runs.delete(run),
    );
    return {
      ...details,
      release: rollbackRequired,
      events: this.options.repository.events(rollbackRequired.id),
    };
  }

  async #executeRollback(
    workspace: WorkspaceHandle,
    release: ReleaseRecord,
    currentManifest: ReleaseManifest,
    previousManifest: ReleaseManifest,
  ): Promise<void> {
    let current = release;
    const persist = (next: ReleaseRecord) => {
      if (!this.options.repository.update(next, current.status))
        throw new Error(`Release state changed concurrently: ${release.id}`);
      current = next;
    };
    try {
      persist(
        transitionRelease(current, 'rolling-back', this.#now().toISOString()),
      );
      await this.#publisher(workspace).rollback(current);
      const cache = this.#cache(workspace);
      if (cache)
        await cache.invalidate(
          rollbackInvalidation(
            currentManifest,
            previousManifest,
            workspace.config.verification!.baseUrl,
          ),
        );
      const baseline = createReleaseManifest({
        ...previousManifest,
        entries: previousManifest.entries.filter(
          (entry) => entry.path !== RELEASE_MARKER_PATH,
        ),
      });
      const verifier =
        this.options.verifierFactory?.(workspace) ?? new HttpReleaseVerifier();
      const verified = await verifier.verify({
        baseUrl: workspace.config.verification!.baseUrl,
        markerPath: RELEASE_MARKER_PATH,
        expectedReleaseId: previousManifest.releaseId,
        expectedVerificationToken: previousManifest.verificationToken,
        expectedManifestHash: hashReleaseManifest(baseline),
      });
      if (!verified)
        throw new Error('Rolled-back public marker verification failed');
      persist(
        transitionRelease(current, 'rolled-back', this.#now().toISOString()),
      );
      this.options.repository.appendEvent(release.id, {
        at: this.#now().toISOString(),
        stage: 'rolling-back',
        level: 'info',
        message: `Restored verified release ${previousManifest.releaseId}`,
      });
    } catch (error) {
      if (current.status === 'rolling-back')
        persist(
          transitionRelease(current, 'failed', this.#now().toISOString()),
        );
      this.options.repository.appendEvent(release.id, {
        at: this.#now().toISOString(),
        stage: 'rolling-back',
        level: 'error',
        message: error instanceof Error ? error.message : 'Rollback failed',
      });
    }
  }

  public async recover(): Promise<void> {
    for (const stored of this.options.repository.active()) {
      const { release } = stored;
      const workspace = this.options.workspaces.get(release.workspaceId);
      const at = this.#now().toISOString();
      const persist = (next: ReleaseRecord, expected: ReleaseStatus) => {
        if (!this.options.repository.update(next, expected))
          throw new Error(
            `Release state changed during recovery: ${release.id}`,
          );
      };
      if (
        ['queued', 'preflight', 'building', 'planning'].includes(release.status)
      ) {
        const status = interruptedTerminal(release.status);
        const next =
          release.status === 'queued'
            ? transitionRelease(release, status, at)
            : transitionRelease(release, status, at);
        persist(next, release.status);
        this.options.repository.appendEvent(release.id, {
          at,
          stage: release.status,
          level: 'warning',
          message: 'Release was safely stopped after service restart',
        });
        continue;
      }
      let current = release;
      try {
        if (current.status !== 'rolling-back') {
          if (current.status !== 'rollback-required') {
            const next = transitionRelease(current, 'rollback-required', at);
            persist(next, current.status);
            current = next;
          }
          const next = transitionRelease(current, 'rolling-back', at);
          persist(next, current.status);
          current = next;
        }
        const publisher = this.#publisher(workspace);
        const recovered = publisher.recoverInterrupted
          ? await publisher.recoverInterrupted(current)
          : {
              outcome: 'rolled-back' as const,
              rollback: await publisher.rollback(current),
            };
        const next = transitionRelease(
          current,
          recovered.outcome === 'rolled-back' ? 'rolled-back' : 'failed',
          this.#now().toISOString(),
        );
        persist(next, current.status);
        this.options.repository.appendEvent(release.id, {
          at: this.#now().toISOString(),
          stage: 'rolling-back',
          level: 'warning',
          message:
            recovered.outcome === 'rolled-back'
              ? 'Interrupted release was rolled back after service restart'
              : 'Release was safely stopped before provider mutation was prepared',
        });
      } catch (error) {
        const failed = transitionRelease(
          current,
          'failed',
          this.#now().toISOString(),
        );
        persist(failed, current.status);
        this.options.repository.appendEvent(release.id, {
          at: this.#now().toISOString(),
          stage: 'rolling-back',
          level: 'error',
          message:
            error instanceof Error ? error.message : 'Restart rollback failed',
        });
      }
    }
  }

  public async dispose(): Promise<void> {
    for (const controller of this.#active.values()) controller.abort();
    await Promise.allSettled(this.#runs);
  }
}
