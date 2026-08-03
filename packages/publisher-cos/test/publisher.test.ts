import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createContentHash,
  createReleaseId,
  createWorkspaceId,
  type ManifestEntry,
  type ReleaseRecord,
} from '@blog-studio/core';
import { createReleaseManifest } from '@blog-studio/release';
import { afterEach, describe, expect, it } from 'vitest';

import { TencentCosPublisher, type CosPublisherClient } from '../src/index.js';

class FakeClient implements CosPublisherClient {
  public readonly objects = new Map<string, Uint8Array>();
  public readonly calls: string[] = [];
  public active = 0;
  public maxActive = 0;
  public failKey?: string;

  public async putObject(input: {
    readonly key: string;
    readonly body: Uint8Array;
  }) {
    this.calls.push(`put:${input.key}`);
    this.active++;
    this.maxActive = Math.max(this.maxActive, this.active);
    await Promise.resolve();
    this.active--;
    if (input.key === this.failKey)
      throw Object.assign(new Error('put failed'), { statusCode: 400 });
    this.objects.set(input.key, input.body);
  }
  public getObject(input: { readonly key: string }): Promise<Uint8Array> {
    this.calls.push(`get:${input.key}`);
    const body = this.objects.get(input.key);
    return body
      ? Promise.resolve(body)
      : Promise.reject(
          Object.assign(new Error('missing'), { statusCode: 404 }),
        );
  }
  public listObjects(input: { readonly prefix: string }) {
    this.calls.push(`list:${input.prefix}`);
    return Promise.resolve({
      objects: [...this.objects.entries()]
        .filter(([key]) => key.startsWith(input.prefix))
        .map(([key, body]) => ({ key, size: body.byteLength })),
    });
  }
  public copyObject(input: {
    readonly sourceKey: string;
    readonly destinationKey: string;
  }): Promise<void> {
    this.calls.push(`copy:${input.sourceKey}->${input.destinationKey}`);
    const body = this.objects.get(input.sourceKey);
    if (!body) return Promise.reject(new Error(`missing ${input.sourceKey}`));
    this.objects.set(input.destinationKey, body);
    return Promise.resolve();
  }
  public deleteObject(input: { readonly key: string }): Promise<void> {
    this.calls.push(`delete:${input.key}`);
    this.objects.delete(input.key);
    return Promise.resolve();
  }
}

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

function digest(body: string) {
  return createContentHash(
    `sha256:${createHash('sha256').update(body).digest('hex')}`,
  );
}

function entry(
  path: string,
  body: string,
  cacheClass: ManifestEntry['cacheClass'],
): ManifestEntry {
  return {
    path,
    contentHash: digest(body),
    byteLength: Buffer.byteLength(body),
    mediaType: path.endsWith('.html')
      ? 'text/html'
      : 'application/octet-stream',
    cacheClass,
  };
}

function release(): ReleaseRecord {
  return {
    id: createReleaseId('release-two'),
    workspaceId: createWorkspaceId('personal-blog'),
    targetId: 'production',
    status: 'planning',
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    stages: [],
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'blog-studio-cos-publisher-'));
  roots.push(root);
  await mkdir(join(root, 'assets'));
  await writeFile(join(root, 'assets', 'app.bin'), 'asset');
  await writeFile(join(root, 'index.html'), 'new page');
  const previous = createReleaseManifest({
    version: 1,
    releaseId: createReleaseId('release-one'),
    targetId: 'production',
    createdAt: '2026-08-01T00:00:00.000Z',
    verificationToken: 'old-token',
    entries: [
      entry('index.html', 'old page', 'page'),
      entry('stale.html', 'stale', 'page'),
    ],
  });
  const current = createReleaseManifest({
    version: 1,
    releaseId: createReleaseId('release-two'),
    targetId: 'production',
    createdAt: '2026-08-02T00:00:00.000Z',
    verificationToken: 'new-token',
    entries: [
      entry('assets/app.bin', 'asset', 'immutable'),
      entry('index.html', 'new page', 'page'),
    ],
  });
  return { root, previous, current };
}

