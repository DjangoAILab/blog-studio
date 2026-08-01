import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';

import type { ManifestEntry } from '@blog-studio/core';

import type { WorkspaceService } from './workspaces.js';

export interface PreviewSession {
  readonly id: string;
  readonly workspaceId: string;
  readonly outputDirectory: string;
  readonly manifest: readonly ManifestEntry[];
  readonly createdAt: string;
  readonly expiresAt: string;
}

export class PreviewService {
  readonly #sessions = new Map<string, PreviewSession>();

  public constructor(
    private readonly workspaces: WorkspaceService,
    private readonly idleMs = 5 * 60_000,
  ) {}

  public async start(workspaceId: string): Promise<PreviewSession> {
    const now = Date.now();
    const existing = this.#sessions.get(workspaceId);
    if (existing && Date.parse(existing.expiresAt) > now) {
      try {
        await stat(existing.outputDirectory);
        return existing;
      } catch {
        this.#sessions.delete(workspaceId);
      }
    }

    const workspace = this.workspaces.get(workspaceId);
    const build = await workspace.generator.build({
      workspaceRoot: workspace.config.workspace.root,
      mode: 'preview',
    });
    const session: PreviewSession = {
      id: randomUUID(),
      workspaceId,
      outputDirectory: build.outputDirectory,
      manifest: build.manifest,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + this.idleMs).toISOString(),
    };
    this.#sessions.set(workspaceId, session);
    return session;
  }

  public stop(workspaceId: string): boolean {
    return this.#sessions.delete(workspaceId);
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

  public reapExpired(now = Date.now()): number {
    let reaped = 0;
    for (const [workspaceId, session] of this.#sessions) {
      if (Date.parse(session.expiresAt) <= now) {
        this.#sessions.delete(workspaceId);
        reaped++;
      }
    }
    return reaped;
  }
}
