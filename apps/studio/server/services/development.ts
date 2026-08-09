import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

import type { WorkspaceService } from './workspaces.js';
import type {
  ContentHash,
  DocumentRef,
  FrontMatterValue,
} from '@blog-studio/core';
import {
  createWorkspaceSandbox,
  type WorkspaceSandbox,
} from './workspace-sandbox.js';

export type DevelopmentStatus = 'stopped' | 'starting' | 'ready' | 'failed';

export interface DevelopmentSnapshot {
  readonly workspaceId: string;
  readonly status: DevelopmentStatus;
  readonly baseUrl?: string;
  readonly previewUrl?: string;
  readonly startedAt?: string;
  readonly message?: string;
  readonly logs: readonly string[];
}

interface ActiveDevelopment {
  readonly workspaceId: string;
  readonly process: ChildProcess;
  readonly sandbox: WorkspaceSandbox;
  readonly baseUrl: string;
  readonly previewUrl?: string;
  readonly startedAt: string;
  readonly logLimit: number;
  logs: string[];
  status: DevelopmentStatus;
  message?: string;
}

function processEnvironment(allowlist: readonly string[]): NodeJS.ProcessEnv {
  const required = ['PATH', 'SYSTEMROOT', 'WINDIR'];
  return Object.fromEntries(
    [...new Set([...required, ...allowlist])].flatMap((key) => {
      const value = process.env[key];
      return value === undefined ? [] : [[key, value]];
    }),
  );
}

function appendLogs(active: ActiveDevelopment, chunk: Buffer | string): void {
  const lines = chunk
    .toString()
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
  active.logs.push(...lines);
  if (active.logs.length > active.logLimit)
    active.logs.splice(0, active.logs.length - active.logLimit);
}

export class DevelopmentService {
  readonly #active = new Map<string, ActiveDevelopment>();

  public constructor(
    private readonly workspaces: WorkspaceService,
    private readonly stateDirectory: string,
  ) {}

  public snapshot(workspaceId: string): DevelopmentSnapshot {
    const active = this.#active.get(workspaceId);
    if (!active) return { workspaceId, status: 'stopped', logs: [] };
    return {
      workspaceId,
      status: active.status,
      baseUrl: active.baseUrl,
      ...(active.previewUrl ? { previewUrl: active.previewUrl } : {}),
      startedAt: active.startedAt,
      ...(active.message ? { message: active.message } : {}),
      logs: active.logs,
    };
  }

  public async start(workspaceId: string): Promise<DevelopmentSnapshot> {
    const existing = this.#active.get(workspaceId);
    if (existing?.status === 'ready' || existing?.status === 'starting')
      return this.snapshot(workspaceId);
    if (existing) await this.stop(workspaceId);
    const workspace = this.workspaces.get(workspaceId);
    const config = workspace.config.development;
    if (!config)
      throw new Error('Local development is not configured for this Site');
    await mkdir(this.stateDirectory, { recursive: true });
    const sandbox = await createWorkspaceSandbox(
      workspace,
      'development',
      undefined,
      join(this.stateDirectory, workspaceId),
    );
    const startedAt = new Date().toISOString();
    let child: ChildProcess;
    try {
      child = spawn(config.command, config.args, {
        cwd: sandbox.workspaceRoot,
        env: processEnvironment(config.environmentAllowlist),
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      await sandbox.dispose();
      throw error;
    }
    const active: ActiveDevelopment = {
      workspaceId,
      process: child,
      sandbox,
      baseUrl: config.baseUrl,
      ...(config.previewUrl ? { previewUrl: config.previewUrl } : {}),
      startedAt,
      logLimit: config.logLimit,
      logs: [],
      status: 'starting',
    };
    this.#active.set(workspaceId, active);
    child.stdout?.on('data', (chunk: Buffer) => appendLogs(active, chunk));
    child.stderr?.on('data', (chunk: Buffer) => appendLogs(active, chunk));
    child.once('error', (error) => {
      active.status = 'failed';
      active.message = error.message;
    });
    child.once('exit', (code, signal) => {
      if (active.status === 'stopped') return;
      active.status = 'failed';
      active.message = `Development process exited (${signal ?? code ?? 'unknown'})`;
    });
    try {
      await this.#waitForReady(
        active,
        config.readinessPath,
        config.startupTimeoutMs,
      );
      active.status = 'ready';
    } catch (error) {
      active.status = 'failed';
      active.message =
        error instanceof Error
          ? error.message
          : 'Development process did not become ready';
    }
    return this.snapshot(workspaceId);
  }

  async #waitForReady(
    active: ActiveDevelopment,
    readinessPath: string | undefined,
    timeoutMs: number,
  ): Promise<void> {
    const url = new URL(readinessPath ?? '/', active.baseUrl).toString();
    const deadline = Date.now() + timeoutMs;
    let lastError = 'readiness check did not succeed';
    while (Date.now() < deadline) {
      if (active.status === 'failed') throw new Error(active.message);
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(2_000),
        });
        if (response.ok) return;
        lastError = `readiness endpoint returned HTTP ${response.status}`;
      } catch (error) {
        lastError = error instanceof Error ? error.message : lastError;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Local development did not become ready: ${lastError}`);
  }

  public async stop(workspaceId: string): Promise<DevelopmentSnapshot> {
    const active = this.#active.get(workspaceId);
    if (!active) return this.snapshot(workspaceId);
    active.status = 'stopped';
    active.process.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        active.process.kill('SIGKILL');
        resolve();
      }, 5_000);
      active.process.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    this.#active.delete(workspaceId);
    await active.sandbox.dispose();
    return { workspaceId, status: 'stopped', logs: [] };
  }

  public async restart(workspaceId: string): Promise<DevelopmentSnapshot> {
    await this.stop(workspaceId);
    return await this.start(workspaceId);
  }

  public async sync(input: {
    readonly workspaceId: string;
    readonly ref: DocumentRef;
    readonly sourceRevision: ContentHash;
    readonly frontMatter: Readonly<Record<string, FrontMatterValue>>;
    readonly body: string;
  }): Promise<DevelopmentSnapshot> {
    const active = this.#active.get(input.workspaceId);
    if (!active || active.status !== 'ready')
      return this.snapshot(input.workspaceId);
    const workspace = this.workspaces.get(input.workspaceId);
    try {
      await workspace.generator.writeDocument(active.sandbox.workspaceRoot, {
        ref: input.ref,
        expectedRevision: input.sourceRevision,
        frontMatter: input.frontMatter,
        body: input.body,
      });
      return this.snapshot(input.workspaceId);
    } catch (error) {
      active.status = 'failed';
      active.message =
        error instanceof Error
          ? `Local working-copy sync failed: ${error.message}`
          : 'Local working-copy sync failed';
      return this.snapshot(input.workspaceId);
    }
  }

  public async dispose(): Promise<void> {
    await Promise.all(
      [...this.#active.keys()].map((workspaceId) => this.stop(workspaceId)),
    );
    await rm(this.stateDirectory, { force: true, recursive: true });
  }
}
