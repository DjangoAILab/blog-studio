import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  openStudioDatabase,
  SqliteAgentSessionRepository,
  SqliteSiteRepository,
} from '../src/index.js';

const temporaryDirectories: string[] = [];

function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'blog-studio-agent-session-'));
  temporaryDirectories.push(directory);
  return join(directory, 'studio.sqlite');
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function createSite(databasePathValue: string) {
  const database = openStudioDatabase(databasePathValue);
  new SqliteSiteRepository(database).create({
    id: 'site-one',
    workspaceId: 'workspace-one',
    displayName: 'Site One',
    configurationPath: '/config/site-one.yaml',
    capabilities: {},
    createdAt: '2026-08-10T00:00:00.000Z',
    updatedAt: '2026-08-10T00:00:00.000Z',
  });
  return database;
}

describe('SQLite Agent Session repository', () => {
  it('persists Site-scoped Pi session metadata without transcript messages', () => {
    const path = databasePath();
    const database = createSite(path);
    const sessions = new SqliteAgentSessionRepository(database);

    const created = sessions.create({
      id: 'agent-session-one',
      siteId: 'site-one',
      piSessionId: 'pi-session-one',
      transcriptKey: 'site-one/pi-session-one.jsonl',
      displayName: 'Homepage cleanup',
      createdAt: '2026-08-10T00:01:00.000Z',
      updatedAt: '2026-08-10T00:01:00.000Z',
    });

    expect(created).toMatchObject({
      siteId: 'site-one',
      state: 'active',
    });
    expect(created).not.toHaveProperty('approvalMode');
    expect(sessions.list('site-one')).toEqual([created]);
    expect(
      database
        .prepare(
          `SELECT name FROM pragma_table_info('agent_sessions') ORDER BY cid`,
        )
        .all(),
    ).toEqual(
      expect.arrayContaining([
        { name: 'document_id' },
        { name: 'collection_id' },
      ]),
    );
    expect(
      database
        .prepare(
          `SELECT name FROM pragma_table_info('agent_sessions') ORDER BY cid`,
        )
        .all(),
    ).not.toEqual(expect.arrayContaining([{ name: 'messages_json' }]));
    database.close();

    const reopened = openStudioDatabase(path);
    expect(new SqliteAgentSessionRepository(reopened).get(created.id)).toEqual(
      created,
    );
    reopened.close();
  });

  it('renames, archives, restores, and filters Sessions within one Site', () => {
    const database = createSite(databasePath());
    const sessions = new SqliteAgentSessionRepository(database);
    sessions.create({
      id: 'agent-session-one',
      siteId: 'site-one',
      piSessionId: 'pi-session-one',
      transcriptKey: 'site-one/pi-session-one.jsonl',
      displayName: 'First name',
      createdAt: '2026-08-10T00:01:00.000Z',
      updatedAt: '2026-08-10T00:01:00.000Z',
    });

    expect(
      sessions.rename(
        'agent-session-one',
        'Renamed',
        '2026-08-10T00:02:00.000Z',
      ).displayName,
    ).toBe('Renamed');
    expect(
      sessions.archive('agent-session-one', '2026-08-10T00:03:00.000Z'),
    ).toMatchObject({
      state: 'archived',
      archivedAt: '2026-08-10T00:03:00.000Z',
    });
    expect(sessions.list('site-one')).toEqual([]);
    expect(sessions.list('site-one', { includeArchived: true })).toHaveLength(
      1,
    );
    const restored = sessions.restore(
      'agent-session-one',
      '2026-08-10T00:04:00.000Z',
    );
    expect(restored).toMatchObject({ state: 'active' });
    expect(restored).not.toHaveProperty('archivedAt');
    database.close();
  });
});
