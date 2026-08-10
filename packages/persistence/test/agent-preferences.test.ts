import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  openStudioDatabase,
  SqliteAgentPreferenceRepository,
  SqliteAgentSessionRepository,
  SqliteSiteRepository,
} from '../src/index.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'blog-studio-agent-prefs-'));
  temporaryDirectories.push(directory);
  const database = openStudioDatabase(join(directory, 'studio.sqlite'));
  new SqliteSiteRepository(database).create({
    id: 'site-one',
    workspaceId: 'workspace-one',
    displayName: 'Site One',
    configurationPath: '/config/site-one.yaml',
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
    createdAt: '2026-08-10T00:00:00.000Z',
    updatedAt: '2026-08-10T00:00:00.000Z',
  });
  return database;
}

describe('SQLite Agent approval preferences', () => {
  it('resolves Session, Site, global, then safe default precedence', () => {
    const database = fixture();
    const preferences = new SqliteAgentPreferenceRepository(database);

    expect(preferences.resolve('site-one', 'session-one')).toEqual({
      mode: 'approval',
      source: 'default',
    });
    preferences.setGlobal('yolo', '2026-08-10T00:01:00.000Z');
    expect(preferences.resolve('site-one', 'session-one')).toEqual({
      mode: 'yolo',
      source: 'global',
    });
    preferences.setSite('site-one', 'approval', '2026-08-10T00:02:00.000Z');
    expect(preferences.resolve('site-one', 'session-one')).toEqual({
      mode: 'approval',
      source: 'site',
    });
    preferences.setSession(
      'site-one',
      'session-one',
      'yolo',
      '2026-08-10T00:03:00.000Z',
    );
    expect(preferences.resolve('site-one', 'session-one')).toEqual({
      mode: 'yolo',
      source: 'session',
    });
    preferences.clearSession(
      'site-one',
      'session-one',
      '2026-08-10T00:04:00.000Z',
    );
    preferences.clearSite('site-one');
    expect(preferences.resolve('site-one', 'session-one')).toEqual({
      mode: 'yolo',
      source: 'global',
    });
    database.close();
  });

  it('cannot apply a Session override through a different Site', () => {
    const database = fixture();
    const preferences = new SqliteAgentPreferenceRepository(database);
    expect(() =>
      preferences.setSession(
        'wrong-site',
        'session-one',
        'yolo',
        '2026-08-10T00:01:00.000Z',
      ),
    ).toThrow(/does not belong to Site/);
    database.close();
  });
});
