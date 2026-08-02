import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  createContentHash,
  isTerminalReleaseStatus,
  transitionRelease,
  type CacheInvalidation,
  type CacheProvider,
  type ContentHash,
  type GeneratorAdapter,
  type ManifestEntry,
  type PublishEvent,
  type PublishResult,
  type Publisher,
  type ReleaseManifest,
  type ReleaseRecord,
  type ReleaseStatus,
} from '@blog-studio/core';

import {
  createReleaseManifest,
  hashReleaseManifest,
  manifestsHaveSameContent,
  RELEASE_MARKER_PATH,
} from './manifest.js';
import type { ReleaseVerifier } from './verification.js';

type MarkerWriter = (input: {
  readonly outputDirectory: string;
  readonly releaseId: ReleaseRecord['id'];
  readonly verificationToken: string;
  readonly manifestHash: ContentHash;
}) => Promise<ManifestEntry>;

export interface ReleaseOrchestratorOptions {
  readonly generator: GeneratorAdapter;
  readonly publisher: Publisher;
  readonly cache?: CacheProvider;
  readonly verifier: ReleaseVerifier;
  readonly baseUrl: string;
  readonly protectedPrefixes?: readonly string[];
  readonly now?: () => Date;
  readonly createVerificationToken?: () => string;
  readonly writeMarker?: MarkerWriter;
  readonly prepare?: () => Promise<void>;
  readonly onUpdate?: (release: ReleaseRecord) => Promise<void>;
  readonly onEvent?: (event: PublishEvent) => void;
}

export interface RunReleaseInput {
  readonly release: ReleaseRecord;
  readonly workspaceRoot: string;
  readonly previousManifest?: ReleaseManifest;
  readonly signal?: AbortSignal;
}

export interface ReleaseRunResult {
  readonly release: ReleaseRecord;
  readonly events: readonly PublishEvent[];
  readonly noOp: boolean;
  readonly manifest?: ReleaseManifest;
  readonly publishResult?: PublishResult;
  readonly error?: string;
}

function cacheInvalidation(
  plan: {
    readonly additions: readonly ManifestEntry[];
    readonly changes: readonly ManifestEntry[];
    readonly deletions: readonly ManifestEntry[];
  },
  baseUrl: string,
): CacheInvalidation {
  const affected = [
    ...plan.additions,
    ...plan.changes,
    ...plan.deletions,
  ].filter((entry) => entry.cacheClass !== 'immutable');
  const urls = affected.map((entry) => new URL(entry.path, baseUrl).toString());
  const directories = [
    ...new Set(
      affected
        .filter((entry) => entry.path.endsWith('.html'))
        .map((entry) => new URL('.', new URL(entry.path, baseUrl)).toString()),
    ),
  ];
  return { urls, directories };
}

