import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
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

import { FilesystemPublisher } from '../src/index.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

function hash(bytes: Uint8Array | string) {
  return createContentHash(
    `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  );
}

function entry(
  path: string,
  body: string,
  cacheClass: ManifestEntry['cacheClass'],
): ManifestEntry {
  return {
    path,
    contentHash: hash(body),
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
  const root = await mkdtemp(join(tmpdir(), 'blog-studio-publisher-'));
  roots.push(root);
  const build = join(root, 'build');
  const target = join(root, 'target');
  const state = join(root, 'state');
  await mkdir(join(build, 'assets'), { recursive: true });
  await mkdir(join(target, 'legacy'), { recursive: true });
  await writeFile(join(build, 'index.html'), 'new page');
  await writeFile(join(build, 'assets', 'app.bin'), 'new asset');
  await writeFile(join(target, 'index.html'), 'old page');
  await writeFile(join(target, 'stale.html'), 'stale page');
  await writeFile(join(target, 'legacy', 'old.bin'), 'legacy');
  const previous = createReleaseManifest({
    version: 1,
    releaseId: createReleaseId('release-one'),
    targetId: 'production',
    createdAt: '2026-08-01T00:00:00.000Z',
    verificationToken: 'old-token',
    entries: [
      entry('index.html', 'old page', 'page'),
      entry('stale.html', 'stale page', 'page'),
      entry('legacy/old.bin', 'legacy', 'immutable'),
    ],
  });
  const current = createReleaseManifest({
    version: 1,
    releaseId: createReleaseId('release-two'),
    targetId: 'production',
    createdAt: '2026-08-02T00:00:00.000Z',
    verificationToken: 'new-token',
    entries: [
      entry('index.html', 'new page', 'page'),
      entry('assets/app.bin', 'new asset', 'immutable'),
    ],
  });
  return { root, build, target, state, previous, current };
}

describe('FilesystemPublisher', () => {
  it('publishes in phases and restores the exact previous release', async () => {
    const item = await fixture();
    const publisher = new FilesystemPublisher({
      targetDirectory: item.target,
      stateDirectory: item.state,
      protectedPrefixes: ['legacy'],
    });
    const plan = await publisher.plan({
      release: release(),
      outputDirectory: item.build,
      manifest: item.current,
      previousManifest: item.previous,
    });
    expect(plan.deletions.map((value) => value.path)).toEqual(['stale.html']);

    await publisher.apply(plan, 'assets', () => {});
    expect(await readFile(join(item.target, 'assets', 'app.bin'), 'utf8')).toBe(
      'new asset',
    );
    expect(await readFile(join(item.target, 'index.html'), 'utf8')).toBe(
      'old page',
    );

    await publisher.apply(plan, 'pages', () => {});
    expect(await readFile(join(item.target, 'index.html'), 'utf8')).toBe(
      'new page',
    );
    await expect(stat(join(item.target, 'stale.html'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await readFile(join(item.target, 'legacy', 'old.bin'), 'utf8')).toBe(
      'legacy',
    );
    const finalized = await publisher.finalize(plan);
    expect(finalized).toMatchObject({ uploaded: 2, deleted: 1 });

    await publisher.rollback({ ...release(), status: 'rolling-back' });
    expect(await readFile(join(item.target, 'index.html'), 'utf8')).toBe(
      'old page',
    );
    expect(await readFile(join(item.target, 'stale.html'), 'utf8')).toBe(
      'stale page',
    );
    await expect(
      stat(join(item.target, 'assets', 'app.bin')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('verifies every source hash before mutating the target', async () => {
    const item = await fixture();
    const publisher = new FilesystemPublisher({
      targetDirectory: item.target,
      stateDirectory: item.state,
    });
    const plan = await publisher.plan({
      release: release(),
      outputDirectory: item.build,
      manifest: item.current,
      previousManifest: item.previous,
    });
    await writeFile(join(item.build, 'assets', 'app.bin'), 'corrupted');
    await expect(publisher.apply(plan, 'assets', () => {})).rejects.toThrow(
      /hash/i,
    );
    expect(await readFile(join(item.target, 'index.html'), 'utf8')).toBe(
      'old page',
    );
  });
});
