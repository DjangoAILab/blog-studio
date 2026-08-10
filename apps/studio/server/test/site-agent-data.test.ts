import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  openStudioDatabase,
  SqliteAgentAttachmentRepository,
  SqliteAgentSessionRepository,
  SqliteAgentToolAuditRepository,
  SqliteAgentTurnRepository,
  SqliteSiteRepository,
} from '@blog-studio/persistence';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { describe, expect, it } from 'vitest';

import {
  AgentDataIntegrityError,
  createAgentOperationalBackup,
  restoreAgentOperationalBackup,
  verifyAgentOperationalData,
} from '../services/site-agent-data.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'blog-studio-agent-data-'));
  const live = join(root, 'live');
  const sessionDirectory = join(live, 'agent-sessions');
  const attachmentDirectory = join(live, 'agent-attachments');
  await mkdir(sessionDirectory, { recursive: true });
  await mkdir(attachmentDirectory, { recursive: true });
  const database = openStudioDatabase(join(live, 'studio.sqlite'));
  const sites = new SqliteSiteRepository(database);
  sites.create({
    id: 'site-one',
    workspaceId: 'workspace-one',
    displayName: 'Site One',
    configurationPath: '/config/site-one.yml',
    capabilities: {},
    createdAt: '2026-08-10T00:00:00.000Z',
    updatedAt: '2026-08-10T00:00:00.000Z',
  });
  sites.create({
    id: 'site-two',
    workspaceId: 'workspace-two',
    displayName: 'Site Two',
    configurationPath: '/config/site-two.yml',
    capabilities: {},
    createdAt: '2026-08-10T00:00:00.000Z',
    updatedAt: '2026-08-10T00:00:00.000Z',
  });
  const siteSessionDirectory = join(sessionDirectory, 'site-one');
  await mkdir(siteSessionDirectory);
  const pi = SessionManager.create('/workspace/site-one', siteSessionDirectory);
  pi.appendCustomMessageEntry('blog-studio.context', 'Original context', true);
  pi.appendMessage({
    role: 'assistant',
    content: [{ type: 'text', text: 'Acknowledged.' }],
    api: 'openai-completions',
    provider: 'test',
    model: 'test-model',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    stopReason: 'stop',
    timestamp: Date.now(),
  });
  const sessionFile = pi.getSessionFile()!;
  const transcriptKey = join('site-one', sessionFile.split('/').at(-1)!);
  const sessions = new SqliteAgentSessionRepository(database);
  sessions.create({
    id: 'agent-session-one',
    siteId: 'site-one',
    piSessionId: pi.getSessionId(),
    transcriptKey,
    displayName: 'Durable Session',
    createdAt: '2026-08-10T00:01:00.000Z',
    updatedAt: '2026-08-10T00:01:00.000Z',
  });
  const siteTwoSessionDirectory = join(sessionDirectory, 'site-two');
  await mkdir(siteTwoSessionDirectory);
  const archivedPi = SessionManager.create(
    '/workspace/site-two',
    siteTwoSessionDirectory,
  );
  archivedPi.appendCustomMessageEntry(
    'blog-studio.context',
    'Archived context',
    true,
  );
  archivedPi.appendMessage({
    role: 'assistant',
    content: [{ type: 'text', text: 'Archived acknowledgement.' }],
    api: 'openai-completions',
    provider: 'test',
    model: 'test-model',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    stopReason: 'stop',
    timestamp: Date.now(),
  });
  const archivedTranscriptKey = join(
    'site-two',
    archivedPi.getSessionFile()!.split('/').at(-1)!,
  );
  sessions.create({
    id: 'agent-session-archived',
    siteId: 'site-two',
    piSessionId: archivedPi.getSessionId(),
    transcriptKey: archivedTranscriptKey,
    displayName: 'Archived Session',
    createdAt: '2026-08-10T00:01:00.000Z',
    updatedAt: '2026-08-10T00:01:00.000Z',
  });
  sessions.archive('agent-session-archived', '2026-08-10T00:03:00.000Z');
  const turns = new SqliteAgentTurnRepository(database);
  turns.create({
    id: 'agent-turn-complete',
    siteId: 'site-one',
    sessionId: 'agent-session-one',
    approvalMode: 'approval',
    at: '2026-08-10T00:02:00.000Z',
  });
  turns.transition({
    id: 'agent-turn-complete',
    status: 'running',
    at: '2026-08-10T00:02:01.000Z',
  });
  turns.transition({
    id: 'agent-turn-complete',
    status: 'completed',
    at: '2026-08-10T00:02:02.000Z',
  });
  new SqliteAgentToolAuditRepository(database).create({
    siteId: 'site-one',
    sessionId: 'agent-session-one',
    turnId: 'agent-turn-complete',
    toolCallId: 'tool-complete',
    toolName: 'write',
    mutation: true,
    approvalDecision: 'approved',
    status: 'succeeded',
    paths: ['post.md'],
    requestedAt: '2026-08-10T00:02:00.000Z',
    updatedAt: '2026-08-10T00:02:02.000Z',
    decisionAt: '2026-08-10T00:02:01.000Z',
  });
  const attachment = Buffer.from('original-image-bytes');
  await writeFile(join(attachmentDirectory, 'attachment-one.bin'), attachment);
  new SqliteAgentAttachmentRepository(database).create({
    id: 'attachment-one',
    sessionId: 'agent-session-one',
    filename: 'diagram.png',
    mimeType: 'image/png',
    byteSize: attachment.byteLength,
    sha256: createHash('sha256').update(attachment).digest('hex'),
    storageKey: 'attachment-one.bin',
    createdAt: '2026-08-10T00:02:00.000Z',
    updatedAt: '2026-08-10T00:02:00.000Z',
  });
  const workspaceOne = join(root, 'workspace-one');
  const workspaceTwo = join(root, 'workspace-two');
  await mkdir(workspaceOne);
  await mkdir(workspaceTwo);
  await writeFile(join(workspaceOne, 'post.md'), 'Site one unchanged\n');
  await writeFile(join(workspaceTwo, 'post.md'), 'Site two unchanged\n');
  return {
    root,
    live,
    database,
    sessionDirectory,
    attachmentDirectory,
    transcriptKey,
    archivedTranscriptKey,
    workspaceOne,
    workspaceTwo,
  };
}