async function defaultWriteMarker(input: {
  readonly outputDirectory: string;
  readonly releaseId: ReleaseRecord['id'];
  readonly verificationToken: string;
  readonly manifestHash: ContentHash;
}): Promise<ManifestEntry> {
  const bytes = Buffer.from(
    `${JSON.stringify({
      version: 1,
      releaseId: input.releaseId,
      verificationToken: input.verificationToken,
      manifestHash: input.manifestHash,
    })}\n`,
  );
  await writeFile(join(input.outputDirectory, RELEASE_MARKER_PATH), bytes, {
    flag: 'w',
  });
  return {
    path: RELEASE_MARKER_PATH,
    contentHash: createContentHash(
      `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    ),
    byteLength: bytes.byteLength,
    mediaType: 'application/json',
    cacheClass: 'metadata',
  };
}

export class ReleaseOrchestrator {
  readonly #now: () => Date;
  readonly #token: () => string;
  readonly #writeMarker: MarkerWriter;

  public constructor(private readonly options: ReleaseOrchestratorOptions) {
    this.#now = options.now ?? (() => new Date());
    this.#token = options.createVerificationToken ?? randomUUID;
    this.#writeMarker = options.writeMarker ?? defaultWriteMarker;
  }

  async #transition(
    release: ReleaseRecord,
    status: ReleaseStatus,
  ): Promise<ReleaseRecord> {
    const at = this.#now().toISOString();
    const transitioned = transitionRelease(release, status, at);
    const stages = release.stages.map((stage) =>
      stage.name === release.status && stage.status === 'running'
        ? {
            ...stage,
            status:
              status === 'failed' || status === 'rollback-required'
                ? ('failed' as const)
                : status === 'canceled'
                  ? ('skipped' as const)
                  : ('succeeded' as const),
            completedAt: at,
          }
        : stage,
    );
    const next: ReleaseRecord = {
      ...transitioned,
      stages:
        status === 'queued' || isTerminalReleaseStatus(status)
          ? stages
          : [
              ...stages,
              {
                name: status,
                status: 'running',
                startedAt: at,
              },
            ],
    };
    await this.options.onUpdate?.(next);
    return next;
  }

  public async run(input: RunReleaseInput): Promise<ReleaseRunResult> {
    let current = input.release;
    let mutated = false;
    const events: PublishEvent[] = [];
    let manifest: ReleaseManifest | undefined;
    let publishResult: PublishResult | undefined;
    const emit = (
      stage: string,
      message: string,
      level: PublishEvent['level'] = 'info',
    ) => {
      const event = {
        at: this.#now().toISOString(),
        stage,
        level,
        message,
      } satisfies PublishEvent;
      events.push(event);
      this.options.onEvent?.(event);
    };
    const eventSink = (event: PublishEvent) => {
      events.push(event);
      this.options.onEvent?.(event);
    };
    const aborted = () => {
      if (input.signal?.aborted) throw new Error('Release canceled');
    };

    try {
      current = await this.#transition(current, 'preflight');
      aborted();
      const detection = await this.options.generator.detect(
        input.workspaceRoot,
      );
      if (
        !detection.detected ||
        detection.diagnostics.some((item) => item.severity === 'error')
      )
        throw new Error('Generator preflight failed');
      emit('preflight', 'Generator compatibility preflight passed');

      current = await this.#transition(current, 'building');
      if (this.options.prepare) {
        await this.options.prepare();
        emit('building', 'Workspace content prepared for release');
      }
      const build = await this.options.generator.build({
        workspaceRoot: input.workspaceRoot,
        mode: 'production',
      });
      aborted();
      const baseEntries = build.manifest.filter(
        (entry) => entry.path !== RELEASE_MARKER_PATH,
      );
      if (
        input.previousManifest &&
        manifestsHaveSameContent(baseEntries, input.previousManifest)
      ) {
        current = await this.#transition(current, 'planning');
        current = await this.#transition(current, 'succeeded');
        emit('planning', 'Generated content is unchanged; release is a no-op');
        return { release: current, events, noOp: true };
      }

      const verificationToken = this.#token();
      const baseManifest = createReleaseManifest({
        version: 1,
        releaseId: current.id,
        targetId: current.targetId,
        createdAt: this.#now().toISOString(),
        verificationToken,
        entries: baseEntries,
      });
      const baseHash = hashReleaseManifest(baseManifest);
      const marker = await this.#writeMarker({
        outputDirectory: build.outputDirectory,
        releaseId: current.id,
        verificationToken,
        manifestHash: baseHash,
      });
      manifest = createReleaseManifest({
        ...baseManifest,
        entries: [...baseEntries, marker],
      });
      const manifestHash = hashReleaseManifest(manifest);
      current = { ...current, manifestHash };

      current = await this.#transition(current, 'planning');
      const plan = await this.options.publisher.plan({
        release: current,
        outputDirectory: build.outputDirectory,
        manifest,
        ...(input.previousManifest
          ? { previousManifest: input.previousManifest }
          : {}),
      });
      aborted();

      current = await this.#transition(current, 'uploading-assets');
      mutated = true;
      await this.options.publisher.apply(plan, 'assets', eventSink);
      aborted();
      current = await this.#transition(current, 'uploading-pages');
      await this.options.publisher.apply(plan, 'pages', eventSink);
      publishResult = await this.options.publisher.finalize(plan);
      aborted();

      current = await this.#transition(current, 'invalidating-cache');
      const invalidation = cacheInvalidation(plan, this.options.baseUrl);
      if (
        this.options.cache &&
        (invalidation.urls.length || invalidation.directories.length)
      )
        await this.options.cache.invalidate(invalidation);

      current = await this.#transition(current, 'verifying');
      const verified = await this.options.verifier.verify({
        baseUrl: this.options.baseUrl,
        markerPath: RELEASE_MARKER_PATH,
        expectedReleaseId: current.id,
        expectedVerificationToken: verificationToken,
        expectedManifestHash: baseHash,
      });
      if (!verified)
        throw new Error('Public release marker verification failed');
      current = await this.#transition(current, 'succeeded');
      emit('verifying', 'Public release marker matched the expected release');
      return { release: current, events, noOp: false, manifest, publishResult };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown release failure';
      emit(current.status, message, 'error');
      if (mutated) {
        current = await this.#transition(current, 'rollback-required');
        current = await this.#transition(current, 'rolling-back');
        try {
          await this.options.publisher.rollback(current);
          current = await this.#transition(current, 'rolled-back');
        } catch (rollbackError) {
          emit(
            'rolling-back',
            rollbackError instanceof Error
              ? rollbackError.message
              : 'Unknown rollback failure',
            'error',
          );
          current = await this.#transition(current, 'failed');
        }
      } else {
        const target = message === 'Release canceled' ? 'canceled' : 'failed';
        current = await this.#transition(current, target);
      }
      return {
        release: current,
        events,
        noOp: false,
        ...(manifest ? { manifest } : {}),
        ...(publishResult ? { publishResult } : {}),
        error: message,
      };
    }
  }
}
