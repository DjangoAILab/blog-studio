import { describe, expect, it } from 'vitest';

import {
  ADAPTER_API_VERSION,
  BlogStudioError,
  createAssetId,
  createContentHash,
  createDocumentId,
  createReleaseId,
  createSiteId,
  createWorkspaceId,
  InvalidReleaseTransitionError,
  isTerminalReleaseStatus,
  transitionRelease,
  type ReleaseRecord,
} from '../src/index.js';

describe('core identifiers', () => {
  it('creates portable stable identifiers', () => {
    expect(createWorkspaceId('personal-blog')).toBe('personal-blog');
    expect(createDocumentId('20260802-blog-studio')).toBe(
      '20260802-blog-studio',
    );
    expect(createAssetId('asset-01j9y2p7k6')).toBe('asset-01j9y2p7k6');
    expect(createReleaseId('release-01j9y2p7k6')).toBe('release-01j9y2p7k6');
    expect(createSiteId('site-personal-blog')).toBe('site-personal-blog');
  });

  it.each(['Uppercase', 'has spaces', '../escape', '', 'a'.repeat(129)])(
    'rejects unsafe identifier %j',
    (value) => {
      expect(() => createWorkspaceId(value)).toThrow(BlogStudioError);
    },
  );

  it('accepts only explicit sha256 content hashes', () => {
    const hash = `sha256:${'a'.repeat(64)}`;

    expect(createContentHash(hash)).toBe(hash);
    expect(() => createContentHash('a'.repeat(64))).toThrow(/sha256/);
  });
});

describe('release state machine', () => {
  const queuedRelease: ReleaseRecord = {
    id: createReleaseId('release-01j9y2p7k6'),
    workspaceId: createWorkspaceId('personal-blog'),
    targetId: 'production',
    status: 'queued',
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    stages: [],
  };

  it('moves through an allowed transition without mutating the input', () => {
    const result = transitionRelease(
      queuedRelease,
      'preflight',
      '2026-08-02T00:00:01.000Z',
    );

    expect(result.status).toBe('preflight');
    expect(result.updatedAt).toBe('2026-08-02T00:00:01.000Z');
    expect(queuedRelease.status).toBe('queued');
  });

  it('rejects a transition that skips release safety stages', () => {
    expect(() =>
      transitionRelease(queuedRelease, 'succeeded', '2026-08-02T00:00:01.000Z'),
    ).toThrow(InvalidReleaseTransitionError);
  });

  it.each(['succeeded', 'failed', 'rolled-back'] as const)(
    'marks %s as terminal',
    (status) => {
      expect(isTerminalReleaseStatus(status)).toBe(true);
    },
  );

  it('keeps the adapter API explicitly versioned', () => {
    expect(ADAPTER_API_VERSION).toBe(1);
  });
});
