import { randomUUID } from 'node:crypto';
import { readFile, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

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

export class PreviewService {
  readonly #sessions = new Map<string, PreviewSession>();

  public constructor(
    private readonly workspaces: WorkspaceService,
    private readonly idleMs = 5 * 60_000,
  ) {}

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
    const now = Date.now();
    const fingerprint = `${input.ref.documentId}:${input.sourceRevision}:${input.draft?.version ?? 0}`;
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
    const sandbox = await createWorkspaceSandbox(workspace, 'preview');
    const isolatedWorkspace = sandbox.workspaceRoot;
    const temporaryRoot = dirname(isolatedWorkspace);
    const id = randomUUID();
    const marker = `blog-studio-preview:${id}`;
    try {
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
      const publicUrl = await workspace.generator.resolvePublicUrl(
        isolatedWorkspace,
        previewRef,
      );
      const build = await workspace.generator.build({
        workspaceRoot: isolatedWorkspace,
        mode: 'preview',
      });
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
    const session = this.#sessions.get(workspaceId);
    if (!session) return false;
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
    const sessions = [...this.#sessions.values()];
    this.#sessions.clear();
    await Promise.all(
      sessions.map(async (session) => this.#disposeSession(session)),
    );
  }
}
