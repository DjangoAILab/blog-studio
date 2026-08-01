import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const forbiddenImports = [
  'hexo',
  'cos-nodejs-sdk-v5',
  'tencentcloud-sdk-nodejs',
  '@octokit',
  'traefik',
];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory()
      ? sourceFiles(path)
      : extname(path) === '.ts'
        ? [path]
        : [];
  });
}

describe('core dependency boundary', () => {
  it('does not import generator or infrastructure implementations', () => {
    const directory = resolve(import.meta.dirname, '../src');

    for (const path of sourceFiles(directory)) {
      const source = readFileSync(path, 'utf8');
      for (const forbiddenImport of forbiddenImports) {
        expect(source, `${path} imports ${forbiddenImport}`).not.toMatch(
          new RegExp(`from\\s+["']${forbiddenImport}(?:/|["'])`),
        );
      }
    }
  });
});
