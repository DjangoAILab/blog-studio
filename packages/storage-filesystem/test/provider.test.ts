import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { assertAssetProviderConformance } from '@blog-studio/adapter-testkit';
import {
  createContentHash,
  createDocumentId,
  createWorkspaceId,
} from '@blog-studio/core';
import { afterEach, describe, expect, it } from 'vitest';

import { FilesystemAssetProvider } from '../src/index.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'blog-studio-assets-'));
  roots.push(root);
  return root;
}

function scope(prefix = 'media/posts/post-one') {
  return {
    workspaceId: createWorkspaceId('personal-blog'),
    documentId: createDocumentId('post-one'),
    prefix,
  };
}

function digest(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('filesystem asset provider', () => {
  it('passes the shared provider contract and stores immutable bytes', async () => {
    await assertAssetProviderConformance(async () => {
      const rootDirectory = await fixtureRoot();
      const provider = new FilesystemAssetProvider({
        rootDirectory,
        publicBaseUrl: 'https://assets.example/',
        managedPrefix: 'media/posts',
        protectedPrefixes: ['static'],
      });
      const bytes = new Uint8Array([1, 2, 3]);
      const hash = digest(bytes);
      return {
        provider,
        scope: scope(),
        input: {
          scope: scope(),
          filename: `${hash}-cover.webp`,
          mediaType: 'image/webp',
          bytes,
          contentHash: createContentHash(`sha256:${hash}`),
        },
      };
    });
  });

  it('is idempotent but never overwrites corrupted content', async () => {
    const rootDirectory = await fixtureRoot();
    const provider = new FilesystemAssetProvider({
      rootDirectory,
      publicBaseUrl: 'https://assets.example/',
      managedPrefix: 'media/posts',
    });
    const bytes = new Uint8Array([4, 5, 6]);
    const digestValue = digest(bytes);
    const hash = createContentHash(`sha256:${digestValue}`);
    const input = {
      scope: scope(),
      filename: `${digestValue}-cover.webp`,
      mediaType: 'image/webp',
      bytes,
      contentHash: hash,
    };
    const first = await provider.put(input);
    const second = await provider.put(input);
    expect(second).toMatchObject({ id: first.id, contentHash: hash });

    await writeFile(join(rootDirectory, first.key), new Uint8Array([9]));
    await expect(provider.put(input)).rejects.toThrow(/refusing to overwrite/i);
    expect(await readFile(join(rootDirectory, first.key))).toEqual(
      Buffer.from([9]),
    );
  });

  it('cannot put, list, or delete through a legacy prefix', async () => {
    const rootDirectory = await fixtureRoot();
    const provider = new FilesystemAssetProvider({
      rootDirectory,
      publicBaseUrl: 'https://assets.example/',
      managedPrefix: 'media/posts',
      protectedPrefixes: ['static'],
    });
    const legacyScope = scope('static/assets/post-one');
    await expect(provider.list(legacyScope)).rejects.toThrow(/managed prefix/i);
    await expect(
      provider.put({
        scope: legacyScope,
        filename: `${'c'.repeat(64)}-legacy.webp`,
        mediaType: 'image/webp',
        bytes: new Uint8Array([1]),
        contentHash: createContentHash(`sha256:${'c'.repeat(64)}`),
      }),
    ).rejects.toThrow(/managed prefix/i);
  });
});
