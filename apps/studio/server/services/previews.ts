import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { resolveWorkspacePath } from '@blog-studio/adapter-command';
import type {
  ContentHash,
  DocumentRef,
  FrontMatterValue,
  ManifestEntry,
} from '@blog-studio/core';

import type { WorkspaceService } from './workspaces.js';
import { createWorkspaceSandbox } from './workspace-sandbox.js';

export interface PreviewDraft {
  readonly version: number;
  readonly sourceRevision: ContentHash;
  readonly frontMatter: Readonly<Record<string, FrontMatterValue>>;
  readonly body: string;
}

export type PreviewFallbackReason =
  | 'missing-output'
  | 'route-error'
  | 'build-error'
  | 'timeout'
  | 'unsupported-engine'
  | 'canceled'
  | 'restart';

export class PreviewReadinessError extends Error {
  public constructor(
    readonly reason: PreviewFallbackReason,
    message: string,
  ) {
    super(message);
    this.name = 'PreviewReadinessError';
  }
}

export interface PreviewSession {
  readonly id: string;
  readonly workspaceId: string;
  readonly workspaceDirectory: string;
  readonly sourceDirectory: string;
  readonly ref: DocumentRef;
  readonly outputDirectory: string;
  readonly manifest: readonly ManifestEntry[];
  readonly contentPath: string;
  readonly fingerprint: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

interface ActivePreview {
  readonly fingerprint: string;
  readonly controller: AbortController;
  readonly promise: Promise<PreviewSession>;
}

export class PreviewService {
  readonly #sessions = new Map<string, PreviewSession>();
  readonly #active = new Map<string, ActivePreview>();

  public constructor(
    private readonly workspaces: WorkspaceService,
    private readonly idleMs = 5 * 60_000,
    private readonly sandboxDirectory = join(
      tmpdir(),
      `blog-studio-preview-service-${randomUUID()}`,
    ),
  ) {}

  public async recover(): Promise<number> {
    if (this.#active.size > 0 || this.#sessions.size > 0)
      throw new Error('Preview recovery is only valid before serving requests');
    await mkdir(this.sandboxDirectory, { recursive: true });
    const root = await lstat(this.sandboxDirectory);
    if (!root.isDirectory() || root.isSymbolicLink())
      throw new Error('Preview sandbox state path must be a real directory');
    const entries = await readdir(this.sandboxDirectory);
    await Promise.all(
      entries.map(async (entry) =>
        rm(join(this.sandboxDirectory, entry), {
          force: true,
          recursive: true,
        }),
      ),
    );
    return entries.length;
  }

  async #disposeSession(session: PreviewSession): Promise<void> {
    await rm(session.workspaceDirectory, { force: true, recursive: true });
  }

