import { randomUUID } from 'node:crypto';
import { cp, mkdtemp, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';

import { resolveWorkspacePath } from '@blog-studio/adapter-command';
import type {
  ContentHash,
  DocumentRef,
  FrontMatterValue,
  ManifestEntry,
} from '@blog-studio/core';

import type { WorkspaceService } from './workspaces.js';

export interface PreviewDraft {
  readonly version: number;
  readonly sourceRevision: ContentHash;
  readonly frontMatter: Readonly<Record<string, FrontMatterValue>>;
  readonly body: string;
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

  async #isolatedWorkspace(workspaceId: string): Promise<string> {
    const workspace = this.workspaces.get(workspaceId);
    const sourceRoot = await resolveWorkspacePath(
      workspace.config.workspace.root,
      '.',
    );
    const model = await workspace.generator.inspect(sourceRoot);
    const outputPath = relative(sourceRoot, model.outputDirectory);
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'blog-studio-preview-'));
    const destination = join(temporaryRoot, 'workspace');
    const excludedRoots = new Set(['.git', 'node_modules']);
    if (outputPath && !outputPath.startsWith('..'))
      excludedRoots.add(outputPath.split(sep)[0] ?? outputPath);

    try {
      await cp(sourceRoot, destination, {
        recursive: true,
        filter(source) {
          const path = relative(sourceRoot, source);
          const root = path.split(sep)[0];
          return path === '' || !root || !excludedRoots.has(root);
        },
      });
      const dependencies = join(sourceRoot, 'node_modules');
      try {
        await stat(dependencies);
        await symlink(
          dependencies,
          join(destination, 'node_modules'),
          process.platform === 'win32' ? 'junction' : 'dir',
        );
      } catch {
        // A generator may use a globally installed executable instead.
      }
      return destination;
    } catch (error) {
      await rm(temporaryRoot, { force: true, recursive: true });
      throw error;
    }
  }

  public async start(input: {
    readonly workspaceId: string;
    readonly ref: DocumentRef;
    readonly sourceRevision: ContentHash;
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
    const isolatedWorkspace = await this.#isolatedWorkspace(input.workspaceId);
    const temporaryRoot = dirname(isolatedWorkspace);
    try {
      if (input.draft) {
        if (input.draft.sourceRevision !== input.sourceRevision)
          throw new Error('Draft source revision conflict');
        await workspace.generator.writeDocument(isolatedWorkspace, {
          ref: input.ref,
          expectedRevision: input.sourceRevision,
          frontMatter: input.draft.frontMatter,
          body: input.draft.body,
        });
      }
      const publicUrl = await workspace.generator.resolvePublicUrl(
        isolatedWorkspace,
        input.ref,
      );
      const build = await workspace.generator.build({
        workspaceRoot: isolatedWorkspace,
        mode: 'preview',
      });
      const session: PreviewSession = {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        workspaceDirectory: temporaryRoot,
        sourceDirectory: isolatedWorkspace,
        ref: input.ref,
        outputDirectory: build.outputDirectory,
        manifest: build.manifest,
        contentPath: new URL(publicUrl).pathname,
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