describe('Agent operational data backup and cold restore', () => {
  it('restores SQLite, Pi JSONL, and attachment bytes as one verified data set', async () => {
    const data = await fixture();
    const backupDirectory = join(data.root, 'backup');
    const restoredDirectory = join(data.root, 'restored');
    await createAgentOperationalBackup({
      database: data.database,
      sessionDirectory: data.sessionDirectory,
      attachmentDirectory: data.attachmentDirectory,
      destinationDirectory: backupDirectory,
      createdAt: '2026-08-10T01:00:00.000Z',
    });
    data.database.close();

    const restored = await restoreAgentOperationalBackup({
      backupDirectory,
      destinationDirectory: restoredDirectory,
    });
    await verifyAgentOperationalData(restored);
    const reopened = openStudioDatabase(restored.databasePath);
    const session = new SqliteAgentSessionRepository(reopened).get(
      'agent-session-one',
    );
    expect(session).toMatchObject({
      state: 'active',
      transcriptKey: data.transcriptKey,
    });
    expect(
      new SqliteAgentSessionRepository(reopened).get('agent-session-archived'),
    ).toMatchObject({
      state: 'archived',
      transcriptKey: data.archivedTranscriptKey,
    });
    expect(
      new SqliteAgentTurnRepository(reopened).get('agent-turn-complete'),
    ).toMatchObject({
      status: 'completed',
      approvalMode: 'approval',
    });
    expect(
      new SqliteAgentToolAuditRepository(reopened).get(
        'agent-session-one',
        'tool-complete',
      ),
    ).toMatchObject({
      approvalDecision: 'approved',
      status: 'succeeded',
      paths: ['post.md'],
    });
    const pi = SessionManager.open(
      join(restored.sessionDirectory, data.transcriptKey),
      join(restored.sessionDirectory, 'site-one'),
      '/workspace/site-one',
    );
    expect(pi.buildSessionContext().messages[0]).toMatchObject({
      role: 'custom',
      content: 'Original context',
    });
    expect(
      await readFile(
        join(restored.attachmentDirectory, 'attachment-one.bin'),
        'utf8',
      ),
    ).toBe('original-image-bytes');
    await expect(
      readFile(join(data.workspaceOne, 'post.md'), 'utf8'),
    ).resolves.toBe('Site one unchanged\n');
    await expect(
      readFile(join(data.workspaceTwo, 'post.md'), 'utf8'),
    ).resolves.toBe('Site two unchanged\n');
    reopened.close();
  });

  it('rejects a missing transcript instead of silently replacing the conversation', async () => {
    const data = await fixture();
    await rm(join(data.sessionDirectory, data.transcriptKey));
    data.database.close();

    await expect(
      verifyAgentOperationalData({
        databasePath: join(data.live, 'studio.sqlite'),
        sessionDirectory: data.sessionDirectory,
        attachmentDirectory: data.attachmentDirectory,
      }),
    ).rejects.toBeInstanceOf(AgentDataIntegrityError);
  });

  it('classifies corrupt and incompatible transcripts as actionable data errors', async () => {
    const corrupt = await fixture();
    await writeFile(
      join(corrupt.sessionDirectory, corrupt.transcriptKey),
      '{not-json}\n',
    );
    corrupt.database.close();
    await expect(
      verifyAgentOperationalData({
        databasePath: join(corrupt.live, 'studio.sqlite'),
        sessionDirectory: corrupt.sessionDirectory,
        attachmentDirectory: corrupt.attachmentDirectory,
      }),
    ).rejects.toThrow(/transcript is corrupt/);

    const incompatible = await fixture();
    await writeFile(
      join(incompatible.sessionDirectory, incompatible.transcriptKey),
      `${JSON.stringify({
        type: 'session',
        version: 999,
        id: 'future-session',
        timestamp: '2026-08-10T00:00:00.000Z',
        cwd: '/workspace/site-one',
      })}\n`,
    );
    incompatible.database.close();
    await expect(
      verifyAgentOperationalData({
        databasePath: join(incompatible.live, 'studio.sqlite'),
        sessionDirectory: incompatible.sessionDirectory,
        attachmentDirectory: incompatible.attachmentDirectory,
      }),
    ).rejects.toThrow(/transcript is incompatible/);
  });

  it('rejects an orphaned Pi JSONL file', async () => {
    const data = await fixture();
    await writeFile(
      join(data.sessionDirectory, 'orphan.jsonl'),
      `${JSON.stringify({
        type: 'session',
        version: 3,
        id: 'orphan-session',
        timestamp: '2026-08-10T00:00:00.000Z',
        cwd: '/workspace/site-one',
      })}\n`,
    );
    data.database.close();
    await expect(
      verifyAgentOperationalData({
        databasePath: join(data.live, 'studio.sqlite'),
        sessionDirectory: data.sessionDirectory,
        attachmentDirectory: data.attachmentDirectory,
      }),
    ).rejects.toThrow(/transcript is orphaned/);
  });
});