  public async start(input: {
    readonly workspaceId: string;
    readonly ref: DocumentRef;
    readonly sourceRevision: ContentHash;
    readonly source: {
      readonly frontMatter: Readonly<Record<string, FrontMatterValue>>;
      readonly body: string;
    };
    readonly draft?: PreviewDraft;
  }): Promise<PreviewSession> {
    const fingerprint = `${input.ref.documentId}:${input.sourceRevision}:${input.draft?.version ?? 0}`;
    const active = this.#active.get(input.workspaceId);
    if (active?.fingerprint === fingerprint) {
      try {
        return await active.promise;
      } catch (error) {
        if (active.controller.signal.aborted)
          throw new PreviewReadinessError(
            'canceled',
            'Enhanced preview was canceled',
          );
        throw error;
      }
    }
    if (active) {
      active.controller.abort();
      await active.promise.catch(() => undefined);
    }

    const controller = new AbortController();
    const promise = this.#start(input, fingerprint, controller.signal);
    const current = { fingerprint, controller, promise };
    this.#active.set(input.workspaceId, current);
    try {
      return await promise;
    } catch (error) {
      if (controller.signal.aborted)
        throw new PreviewReadinessError(
          'canceled',
          'Enhanced preview was canceled',
        );
      throw error;
    } finally {
      if (this.#active.get(input.workspaceId) === current)
        this.#active.delete(input.workspaceId);
    }
  }

  async #start(
    input: {
      readonly workspaceId: string;
      readonly ref: DocumentRef;
      readonly sourceRevision: ContentHash;
      readonly source: {
        readonly frontMatter: Readonly<Record<string, FrontMatterValue>>;
        readonly body: string;
      };
      readonly draft?: PreviewDraft;
    },
    fingerprint: string,
    signal: AbortSignal,
  ): Promise<PreviewSession> {
    signal.throwIfAborted();
    const now = Date.now();
    const existing = this.#sessions.get(input.workspaceId);
    if (
      existing &&
      existing.fingerprint === fingerprint &&
      Date.parse(existing.expiresAt) > now
    ) {
      try {
        await stat(existing.outputDirectory);
        return existing;
      } catch {
        this.#sessions.delete(input.workspaceId);
        await this.#disposeSession(existing);
      }
    } else if (existing) {
      this.#sessions.delete(input.workspaceId);
      await this.#disposeSession(existing);
    }

    const workspace = this.workspaces.get(input.workspaceId);
    if (!workspace.generator.capabilities.preview) {
      throw new PreviewReadinessError(
        'unsupported-engine',
        `Generator ${workspace.generator.id} does not support enhanced preview`,
      );
    }
    const sandbox = await createWorkspaceSandbox(
      workspace,
      'preview',
      undefined,
      this.sandboxDirectory,
    );
    const isolatedWorkspace = sandbox.workspaceRoot;
    const temporaryRoot = dirname(isolatedWorkspace);
    const id = randomUUID();
    const marker = `blog-studio-preview:${id}`;
    try {
      signal.throwIfAborted();
      let previewRef = input.ref;
      if (input.draft && input.draft.sourceRevision !== input.sourceRevision) {
        throw new Error('Draft source revision conflict');
      }
      const previewSource = input.draft ?? input.source;
      const written = await workspace.generator.writeDocument(
        isolatedWorkspace,
        {
          ref: input.ref,
          expectedRevision: input.sourceRevision,
          frontMatter: previewSource.frontMatter,
          body: `${previewSource.body}\n<span data-blog-studio-preview="${id}" hidden>${marker}</span>\n`,
        },
      );
      signal.throwIfAborted();
      const previewRevision = written.revision;
      if (input.ref.collectionId === 'drafts') {
        if (!workspace.generator.promoteDocument)
          throw new Error(
            `Generator ${workspace.generator.id} does not support draft preview promotion`,
          );
        const promoted = await workspace.generator.promoteDocument(
          isolatedWorkspace,
          {
            ref: input.ref,
            targetCollectionId: 'posts',
            expectedRevision: previewRevision,
          },
        );
        previewRef = promoted.ref;
      }
      signal.throwIfAborted();
      const publicUrl = await workspace.generator.resolvePublicUrl(
        isolatedWorkspace,
        previewRef,
      );
      const build = await workspace.generator.build({
        workspaceRoot: isolatedWorkspace,
        mode: 'preview',
        signal,
      });
      signal.throwIfAborted();
      const contentPath = new URL(publicUrl).pathname;
      const targetPath = contentPath.endsWith('/')
        ? `${contentPath.slice(1)}index.html`
        : contentPath.slice(1);
      let generatedTarget: string;
      try {
        generatedTarget = await resolveWorkspacePath(
          build.outputDirectory,
          targetPath,
        );
      } catch {
        throw new PreviewReadinessError(
          'missing-output',
          `Enhanced preview output is missing: ${contentPath}`,
        );
      }
      const targetDetails = await stat(generatedTarget);
      if (!targetDetails.isFile()) {
        throw new PreviewReadinessError(
          'missing-output',
          `Enhanced preview target is not a file: ${contentPath}`,
        );
      }
      const generatedHtml = await readFile(generatedTarget, 'utf8');
      if (!generatedHtml.includes(marker)) {
        throw new PreviewReadinessError(
          'route-error',
          'Enhanced preview target did not render the expected session marker',
        );
      }
      const session: PreviewSession = {
        id,
        workspaceId: input.workspaceId,
        workspaceDirectory: temporaryRoot,
        sourceDirectory: isolatedWorkspace,
        ref: previewRef,
        outputDirectory: build.outputDirectory,
        manifest: build.manifest,
        contentPath,
        fingerprint,
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + this.idleMs).toISOString(),
      };
      this.#sessions.set(input.workspaceId, session);
      return session;
    } catch (error) {
      await rm(temporaryRoot, { force: true, recursive: true });
      throw error;
    }
  }

  public async stop(workspaceId: string): Promise<boolean> {
    const active = this.#active.get(workspaceId);
    if (active) {
      active.controller.abort();
      await active.promise.catch(() => undefined);
    }
    const session = this.#sessions.get(workspaceId);
    if (!session) return active !== undefined;
    this.#sessions.delete(workspaceId);
    await this.#disposeSession(session);
    return true;
  }

  public get(previewId: string, now = Date.now()): PreviewSession {
    const preview = [...this.#sessions.values()].find(
      (session) => session.id === previewId,
    );
    if (!preview || Date.parse(preview.expiresAt) <= now) {
      throw new Error(`Unknown preview: ${previewId}`);
    }
    return preview;
  }

  public async reapExpired(now = Date.now()): Promise<number> {
    let reaped = 0;
    for (const [workspaceId, session] of this.#sessions) {
      if (Date.parse(session.expiresAt) <= now) {
        this.#sessions.delete(workspaceId);
        await this.#disposeSession(session);
        reaped++;
      }
    }
    return reaped;
  }

  public async dispose(): Promise<void> {
    const active = [...this.#active.values()];
    for (const preview of active) preview.controller.abort();
    await Promise.all(
      active.map(async (preview) => preview.promise.catch(() => undefined)),
    );
    const sessions = [...this.#sessions.values()];
    this.#sessions.clear();
    await Promise.all(
      sessions.map(async (session) => this.#disposeSession(session)),
    );
  }
}
