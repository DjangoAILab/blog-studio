import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

import {
  createContentHash,
  type ContentHash,
  type ManifestEntry,
} from '@blog-studio/core';
import { manifestEntryForBytes } from '@blog-studio/release';

export async function walkFiles(root: string): Promise<readonly string[]> {
  const result: string[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) result.push(path);
    }
  }

  await visit(root);
  return result;
}

export function hashContent(content: string | Buffer): ContentHash {
  return createContentHash(
    `sha256:${createHash('sha256').update(content).digest('hex')}`,
  );
}

export async function createManifest(
  outputDirectory: string,
): Promise<readonly ManifestEntry[]> {
  const files = await walkFiles(outputDirectory);
  return await Promise.all(
    files.map(async (path): Promise<ManifestEntry> => {
      const content = await readFile(path);
      const manifestPath = relative(outputDirectory, path).split(sep).join('/');
      return manifestEntryForBytes(manifestPath, content);
    }),
  );
}
