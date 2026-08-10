import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  AgentTurnStateConflictError,
  openStudioDatabase,
  SqliteAgentSessionRepository,
  SqliteAgentTurnRepository,
  SqliteSiteRepository,
} from '../src/index.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'blog-studio-agent-turn-'));
  directories.push(directory);
  const path = join(directory, 'studio.sqlite');
  const database = openStudioDatabase(path);
  new SqliteSiteRepository(database).create({
    id: 'site-one',
    workspaceId: 'workspace-one',
    displayName: 'Site One',
    configurationPath: '/config/site-one.yml',
    capabilities: {},
    createdAt: '2026-08-10T00:00:00.000Z',
    updatedAt: '2026-08-10T00:00:00.000Z',
  });
  new SqliteAgentSessionRepository(database).create({
    id: 'session-one',
    siteId: 'site-one',
    piSessionId: 'pi-one',
    transcriptKey: 'site-one/pi-one.jsonl',
    displayName: 'Session One',
    createdAt: '2026-08-10T00:01:00.000Z',
    updatedAt: '2026-08-10T00:01:00.000Z',
  });
  return { database, path };
}

describe('SQLite Agent turn and event repository', () => {
  it('persists transitions and cursor-ordered metadata events across reopen', () => {
    const { database, path } = fixture();
    const turns = new SqliteAgentTurnRepository(database);
    expect(
      turns.create({
        id: 'turn-one',
        siteId: 'site-one',
        sessionId: 'session-one',
        approvalMode: 'approval',
        at: '2026-08-10T00:02:00.000Z',
      }).status,
    ).toBe('queued');
    turns.transition({
      id: 'turn-one',
      status: 'running',
      at: '2026-08-10T00:03:00.000Z',
    });
    const first = turns.appendEvent({
      id: 'event-one',
      siteId: 'site-one',
      sessionId: 'session-one',
      turnId: 'turn-one',
      type: 'turn-running',
      at: '2026-08-10T00:03:00.000Z',
    });
    turns.transition({
      id: 'turn-one',
      status: 'completed',
      at: '2026-08-10T00:04:00.000Z',
    });
    const second = turns.appendEvent({
      id: 'event-two',
      siteId: 'site-one',
      sessionId: 'session-one',
      turnId: 'turn-one',
      type: 'turn-completed',
      payload: { terminal: true },
      at: '2026-08-10T00:04:00.000Z',
    });
    database.close();

    const reopened = openStudioDatabase(path);
    const restored = new SqliteAgentTurnRepository(reopened);
    expect(restored.get('turn-one')).toMatchObject({
      status: 'completed',
      startedAt: '2026-08-10T00:03:00.000Z',
      finishedAt: '2026-08-10T00:04:00.000Z',
    });
    expect(
      restored.events({
        sessionId: 'session-one',
        afterSequence: first.sequence,
      }),
    ).toEqual([second]);
    reopened.close();
  });

  it('prevents two active turns and illegal terminal replay', () => {
    const { database } = fixture();
    const turns = new SqliteAgentTurnRepository(database);
    turns.create({
      id: 'turn-one',
      siteId: 'site-one',
      sessionId: 'session-one',
      approvalMode: 'approval',
      at: '2026-08-10T00:02:00.000Z',
    });
    expect(() =>
      turns.create({
        id: 'turn-two',
        siteId: 'site-one',
        sessionId: 'session-one',
        approvalMode: 'approval',
        at: '2026-08-10T00:03:00.000Z',
      }),
    ).toThrow(/UNIQUE/);
    turns.transition({
      id: 'turn-one',
      status: 'canceled',
      at: '2026-08-10T00:04:00.000Z',
    });
    expect(() =>
      turns.transition({
        id: 'turn-one',
        status: 'running',
        at: '2026-08-10T00:05:00.000Z',
      }),
    ).toThrow(AgentTurnStateConflictError);
    database.close();
  });

  it('marks active work interrupted on cold restart without replay', () => {
    const { database, path } = fixture();
    const turns = new SqliteAgentTurnRepository(database);
    turns.create({
      id: 'turn-one',
      siteId: 'site-one',
      sessionId: 'session-one',
      approvalMode: 'yolo',
      at: '2026-08-10T00:02:00.000Z',
    });
    turns.transition({
      id: 'turn-one',
      status: 'running',
      at: '2026-08-10T00:03:00.000Z',
    });
    database.close();

    const reopened = openStudioDatabase(path);
    const restored = new SqliteAgentTurnRepository(reopened);
    expect(restored.recoverInterrupted('2026-08-10T00:04:00.000Z')).toEqual([
      expect.objectContaining({ id: 'turn-one', status: 'interrupted' }),
    ]);
    expect(restored.active('session-one')).toBeNull();
    reopened.close();
  });
});
