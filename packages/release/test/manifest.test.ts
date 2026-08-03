import {
  createContentHash,
  createReleaseId,
  type ManifestEntry,
} from '@blog-studio/core';
import { describe, expect, it } from 'vitest';

import {
  createPublishPlan,
  createReleaseManifest,
  hashReleaseManifest,
} from '../src/index.js';

function entry(
  path: string,
  digest: string,
  cacheClass: ManifestEntry['cacheClass'] = 'page',
): ManifestEntry {
  return {
    path,
    contentHash: createContentHash(`sha256:${digest.repeat(64).slice(0, 64)}`),
    byteLength: 10,
    mediaType: path.endsWith('.html') ? 'text/html' : 'image/webp',
    cacheClass,
  };
}

describe('release manifests', () => {
  it('is canonical and rejects duplicate or escaping paths', () => {
    const manifest = createReleaseManifest({
      version: 1,
      releaseId: createReleaseId('release-one'),
      targetId: 'production',
      createdAt: '2026-08-02T00:00:00.000Z',
      verificationToken: 'token-one',
      entries: [entry('z.html', 'a'), entry('assets/a.webp', 'b', 'immutable')],
    });
    expect(manifest.entries.map((item) => item.path)).toEqual([
      'assets/a.webp',
      'z.html',
    ]);
    expect(hashReleaseManifest(manifest)).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(() =>
      createReleaseManifest({ ...manifest, entries: [entry('../x', 'a')] }),
    ).toThrow(/portable/i);
    expect(() =>
      createReleaseManifest({
        ...manifest,
        entries: [entry('x.html', 'a'), entry('x.html', 'b')],
      }),
    ).toThrow(/duplicate/i);
  });

  it('produces a zero-operation plan for an identical manifest', () => {
    const manifest = createReleaseManifest({
      version: 1,
      releaseId: createReleaseId('release-one'),
      targetId: 'production',
      createdAt: '2026-08-02T00:00:00.000Z',
      verificationToken: 'same-token',
      entries: [entry('index.html', 'a')],
    });
    const next = { ...manifest, releaseId: createReleaseId('release-two') };
    const plan = createPublishPlan('/build', next, manifest, ['legacy']);
    expect(plan.additions).toEqual([]);
    expect(plan.changes).toEqual([]);
    expect(plan.deletions).toEqual([]);
  });

  it('orders immutable assets before pages and protects legacy deletions', () => {
    const previous = createReleaseManifest({
      version: 1,
      releaseId: createReleaseId('release-one'),
      targetId: 'production',
      createdAt: '2026-08-02T00:00:00.000Z',
      verificationToken: 'old-token',
      entries: [entry('index.html', 'a'), entry('legacy/old.png', 'b')],
    });
    const current = createReleaseManifest({
      version: 1,
      releaseId: createReleaseId('release-two'),
      targetId: 'production',
      createdAt: '2026-08-02T01:00:00.000Z',
      verificationToken: 'new-token',
      entries: [
        entry('index.html', 'c'),
        entry('assets/new.webp', 'd', 'immutable'),
      ],
    });
    const plan = createPublishPlan('/build', current, previous, ['legacy']);
    expect(plan.additions.map((item) => item.path)).toEqual([
      'assets/new.webp',
    ]);
    expect(plan.changes.map((item) => item.path)).toEqual(['index.html']);
    expect(plan.deletions).toEqual([]);
    expect(plan.manifest.entries.map((item) => item.path)).toEqual([
      'assets/new.webp',
      'index.html',
      'legacy/old.png',
    ]);
  });

  it('retains baseline bytes when generated protected content drifts', () => {
    const previous = createReleaseManifest({
      version: 1,
      releaseId: createReleaseId('release-one'),
      targetId: 'production',
      createdAt: '2026-08-02T00:00:00.000Z',
      verificationToken: 'old-token',
      entries: [
        entry('index.html', 'a'),
        entry('static/legacy.js', 'b', 'immutable'),
      ],
    });
    const current = createReleaseManifest({
      version: 1,
      releaseId: createReleaseId('release-two'),
      targetId: 'production',
      createdAt: '2026-08-02T01:00:00.000Z',
      verificationToken: 'new-token',
      entries: [
        entry('index.html', 'c'),
        entry('static/legacy.js', 'd', 'immutable'),
      ],
    });

    const plan = createPublishPlan('/build', current, previous, ['static']);
    expect(plan.changes.map((item) => item.path)).toEqual(['index.html']);
    expect(
      plan.manifest.entries.find((item) => item.path === 'static/legacy.js')
        ?.contentHash,
    ).toBe(previous.entries[1]?.contentHash);
  });

  it('rejects new protected output without an imported baseline', () => {
    const current = createReleaseManifest({
      version: 1,
      releaseId: createReleaseId('release-one'),
      targetId: 'production',
      createdAt: '2026-08-02T00:00:00.000Z',
      verificationToken: 'new-token',
      entries: [entry('static/unknown.js', 'a', 'immutable')],
    });

    expect(() =>
      createPublishPlan('/build', current, undefined, ['static']),
    ).toThrow(/requires an imported baseline manifest/);
  });

  it('rejects late protected reconciliation after marker generation', () => {
    const previous = createReleaseManifest({
      version: 1,
      releaseId: createReleaseId('release-one'),
      targetId: 'production',
      createdAt: '2026-08-02T00:00:00.000Z',
      verificationToken: 'old-token',
      entries: [entry('static/legacy.js', 'a', 'immutable')],
    });
    const current = createReleaseManifest({
      version: 1,
      releaseId: createReleaseId('release-two'),
      targetId: 'production',
      createdAt: '2026-08-02T01:00:00.000Z',
      verificationToken: 'new-token',
      entries: [
        entry('blog-studio-release.json', 'b', 'metadata'),
        entry('static/legacy.js', 'c', 'immutable'),
      ],
    });

    expect(() =>
      createPublishPlan('/build', current, previous, ['static']),
    ).toThrow(/before the release marker is generated/);
  });
});
