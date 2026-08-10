import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  openStudioDatabase,
  SqliteAgentAttachmentRepository,
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
  const directory = mkdtempSync(join(tmpdir(), 'blog-studio-agent-files-'));
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

describe('SQLite Agent attachment metadata', () => {
  it('stores external attachment identity without storing file bytes', () => {
    const database = fixture();
    const attachments = new SqliteAgentAttachmentRepository(database);
    const created = attachments.create({
      id: 'attachment-one',
      sessionId: 'session-one',
      filename: 'diagram.png',
      mimeType: 'image/png',
      byteSize: 128,
      sha256: 'a'.repeat(64),
      storageKey: 'attachments/attachment-one',
      createdAt: '2026-08-10T00:01:00.000Z',
      updatedAt: '2026-08-10T00:01:00.000Z',
    });

    expect(created).toMatchObject({ status: 'uploaded' });
    expect(attachments.list('session-one')).toEqual([created]);
    expect(
      database
        .prepare(
          `SELECT name FROM pragma_table_info('agent_attachments') ORDER BY cid`,
        )
        .all(),
    ).not.toEqual(expect.arrayContaining([{ name: 'content' }]));
    database.close();
  });

  it('binds to one Pi message and tracks vision processing without duplicating its result', () => {
    const database = fixture();
    const attachments = new SqliteAgentAttachmentRepository(database);
    attachments.create({
      id: 'attachment-one',
      sessionId: 'session-one',
      filename: 'diagram.png',
      mimeType: 'image/png',
      byteSize: 128,
      sha256: 'a'.repeat(64),
      storageKey: 'attachments/attachment-one',
      createdAt: '2026-08-10T00:01:00.000Z',
      updatedAt: '2026-08-10T00:01:00.000Z',
    });

    attachments.bindToMessage(
      'attachment-one',
      'pi-message-one',
      '2026-08-10T00:02:00.000Z',
    );
    attachments.setVisionState({
      id: 'attachment-one',
      status: 'ready',
      visionModel: 'minicpm-v',
      updatedAt: '2026-08-10T00:03:00.000Z',
    });
    expect(attachments.get('attachment-one')).toMatchObject({
      messageEntryId: 'pi-message-one',
      status: 'ready',
      visionModel: 'minicpm-v',
    });
    database.close();
  });
});
