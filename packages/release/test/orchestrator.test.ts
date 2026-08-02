import {
  ADAPTER_API_VERSION,
  createContentHash,
  createReleaseId,
  createWorkspaceId,
  type BuildResult,
  type BaselineAdoptionResult,
  type CacheInvalidation,
  type CacheProvider,
  type CacheResult,
  type DetectionResult,
  type DocumentSource,
  type DocumentSummary,
  type GeneratorAdapter,
  type PublishEventSink,
  type PublishInput,
  type PublishPlan,
  type Publisher,
  type ReleaseManifest,
  type ReleaseRecord,
  type SiteModel,
  type WriteDocumentResult,
} from '@blog-studio/core';
import { describe, expect, it } from 'vitest';

import {
  ReleaseOrchestrator,
  createReleaseManifest,
  hashReleaseManifest,
  type ReleaseVerifier,
  type VerifyReleaseInput,
} from '../src/index.js';

const outputDirectory = '/tmp/release-build';

class FakeGenerator implements GeneratorAdapter {
  public readonly apiVersion = ADAPTER_API_VERSION;
  public readonly id = 'fake-generator';
  public readonly displayName = 'Fake generator';
  public readonly capabilities = { preview: true, drafts: true, mdx: false };
  public buildError?: Error;
  public buildCalls = 0;

  public detect(): Promise<DetectionResult> {
    return Promise.resolve({ detected: true, confidence: 1, diagnostics: [] });
  }
  public inspect(): Promise<SiteModel> {
    return Promise.resolve({
      collections: [],
      outputDirectory,
      diagnostics: [],
    });
  }
  public listDocuments(): Promise<readonly DocumentSummary[]> {
    return Promise.resolve([]);
  }
  public readDocument(): Promise<DocumentSource> {
    return Promise.reject(new Error('unused'));
  }
  public writeDocument(): Promise<WriteDocumentResult> {
    return Promise.reject(new Error('unused'));
  }
  public resolvePublicUrl(): Promise<string> {
    return Promise.resolve('https://blog.example/');
  }
  public build(): Promise<BuildResult> {
    this.buildCalls++;
    if (this.buildError) return Promise.reject(this.buildError);
    return Promise.resolve({
      outputDirectory,
      durationMs: 10,
      diagnostics: [],
      manifest: [
        {
          path: 'assets/app.webp',
          contentHash: createContentHash(`sha256:${'a'.repeat(64)}`),
          byteLength: 10,
          mediaType: 'image/webp',
          cacheClass: 'immutable',
        },
        {
          path: 'index.html',
          contentHash: createContentHash(`sha256:${'b'.repeat(64)}`),
          byteLength: 20,
          mediaType: 'text/html',
          cacheClass: 'page',
        },
        {
          path: 'atom.xml',
          contentHash: createContentHash(`sha256:${'d'.repeat(64)}`),
          byteLength: 30,
          mediaType: 'application/atom+xml',
          cacheClass: 'metadata',
        },
        {
          path: 'sitemap.xml',
          contentHash: createContentHash(`sha256:${'e'.repeat(64)}`),
          byteLength: 40,
          mediaType: 'application/xml',
          cacheClass: 'metadata',
        },
      ],
    });
  }
}

class FakePublisher implements Publisher {
  public readonly apiVersion = ADAPTER_API_VERSION;
  public readonly id = 'fake-publisher';
  public readonly displayName = 'Fake publisher';
  public readonly calls: string[] = [];
  public failPhase?: 'assets' | 'pages';
  public onApply?: (phase: 'assets' | 'pages') => void;
  public planResult?: PublishPlan;
  public adoptResult?: BaselineAdoptionResult;

  public plan(input: PublishInput): Promise<PublishPlan> {
    this.calls.push('plan');
    return Promise.resolve(
      this.planResult ?? {
        releaseId: input.release.id,
        targetId: input.release.targetId,
        sourceDirectory: input.outputDirectory,
        manifest: input.manifest,
        ...(input.previousManifest
          ? { previousManifest: input.previousManifest }
          : {}),
        additions: input.manifest.entries,
        changes: [],
        deletions: [],
        protectedPrefixes: [],
      },
    );
  }
  public apply(
    plan: PublishPlan,
    phase: 'assets' | 'pages',
    events: PublishEventSink,
  ) {
    void plan;
    void events;
    this.calls.push(phase);
    if (this.failPhase === phase)
      return Promise.reject(new Error(`${phase} failed`));
    this.onApply?.(phase);
    return Promise.resolve({ uploaded: 1, deleted: 0 });
  }
  public finalize() {
    this.calls.push('finalize');
    return Promise.resolve({
      manifestPath: 'manifest.json',
      uploaded: 2,
      deleted: 0,
    });
  }
  public rollback(release: ReleaseRecord) {
    this.calls.push('rollback');
    return Promise.resolve({ restoredReleaseId: release.id, restoredFiles: 1 });
  }
  public adoptBaseline() {
    this.calls.push('adopt-baseline');
    return this.adoptResult
      ? Promise.resolve(this.adoptResult)
      : Promise.reject(new Error('adoption unsupported'));
  }
}

