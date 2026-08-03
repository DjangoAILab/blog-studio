import { createHash, randomUUID } from 'node:crypto';
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import {
  ADAPTER_API_VERSION,
  createReleaseId,
  type ManifestEntry,
  type PublishEventSink,
  type PublishInput,
  type PublishPlan,
  type Publisher,
  type ReleaseRecord,
} from '@blog-studio/core';
import { createPublishPlan } from '@blog-studio/release';

export interface FilesystemPublisherOptions {
  readonly targetDirectory: string;
  readonly stateDirectory: string;
  readonly protectedPrefixes?: readonly string[];
  readonly now?: () => Date;
}

interface RollbackState {
  readonly version: 1;
  readonly plan: PublishPlan;
  readonly backedUpPaths: readonly string[];
}

function isInside(root: string, path: string): boolean {
  const value = relative(root, path);
  return (
    value === '' ||
    (!value.startsWith(`..${sep}`) && value !== '..' && !isAbsolute(value))
  );
}

function validatePortablePath(path: string): readonly string[] {
  const parts = path.split('/');
  if (
    !path ||
    path.startsWith('/') ||
    path.includes('\\') ||
    parts.some((part) => !part || part === '.' || part === '..')
  )
    throw new Error(`Unsafe publish path: ${path}`);
  return parts;
}

