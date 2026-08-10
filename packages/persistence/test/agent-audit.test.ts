import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  openStudioDatabase,
  SqliteAgentSessionRepository,
  SqliteAgentToolAuditRepository,
  SqliteSiteRepository,
} from '../src/index.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('SQLite Agent tool audit index', () => {
  it('indexes approval and terminal state without copying tool payloads', () => {
    const directory = mkdtempSync(join(tmpdir(), 'blog-studio-agent-audit-'));
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
    const audit = new SqliteAgentToolAuditRepository(database);

    audit.create({
      siteId: 'site-one',
      sessionId: 'session-one',
      turnId: 'turn-one',
      toolCallId: 'call-one',
      toolName: 'write',
      mutation: true,
      approvalDecision: 'pending',
      status: 'requested',
      paths: ['content/post.md'],
      requestedAt: '2026-08-10T00:01:00.000Z',
      updatedAt: '2026-08-10T00:01:00.000Z',
    });
    const completed = audit.update({
      sessionId: 'session-one',
      toolCallId: 'call-one',
      piEntryId: 'pi-entry-one',
      approvalDecision: 'approved',
      status: 'succeeded',
      updatedAt: '2026-08-10T00:02:00.000Z',
      decisionAt: '2026-08-10T00:01:30.000Z',
    });

    expect(completed).toMatchObject({
      sequence: 1,
      piEntryId: 'pi-entry-one',
      approvalDecision: 'approved',
      status: 'succeeded',
      paths: ['content/post.md'],
      decisionAt: '2026-08-10T00:01:30.000Z',
    });
    expect(audit.list('session-one')).toEqual([completed]);
    const columns = database
      .prepare(
        `SELECT name FROM pragma_table_info('agent_tool_audit') ORDER BY cid`,
      )
      .all();
    expect(columns).not.toEqual(
      expect.arrayContaining([
        { name: 'arguments_json' },
        { name: 'result_json' },
      ]),
    );
    database.close();
  });

  it('persists exactly one approval decision before execution', () => {
    const directory = mkdtempSync(join(tmpdir(), 'blog-studio-agent-audit-'));
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
    const audit = new SqliteAgentToolAuditRepository(database);
    audit.create({
      siteId: 'site-one',
      sessionId: 'session-one',
      turnId: 'turn-one',
      toolCallId: 'call-pending',
      toolName: 'write',
      mutation: true,
      approvalDecision: 'pending',
      status: 'requested',
      paths: ['content/post.md'],
      requestedAt: '2026-08-10T00:01:00.000Z',
      updatedAt: '2026-08-10T00:01:00.000Z',
    });

    expect(
      audit.decide({
        sessionId: 'session-one',
        toolCallId: 'call-pending',
        decision: 'approved',
        at: '2026-08-10T00:01:30.000Z',
      }),
    ).toMatchObject({
      approvalDecision: 'approved',
      decisionAt: '2026-08-10T00:01:30.000Z',
    });
    expect(() =>
      audit.decide({
        sessionId: 'session-one',
        toolCallId: 'call-pending',
        decision: 'rejected',
        at: '2026-08-10T00:01:40.000Z',
      }),
    ).toThrow(/call-pending/);
    audit.create({
      siteId: 'site-one',
      sessionId: 'session-one',
      turnId: 'turn-interrupted',
      toolCallId: 'call-interrupted',
      toolName: 'edit',
      mutation: true,
      approvalDecision: 'pending',
      status: 'requested',
      paths: ['content/interrupted.md'],
      requestedAt: '2026-08-10T00:02:00.000Z',
      updatedAt: '2026-08-10T00:02:00.000Z',
    });
    expect(
      audit.interruptTurn('turn-interrupted', '2026-08-10T00:03:00.000Z'),
    ).toBe(1);
    expect(audit.get('session-one', 'call-interrupted')).toMatchObject({
      approvalDecision: 'rejected',
      status: 'canceled',
      decisionAt: '2026-08-10T00:03:00.000Z',
    });
    database.close();
  });
});
