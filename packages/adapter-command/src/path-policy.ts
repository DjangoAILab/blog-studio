import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

export class WorkspacePathError extends Error {
  public constructor(path: string) {
    super(`Path escapes the workspace root: ${path}`);
    this.name = 'WorkspacePathError';
  }
}

export function isPathInside(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return (
    relativePath === '' ||
    (!relativePath.startsWith(
      `..${process.platform === 'win32' ? '\\' : '/'}`,
    ) &&
      relativePath !== '..' &&
      !isAbsolute(relativePath))
  );
}

/** Resolve existing paths and reject both lexical and symlink-based escapes. */
export async function resolveWorkspacePath(
  workspaceRoot: string,
  candidate: string,
): Promise<string> {
  const root = await realpath(workspaceRoot);
  const lexicalCandidate = resolve(root, candidate);

  if (!isPathInside(root, lexicalCandidate)) {
    throw new WorkspacePathError(candidate);
  }

  const resolvedCandidate = await realpath(lexicalCandidate);
  if (!isPathInside(root, resolvedCandidate)) {
    throw new WorkspacePathError(candidate);
  }

  return resolvedCandidate;
}