class FakeCache implements CacheProvider {
  public readonly apiVersion = ADAPTER_API_VERSION;
  public readonly id = 'fake-cache';
  public readonly displayName = 'Fake cache';
  public inputs: CacheInvalidation[] = [];
  public invalidate(input: CacheInvalidation): Promise<CacheResult> {
    this.inputs.push(input);
    return Promise.resolve({
      requestIds: ['request-1'],
      accepted: input.urls.length,
    });
  }
}

class FakeVerifier implements ReleaseVerifier {
  public valid = true;
  public calls = 0;
  public input?: VerifyReleaseInput;
  public verify(input: VerifyReleaseInput): Promise<boolean> {
    this.calls++;
    this.input = input;
    return Promise.resolve(this.valid);
  }
}

function release(): ReleaseRecord {
  return {
    id: createReleaseId('release-one'),
    workspaceId: createWorkspaceId('personal-blog'),
    targetId: 'production',
    status: 'queued',
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    stages: [],
  };
}

describe('ReleaseOrchestrator', () => {
  it('publishes assets before pages, invalidates cache, and verifies the marker', async () => {
    const publisher = new FakePublisher();
    const cache = new FakeCache();
    const verifier = new FakeVerifier();
    const updates: ReleaseRecord[] = [];
    const result = await new ReleaseOrchestrator({
      generator: new FakeGenerator(),
      publisher,
      cache,
      verifier,
      baseUrl: 'https://blog.example/',
      now: () => new Date('2026-08-02T00:00:00.000Z'),
      createVerificationToken: () => 'verification-token',
      writeMarker: () =>
        Promise.resolve({
          path: 'blog-studio-release.json',
          contentHash: createContentHash(`sha256:${'c'.repeat(64)}`),
          byteLength: 80,
          mediaType: 'application/json',
          cacheClass: 'metadata',
        }),
      onUpdate: (value) => {
        updates.push(value);
        return Promise.resolve();
      },
    }).run({ release: release(), workspaceRoot: '/workspace' });

    expect(result.release.status).toBe('succeeded');
    expect(publisher.calls).toEqual(['plan', 'assets', 'pages', 'finalize']);
    expect(cache.inputs).toHaveLength(1);
    expect(cache.inputs[0]?.urls).toEqual(
      expect.arrayContaining([
        'https://blog.example/index.html',
        'https://blog.example/atom.xml',
        'https://blog.example/sitemap.xml',
      ]),
    );
    expect(verifier.calls).toBe(1);
    expect(verifier.input).toMatchObject({
      markerPath: 'blog-studio-release.json',
      expectedReleaseId: 'release-one',
      expectedVerificationToken: 'verification-token',
    });
    expect(updates.at(-1)?.status).toBe('succeeded');
    expect(
      result.release.stages.map((stage) => [stage.name, stage.status]),
    ).toEqual([
      ['preflight', 'succeeded'],
      ['building', 'succeeded'],
      ['planning', 'succeeded'],
      ['uploading-assets', 'succeeded'],
      ['uploading-pages', 'succeeded'],
      ['invalidating-cache', 'succeeded'],
      ['verifying', 'succeeded'],
    ]);
  });

  it('leaves production untouched when the build fails', async () => {
    const generator = new FakeGenerator();
    generator.buildError = new Error('build failed');
    const publisher = new FakePublisher();
    const result = await new ReleaseOrchestrator({
      generator,
      publisher,
      verifier: new FakeVerifier(),
      baseUrl: 'https://blog.example/',
    }).run({ release: release(), workspaceRoot: '/workspace' });
    expect(result.release.status).toBe('failed');
    expect(publisher.calls).toEqual([]);
  });

  it('adopts a remote baseline without rebuilding or overwriting site files', async () => {
    const generator = new FakeGenerator();
    const publisher = new FakePublisher();
    const cache = new FakeCache();
    const verifier = new FakeVerifier();
    const baseline = createReleaseManifest({
      version: 1,
      releaseId: release().id,
      targetId: 'production',
      createdAt: '2026-08-02T00:00:00.000Z',
      verificationToken: 'verification-token',
      entries: [
        {
          path: 'index.html',
          contentHash: createContentHash(`sha256:${'a'.repeat(64)}`),
          byteLength: 20,
          mediaType: 'text/html; charset=utf-8',
          cacheClass: 'page',
        },
      ],
    });
    const marker = {
      path: 'blog-studio-release.json',
      contentHash: createContentHash(`sha256:${'b'.repeat(64)}`),
      byteLength: 80,
      mediaType: 'application/json; charset=utf-8',
      cacheClass: 'metadata' as const,
    };
    const manifest = createReleaseManifest({
      ...baseline,
      entries: [...baseline.entries, marker],
    });
    const plan: PublishPlan = {
      releaseId: release().id,
      targetId: 'production',
      sourceDirectory: '.',
      manifest,
      previousManifest: baseline,
      additions: [marker],
      changes: [],
      deletions: [],
      protectedPrefixes: ['static'],
    };
    publisher.adoptResult = {
      manifest,
      verificationManifestHash: hashReleaseManifest(baseline),
      plan,
      publishResult: {
        manifestPath: '_blog-studio/active-manifest.json',
        uploaded: 1,
        deleted: 0,
      },
    } satisfies BaselineAdoptionResult;

    const result = await new ReleaseOrchestrator({
      generator,
      publisher,
      cache,
      verifier,
      baseUrl: 'https://blog.example/',
      createVerificationToken: () => 'verification-token',
    }).run({
      release: release(),
      workspaceRoot: '/workspace',
      adoptBaseline: true,
    });

    expect(result.release.status).toBe('succeeded');
    expect(generator.buildCalls).toBe(0);
    expect(publisher.calls).toEqual(['adopt-baseline']);
    expect(cache.inputs[0]).toEqual({
      urls: ['https://blog.example/blog-studio-release.json'],
      directories: [],
    });
    expect(verifier.input?.expectedManifestHash).toBe(
      hashReleaseManifest(baseline),
    );
  });

  it('leaves the publisher untouched when workspace preparation fails', async () => {
    const publisher = new FakePublisher();
    const result = await new ReleaseOrchestrator({
      generator: new FakeGenerator(),
      publisher,
      verifier: new FakeVerifier(),
      baseUrl: 'https://blog.example/',
      prepare: () => Promise.reject(new Error('draft revision conflict')),
    }).run({ release: release(), workspaceRoot: '/workspace' });
    expect(result.release.status).toBe('failed');
    expect(result.error).toBe('draft revision conflict');
    expect(publisher.calls).toEqual([]);
  });

  it('rolls back after a partial provider failure', async () => {
    const publisher = new FakePublisher();
    publisher.failPhase = 'pages';
    const result = await new ReleaseOrchestrator({
      generator: new FakeGenerator(),
      publisher,
      verifier: new FakeVerifier(),
      baseUrl: 'https://blog.example/',
      writeMarker: () =>
        Promise.resolve({
          path: 'blog-studio-release.json',
          contentHash: createContentHash(`sha256:${'c'.repeat(64)}`),
          byteLength: 80,
          mediaType: 'application/json',
          cacheClass: 'metadata',
        }),
    }).run({ release: release(), workspaceRoot: '/workspace' });
    expect(result.release.status).toBe('rolled-back');
    expect(publisher.calls).toEqual(['plan', 'assets', 'pages', 'rollback']);
  });

  it('rolls back deterministically when cancellation arrives after mutation', async () => {
    const publisher = new FakePublisher();
    const controller = new AbortController();
    publisher.onApply = (phase) => {
      if (phase === 'assets') controller.abort();
    };
    const result = await new ReleaseOrchestrator({
      generator: new FakeGenerator(),
      publisher,
      verifier: new FakeVerifier(),
      baseUrl: 'https://blog.example/',
      writeMarker: () =>
        Promise.resolve({
          path: 'blog-studio-release.json',
          contentHash: createContentHash(`sha256:${'c'.repeat(64)}`),
          byteLength: 80,
          mediaType: 'application/json',
          cacheClass: 'metadata',
        }),
    }).run({
      release: release(),
      workspaceRoot: '/workspace',
      signal: controller.signal,
    });
    expect(result.release.status).toBe('rolled-back');
    expect(publisher.calls).toEqual(['plan', 'assets', 'rollback']);
  });

  it('performs no provider or cache operation for identical generated content', async () => {
    const publisher = new FakePublisher();
    const cache = new FakeCache();
    const verifier = new FakeVerifier();
    const previous: ReleaseManifest = createReleaseManifest({
      version: 1,
      releaseId: createReleaseId('release-before'),
      targetId: 'production',
      createdAt: '2026-08-01T00:00:00.000Z',
      verificationToken: 'old-token',
      entries: (await new FakeGenerator().build()).manifest,
    });
    const result = await new ReleaseOrchestrator({
      generator: new FakeGenerator(),
      publisher,
      cache,
      verifier,
      baseUrl: 'https://blog.example/',
    }).run({
      release: release(),
      workspaceRoot: '/workspace',
      previousManifest: previous,
    });
    expect(result.release.status).toBe('succeeded');
    expect(result.noOp).toBe(true);
    expect(publisher.calls).toEqual([]);
    expect(cache.inputs).toEqual([]);
    expect(verifier.calls).toBe(0);
  });
});
