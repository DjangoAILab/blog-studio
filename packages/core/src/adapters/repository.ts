import type { ContentHash, WorkspaceId } from '../domain/identifiers.js';
import type { AdapterDescriptor } from './common.js';

export interface RepositoryStatus {
  readonly branch: string;
  readonly head: ContentHash;
  readonly dirtyPaths: readonly string[];
  readonly ahead: number;
  readonly behind: number;
}

export interface RepositoryCheckpoint {
  readonly head: ContentHash;
  readonly message: string;
  readonly createdAt: string;
}

export interface RepositoryAdapter extends AdapterDescriptor {
  status(
    workspaceId: WorkspaceId,
    workspaceRoot: string,
  ): Promise<RepositoryStatus>;
  checkpoint(
    workspaceId: WorkspaceId,
    workspaceRoot: string,
    message: string,
    paths: readonly string[],
  ): Promise<RepositoryCheckpoint>;
  push(workspaceId: WorkspaceId, workspaceRoot: string): Promise<void>;
}