async function safeDestination(root: string, path: string): Promise<string> {
  const canonicalRoot = await realpath(root);
  const parts = validatePortablePath(path);
  let current = canonicalRoot;
  for (const part of parts) {
    current = resolve(current, part);
    if (!isInside(canonicalRoot, current))
      throw new Error(`Publish path escaped root: ${path}`);
    try {
      if ((await lstat(current)).isSymbolicLink())
        throw new Error(`Publish path contains a symlink: ${path}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return current;
}

async function safeExistingSource(root: string, path: string): Promise<string> {
  const canonicalRoot = await realpath(root);
  const candidate = resolve(canonicalRoot, ...validatePortablePath(path));
  const canonical = await realpath(candidate);
  if (!isInside(canonicalRoot, canonical))
    throw new Error(`Publish source escaped root: ${path}`);
  return canonical;
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function atomicWrite(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.blog-studio-${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes, { flag: 'wx' });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

function hash(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function isProtected(path: string, prefixes: readonly string[]): boolean {
  return prefixes.some(
    (prefix) =>
      path === prefix || path.startsWith(`${prefix.replace(/\/$/, '')}/`),
  );
}

export class FilesystemPublisher implements Publisher {
  public readonly apiVersion = ADAPTER_API_VERSION;
  public readonly id = 'filesystem';
  public readonly displayName = 'Filesystem publisher';
  readonly #targetDirectory: string;
  readonly #stateDirectory: string;
  readonly #protectedPrefixes: readonly string[];
  readonly #now: () => Date;

  public constructor(options: FilesystemPublisherOptions) {
    this.#targetDirectory = resolve(options.targetDirectory);
    this.#stateDirectory = resolve(options.stateDirectory);
    this.#protectedPrefixes = options.protectedPrefixes ?? [];
    this.#now = options.now ?? (() => new Date());
  }

  public async plan(input: PublishInput): Promise<PublishPlan> {
    await Promise.all([
      mkdir(this.#targetDirectory, { recursive: true }),
      mkdir(this.#stateDirectory, { recursive: true }),
    ]);
    return createPublishPlan(
      input.outputDirectory,
      input.manifest,
      input.previousManifest,
      this.#protectedPrefixes,
    );
  }

  #releaseStateDirectory(releaseId: string): string {
    createReleaseId(releaseId);
    return resolve(this.#stateDirectory, 'releases', releaseId);
  }

  async #prepare(plan: PublishPlan): Promise<RollbackState> {
    const stateDirectory = this.#releaseStateDirectory(plan.releaseId);
    const statePath = resolve(stateDirectory, 'rollback.json');
    if (await exists(statePath))
      return JSON.parse(await readFile(statePath, 'utf8')) as RollbackState;

    const rollbackRoot = resolve(stateDirectory, 'files');
    await mkdir(rollbackRoot, { recursive: true });
    const paths = [
      ...new Set(
        [...plan.additions, ...plan.changes, ...plan.deletions].map(
          (entry) => entry.path,
        ),
      ),
    ];
    const backedUpPaths: string[] = [];
    for (const path of paths) {
      const target = await safeDestination(this.#targetDirectory, path);
      if (!(await exists(target))) continue;
      const backup = await safeDestination(rollbackRoot, path);
      await mkdir(dirname(backup), { recursive: true });
      await copyFile(target, backup);
      backedUpPaths.push(path);
    }
    const state: RollbackState = { version: 1, plan, backedUpPaths };
    await atomicWrite(statePath, Buffer.from(`${JSON.stringify(state)}\n`));
    return state;
  }

  async #verifiedSources(
    sourceDirectory: string,
    entries: readonly ManifestEntry[],
  ): Promise<ReadonlyMap<string, Uint8Array>> {
    const sources = new Map<string, Uint8Array>();
    for (const entry of entries) {
      const source = await safeExistingSource(sourceDirectory, entry.path);
      const bytes = await readFile(source);
      if (
        bytes.byteLength !== entry.byteLength ||
        hash(bytes) !== entry.contentHash
      )
        throw new Error(`Source hash or size mismatch: ${entry.path}`);
      sources.set(entry.path, bytes);
    }
    return sources;
  }

  public async apply(
    plan: PublishPlan,
    phase: 'assets' | 'pages',
    events: PublishEventSink,
  ): Promise<{ readonly uploaded: number; readonly deleted: number }> {
    await this.#prepare(plan);
    const selected = [...plan.additions, ...plan.changes].filter((entry) =>
      phase === 'assets'
        ? entry.cacheClass === 'immutable'
        : entry.cacheClass !== 'immutable',
    );
    const sources = await this.#verifiedSources(plan.sourceDirectory, selected);
    let uploaded = 0;
    for (const entry of selected) {
      const destination = await safeDestination(
        this.#targetDirectory,
        entry.path,
      );
      await atomicWrite(destination, sources.get(entry.path)!);
      uploaded++;
      events({
        at: this.#now().toISOString(),
        stage: phase === 'assets' ? 'uploading-assets' : 'uploading-pages',
        level: 'info',
        message: `Published ${entry.path}`,
        completed: uploaded,
        total: selected.length,
      });
    }
    let deleted = 0;
    if (phase === 'pages') {
      for (const entry of plan.deletions) {
        if (isProtected(entry.path, plan.protectedPrefixes)) continue;
        const destination = await safeDestination(
          this.#targetDirectory,
          entry.path,
        );
        await rm(destination, { force: true });
        deleted++;
      }
    }
    return { uploaded, deleted };
  }

  public async finalize(plan: PublishPlan) {
    const stateDirectory = this.#releaseStateDirectory(plan.releaseId);
    const releaseManifest = resolve(stateDirectory, 'manifest.json');
    const activeManifest = resolve(
      this.#stateDirectory,
      'active-manifest.json',
    );
    const bytes = Buffer.from(`${JSON.stringify(plan.manifest)}\n`);
    await atomicWrite(releaseManifest, bytes);
    await atomicWrite(activeManifest, bytes);
    return {
      manifestPath: activeManifest,
      uploaded: plan.additions.length + plan.changes.length,
      deleted: plan.deletions.length,
    };
  }

  public async rollback(release: ReleaseRecord) {
    const stateDirectory = this.#releaseStateDirectory(release.id);
    const state = JSON.parse(
      await readFile(resolve(stateDirectory, 'rollback.json'), 'utf8'),
    ) as RollbackState;
    if (state.version !== 1 || state.plan.releaseId !== release.id)
      throw new Error('Rollback state does not match the requested release');
    const rollbackRoot = resolve(stateDirectory, 'files');
    const backedUp = new Set(state.backedUpPaths);
    const affected = [
      ...new Set(
        [
          ...state.plan.additions,
          ...state.plan.changes,
          ...state.plan.deletions,
        ].map((entry) => entry.path),
      ),
    ];
    let restoredFiles = 0;
    for (const path of affected) {
      const destination = await safeDestination(this.#targetDirectory, path);
      if (backedUp.has(path)) {
        const backup = await safeExistingSource(rollbackRoot, path);
        await atomicWrite(destination, await readFile(backup));
        restoredFiles++;
      } else if (!isProtected(path, state.plan.protectedPrefixes)) {
        await rm(destination, { force: true });
      }
    }
    const activeManifest = resolve(
      this.#stateDirectory,
      'active-manifest.json',
    );
    if (state.plan.previousManifest)
      await atomicWrite(
        activeManifest,
        Buffer.from(`${JSON.stringify(state.plan.previousManifest)}\n`),
      );
    else await unlink(activeManifest).catch(() => undefined);
    return { restoredReleaseId: release.id, restoredFiles };
  }

  public async recoverInterrupted(release: ReleaseRecord) {
    const statePath = resolve(
      this.#releaseStateDirectory(release.id),
      'rollback.json',
    );
    if (!(await exists(statePath))) return { outcome: 'not-started' as const };
    return {
      outcome: 'rolled-back' as const,
      rollback: await this.rollback(release),
    };
  }
}
