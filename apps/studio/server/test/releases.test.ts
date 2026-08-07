import {
  ADAPTER_API_VERSION,
  createReleaseId,
  createWorkspaceId,
  type Publisher,
  type ReleaseRecord,
} from '@blog-studio/core';
import {
  openStudioDatabase,
  SqliteChangeSetRepository,
  SqliteDraftRepository,
  SqliteReleaseRepository,
} from '@blog-studio/persistence';
import { afterEach, describe, expect, it } from 'vitest';

import { ReleaseService } from '../services/releases.js';
import type {
  WorkspaceHandle,
  WorkspaceService,
} from '../services/workspaces.js';

const databases: ReturnType<typeof openStudioDatabase>[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function interruptedRelease(): ReleaseRecord {
  return {
    id: createReleaseId('release-interrupted'),
    workspaceId: createWorkspaceId('test-blog'),
    targetId: 'staging',
    status: 'uploading-assets',
    createdAt: '2026-08-03T00:00:00.000Z',
    updatedAt: '2026-08-03T00:00:01.000Z',
    stages: [
      {
        name: 'uploading-assets',
        status: 'running',
        startedAt: '2026-08-03T00:00:01.000Z',
      },
    ],
  };
}

function publisher(
  outcome: 'not-started' | 'rolled-back',
): Publisher & Required<Pick<Publisher, 'recoverInterrupted'>> {
  return {
    apiVersion: ADAPTER_API_VERSION,
    id: 'test-publisher',
    displayName: 'Test publisher',
    plan: () => Promise.reject(new Error('not used')),
    apply: () => Promise.reject(new Error('not used')),
    finalize: () => Promise.reject(new Error('not used')),
    rollback: () => Promise.reject(new Error('not used')),
    recoverInterrupted: () =>
      Promise.resolve(
        outcome === 'not-started'
          ? { outcome }
          : {
              outcome,
              rollback: {
                restoredReleaseId: createReleaseId('release-interrupted'),
                restoredFiles: 1,
              },
            },
      ),
  };
}

function serviceWith(recoveryOutcome: 'not-started' | 'rolled-back') {
  const database = openStudioDatabase(':memory:');
  databases.push(database);
  const repository = new SqliteReleaseRepository(database);
  repository.create(interruptedRelease());
  const handle = {
    config: {
      workspace: { id: 'test-blog', root: '/unused' },
      publish: {
        adapter: 'filesystem',
        options: { targetId: 'staging', directory: '/target' },
      },
    },
  } as unknown as WorkspaceHandle;
  const workspaces = {
    get: () => handle,
    list: () => [handle],
  } as unknown as WorkspaceService;
  const releases = new ReleaseService({
    workspaces,
    repository,
    drafts: new SqliteDraftRepository(database),
    sites: {} as never,
    changeSets: new SqliteChangeSetRepository(database),
    stateDirectory: '/unused',
    publisherFactories: {
      filesystem: () => publisher(recoveryOutcome),
    },
    now: () => new Date('2026-08-03T00:00:02.000Z'),
  });
  return { releases, repository };
}

describe('ReleaseService recovery', () => {
  it('fails safely when the provider had not prepared any mutation', async () => {
    const { releases, repository } = serviceWith('not-started');

    await releases.recover();

    expect(
      repository.get(createReleaseId('release-interrupted'))?.release,
    ).toMatchObject({ status: 'failed' });
    expect(
      repository.events(createReleaseId('release-interrupted')).at(-1),
    ).toMatchObject({
      level: 'warning',
      message:
        'Release was safely stopped before provider mutation was prepared',
    });
  });

  it('marks a prepared interrupted release as rolled back', async () => {
    const { releases, repository } = serviceWith('rolled-back');

    await releases.recover();

    expect(
      repository.get(createReleaseId('release-interrupted'))?.release,
    ).toMatchObject({ status: 'rolled-back' });
    expect(
      repository.events(createReleaseId('release-interrupted')).at(-1),
    ).toMatchObject({
      level: 'warning',
      message: 'Interrupted release was rolled back after service restart',
    });
  });
});
