import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';

import {
  createContentHash,
  type ContentHash,
  type ManifestEntry,
} from '@blog-studio/core';

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

export async function createManifest(
  outputDirectory: string,
): Promise<readonly ManifestEntry[]> {
  const files = await walkFiles(outputDirectory);
  return await Promise.all(
    files.map(async (path): Promise<ManifestEntry> => {
      const content = await readFile(path);
      const details = await stat(path);
      const manifestPath = relative(outputDirectory, path).split(sep).join('/');
      const extension = extname(path).toLowerCase();
      return {
        path: manifestPath,
        contentHash: hashContent(content),
        byteLength: details.size,
        mediaType: mediaType(path),
        cacheClass:
          extension === '.html'
            ? 'page'
            : extension === '.xml' || extension === '.json'
              ? 'metadata'
              : 'immutable',
      };
    }),
  );
}
