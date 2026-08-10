import { access, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

export class SitePathEscapeError extends Error {
  constructor(path: string) {
    super(`Path is outside the Site workspace: ${path}`);
    this.name = 'SitePathEscapeError';
  }
}

export class SitePathProtectedError extends Error {
  constructor(path: string) {
    super(`Path is protected from direct Agent file access: ${path}`);
    this.name = 'SitePathProtectedError';
  }
}

function isWithin(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot === '' ||
    (!pathFromRoot.startsWith('..') && !isAbsolute(pathFromRoot))
  );
}

async function nearestExistingPath(path: string): Promise<string> {
  let candidate = path;

  while (true) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      const parent = dirname(candidate);
      if (parent === candidate) {
        throw new SitePathEscapeError(path);
      }
      candidate = parent;
    }
  }
}

/**
 * Resolve a model-supplied path and reject lexical and symlink escapes.
 *
 * For a path that does not exist yet, the nearest existing ancestor is checked.
 * This makes the same guard usable before reads, edits, and new-file writes.
 */
export async function assertSitePath(
  siteRoot: string,
  inputPath = '.',
): Promise<string> {
  const canonicalRoot = await realpath(siteRoot);
  const candidate = resolve(canonicalRoot, inputPath);

  if (!isWithin(canonicalRoot, candidate)) {
    throw new SitePathEscapeError(inputPath);
  }

  const existingAncestor = await nearestExistingPath(candidate);
  const canonicalAncestor = await realpath(existingAncestor);
  if (!isWithin(canonicalRoot, canonicalAncestor)) {
    throw new SitePathEscapeError(inputPath);
  }

  const canonicalCandidate = join(
    canonicalAncestor,
    relative(existingAncestor, candidate),
  );
  const pathFromRoot = relative(canonicalRoot, canonicalCandidate);
  const firstSegment = pathFromRoot.split(/[\\/]/, 1)[0];
  if (firstSegment === '.git') throw new SitePathProtectedError(inputPath);

  return canonicalCandidate;
}
