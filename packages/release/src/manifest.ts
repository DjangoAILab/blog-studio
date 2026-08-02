import { createHash } from 'node:crypto';
import { extname } from 'node:path';

import {
  createContentHash,
  type ContentHash,
  type ManifestEntry,
  type PublishPlan,
  type ReleaseManifest,
  type ReleaseId,
} from '@blog-studio/core';

const markerPath = 'blog-studio-release.json';

function mediaType(path: string): string {
  const types: Readonly<Record<string, string>> = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.xml': 'application/xml; charset=utf-8',
  };
  return types[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

export function manifestEntryForBytes(
  path: string,
  bytes: Uint8Array,
): ManifestEntry {
  assertPortablePath(path);
  const extension = extname(path).toLowerCase();
  return {
    path,
    contentHash: createContentHash(
      `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    ),
    byteLength: bytes.byteLength,
    mediaType: mediaType(path),
    cacheClass:
      extension === '.html'
        ? 'page'
        : extension === '.xml' || extension === '.json'
          ? 'metadata'
          : 'immutable',
  };
}

export function createReleaseMarker(input: {
  readonly releaseId: ReleaseId;
  readonly verificationToken: string;
  readonly manifestHash: ContentHash;
}): { readonly bytes: Uint8Array; readonly entry: ManifestEntry } {
  const bytes = Buffer.from(
    `${JSON.stringify({
      version: 1,
      releaseId: input.releaseId,
      verificationToken: input.verificationToken,
      manifestHash: input.manifestHash,
    })}\n`,
  );
  return { bytes, entry: manifestEntryForBytes(markerPath, bytes) };
}

function assertPortablePath(path: string): void {
  if (
    !path ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new Error(`Manifest path must be portable: ${path}`);
}

function canonicalEntries(
  entries: readonly ManifestEntry[],
): readonly ManifestEntry[] {
  const sorted = [...entries].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
  for (const [index, entry] of sorted.entries()) {
    assertPortablePath(entry.path);
    if (sorted[index - 1]?.path === entry.path)
      throw new Error(`Duplicate manifest path: ${entry.path}`);
  }
  return sorted;
}

export function createReleaseManifest(input: ReleaseManifest): ReleaseManifest {
  if (input.version !== 1)
    throw new Error('Unsupported release manifest version');
  if (!input.targetId.trim()) throw new Error('Manifest target ID is required');
  if (!input.verificationToken.trim())
    throw new Error('Manifest verification token is required');
  return { ...input, entries: canonicalEntries(input.entries) };
}

export function hashReleaseManifest(manifest: ReleaseManifest): ContentHash {
  const canonical = createReleaseManifest(manifest);
  return createContentHash(
    `sha256:${createHash('sha256').update(JSON.stringify(canonical)).digest('hex')}`,
  );
}

function sameEntry(left: ManifestEntry, right: ManifestEntry): boolean {
  return (
    left.contentHash === right.contentHash &&
    left.byteLength === right.byteLength &&
    left.mediaType === right.mediaType &&
    left.cacheClass === right.cacheClass
  );
}

function isProtected(path: string, prefixes: readonly string[]): boolean {
  return prefixes.some(
    (prefix) =>
      path === prefix || path.startsWith(`${prefix.replace(/\/$/, '')}/`),
  );
}

export function manifestsHaveSameContent(
  current: readonly ManifestEntry[],
  previous: ReleaseManifest,
): boolean {
  const withoutMarker = (entries: readonly ManifestEntry[]) =>
    canonicalEntries(entries.filter((entry) => entry.path !== markerPath));
  const left = withoutMarker(current);
  const right = withoutMarker(previous.entries);
  return (
    left.length === right.length &&
    left.every(
      (entry, index) =>
        right[index]?.path === entry.path && sameEntry(entry, right[index]),
    )
  );
}

export function createPublishPlan(
  sourceDirectory: string,
  manifest: ReleaseManifest,
  previousManifest: ReleaseManifest | undefined,
  protectedPrefixes: readonly string[],
): PublishPlan {
  const previousByPath = new Map(
    previousManifest?.entries.map((entry) => [entry.path, entry]) ?? [],
  );
  const currentByPath = new Map(
    manifest.entries.map((entry) => [entry.path, entry]),
  );
  const additions: ManifestEntry[] = [];
  const changes: ManifestEntry[] = [];
  for (const entry of manifest.entries) {
    const previous = previousByPath.get(entry.path);
    if (!previous) additions.push(entry);
    else if (!sameEntry(entry, previous)) changes.push(entry);
  }
  const deletions = [...previousByPath.values()].filter(
    (entry) =>
      !currentByPath.has(entry.path) &&
      !isProtected(entry.path, protectedPrefixes),
  );
  const phaseOrder = (entry: ManifestEntry) =>
    entry.cacheClass === 'immutable' ? 0 : entry.cacheClass === 'page' ? 1 : 2;
  const order = (left: ManifestEntry, right: ManifestEntry) =>
    phaseOrder(left) - phaseOrder(right) || left.path.localeCompare(right.path);
  return {
    releaseId: manifest.releaseId,
    targetId: manifest.targetId,
    sourceDirectory,
    manifest,
    ...(previousManifest ? { previousManifest } : {}),
    additions: additions.sort(order),
    changes: changes.sort(order),
    deletions: deletions.sort(order),
    protectedPrefixes,
  };
}

export const RELEASE_MARKER_PATH = markerPath;