describe('TencentCosPublisher', () => {
  it('reports an interrupted release as not started before rollback state exists', async () => {
    const publisher = new TencentCosPublisher({
      client: new FakeClient(),
      bucket: 'example-123456',
      region: 'ap-shanghai',
      targetPrefix: 'site',
      statePrefix: '_blog-studio',
      retryDelay: async () => {},
    });

    await expect(
      publisher.recoverInterrupted({
        ...release(),
        status: 'rolling-back',
      }),
    ).resolves.toEqual({ outcome: 'not-started' });
    await expect(
      publisher.rollback({ ...release(), status: 'rolling-back' }),
    ).rejects.toThrow(/missing/i);
  });

  it('plans from manifests without remote HEAD fan-out and rolls back exactly', async () => {
    const item = await fixture();
    const client = new FakeClient();
    client.objects.set('site/index.html', Buffer.from('old page'));
    client.objects.set('site/stale.html', Buffer.from('stale'));
    const publisher = new TencentCosPublisher({
      client,
      bucket: 'example-123456',
      region: 'ap-shanghai',
      targetPrefix: 'site',
      statePrefix: '_blog-studio',
      concurrency: 2,
      retryDelay: async () => {},
    });
    const plan = await publisher.plan({
      release: release(),
      outputDirectory: item.root,
      manifest: item.current,
      previousManifest: item.previous,
    });
    expect(client.calls).toEqual([]);

    await publisher.apply(plan, 'assets', () => {});
    await publisher.apply(plan, 'pages', () => {});
    await publisher.finalize(plan);
    expect(Buffer.from(client.objects.get('site/index.html')!).toString()).toBe(
      'new page',
    );
    expect(client.objects.has('site/stale.html')).toBe(false);
    expect(client.objects.has('site/assets/app.bin')).toBe(true);
    expect(client.maxActive).toBeLessThanOrEqual(2);

    await expect(
      publisher.recoverInterrupted({
        ...release(),
        status: 'rolling-back',
      }),
    ).resolves.toMatchObject({ outcome: 'rolled-back' });
    expect(Buffer.from(client.objects.get('site/index.html')!).toString()).toBe(
      'old page',
    );
    expect(Buffer.from(client.objects.get('site/stale.html')!).toString()).toBe(
      'stale',
    );
    expect(client.objects.has('site/assets/app.bin')).toBe(false);
  });

  it('awaits all bounded workers before surfacing a provider failure', async () => {
    const item = await fixture();
    const client = new FakeClient();
    client.objects.set('site/index.html', Buffer.from('old page'));
    client.objects.set('site/stale.html', Buffer.from('stale'));
    client.failKey = 'site/index.html';
    const publisher = new TencentCosPublisher({
      client,
      bucket: 'example-123456',
      region: 'ap-shanghai',
      targetPrefix: 'site',
      statePrefix: '_blog-studio',
      concurrency: 2,
      maxAttempts: 1,
      retryDelay: async () => {},
    });
    const plan = await publisher.plan({
      release: release(),
      outputDirectory: item.root,
      manifest: item.current,
      previousManifest: item.previous,
    });
    await publisher.apply(plan, 'assets', () => {});
    await expect(publisher.apply(plan, 'pages', () => {})).rejects.toThrow(
      'put failed',
    );
    expect(client.active).toBe(0);
  });

  it('adopts an existing bucket-root baseline before enabling normal releases', async () => {
    const client = new FakeClient();
    client.objects.set('index.html', Buffer.from('old page'));
    client.objects.set('static/legacy.bin', Buffer.from('legacy'));
    client.objects.set('_blog-studio/unrelated.json', Buffer.from('state'));
    const publisher = new TencentCosPublisher({
      client,
      bucket: 'example-123456',
      region: 'ap-shanghai',
      targetPrefix: '/',
      allowBucketRoot: true,
      statePrefix: '_blog-studio',
      protectedPrefixes: ['static'],
      concurrency: 2,
      retryDelay: async () => {},
      now: () => new Date('2026-08-02T00:00:00.000Z'),
    });

    await expect(
      async () =>
        await publisher.plan({
          release: release(),
          outputDirectory: '.',
          manifest: createReleaseManifest({
            version: 1,
            releaseId: release().id,
            targetId: 'production',
            createdAt: '2026-08-02T00:00:00.000Z',
            verificationToken: 'token',
            entries: [],
          }),
        }),
    ).rejects.toThrow('requires an adopted baseline');

    const adopted = await publisher.adoptBaseline(
      { release: release(), verificationToken: 'adoption-token' },
      () => {},
    );
    expect(adopted.manifest.entries.map((item) => item.path)).toEqual([
      'blog-studio-release.json',
      'index.html',
      'static/legacy.bin',
    ]);
    expect(client.objects.has('blog-studio-release.json')).toBe(true);
    expect(client.objects.has('_blog-studio/active-manifest.json')).toBe(true);
    expect(
      client.calls.some(
        (call) => call === 'put:index.html' || call === 'put:static/legacy.bin',
      ),
    ).toBe(false);
  });

  it('refuses to adopt a deployment that already has a release marker', async () => {
    const client = new FakeClient();
    client.objects.set('index.html', Buffer.from('old page'));
    client.objects.set('blog-studio-release.json', Buffer.from('{}'));
    const publisher = new TencentCosPublisher({
      client,
      bucket: 'example-123456',
      region: 'ap-shanghai',
      targetPrefix: '/',
      allowBucketRoot: true,
      statePrefix: '_blog-studio',
    });
    await expect(
      publisher.adoptBaseline(
        { release: release(), verificationToken: 'adoption-token' },
        () => {},
      ),
    ).rejects.toThrow('requires recovery, not adoption');
    expect(client.calls.some((call) => call.startsWith('put:'))).toBe(false);
  });
});
