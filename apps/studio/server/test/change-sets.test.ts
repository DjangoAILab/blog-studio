import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createContentHash,
  createDocumentId,
  createSiteId,
  createWorkspaceId,
  type DocumentSource,
} from '@blog-studio/core';
import {
  openStudioDatabase,
  SqliteChangeSetRepository,
  SqliteDraftRepository,
  SqliteSiteRepository,
} from '@blog-studio/persistence';
import { afterEach, describe, expect, it } from 'vitest';

import { ChangeSetService } from '../services/change-sets.js';
import type { SiteService } from '../services/sites.js';
import type { WorkspaceService } from '../services/workspaces.js';

const roots: string[] = [];

function hash(value: string) {
  return createContentHash(
    `sha256:${createHash('sha256').update(value).digest('hex')}`,
  );
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});

describe('ChangeSet interrupted-apply recovery', () => {
  it('uses the durable journal to roll a target document back on restart', async () => {
    const root = mkdtempSync(join(tmpdir(), 'blog-studio-change-recovery-'));
    roots.push(root);
    const database = openStudioDatabase(join(root, 'studio.sqlite'));
    const siteId = createSiteId('site-one');
    const workspaceId = createWorkspaceId('workspace-one');
    const documentId = createDocumentId('post-one');
    const ref = {
      workspaceId,
      collectionId: 'posts',
      documentId,
      path: 'source/_posts/one.md',
    } as const;
    const original = {
      frontMatter: { title: 'Before' },
      body: 'before\n',
      revision: hash('before'),
    };
    let current = { ...original };
    const generator = {
      id: 'test',
      inspect: () =>
        Promise.resolve({
          collections: [{ id: 'posts' }],
        }),
      listDocuments: () =>
        Promise.resolve([
          {
            ref,
            revision: current.revision,
            title: String(current.frontMatter.title),
            tags: [],
            state: 'published',
          },
        ]),
      readDocument: (): Promise<DocumentSource> =>
        Promise.resolve({
          ref,
          revision: current.revision,
          frontMatter: current.frontMatter,
          body: current.body,
          raw: current.body,
          format: 'markdown',
        }),
      writeDocument: (
        _root: string,
        input: {
          expectedRevision: string;
          frontMatter: Readonly<Record<string, unknown>>;
          body: string;
        },
      ) => {
        if (input.expectedRevision !== current.revision)
          throw new Error('revision conflict');
        current = {
          frontMatter: input.frontMatter as { title: string },
          body: input.body,
          revision: hash(JSON.stringify(input.frontMatter) + input.body),
        };
        return Promise.resolve({ revision: current.revision, changed: true });
      },
    };
    const workspace = {
      config: { workspace: { id: workspaceId, root } },
      generator,
      repository: {
        status: () =>
          Promise.resolve({
            branch: 'main',
            head: hash('head'),
            dirtyPaths: [],
            ahead: 0,
            behind: 0,
            changes: [],
          }),
      },
    };
    const sites = {
      get: () => ({ id: siteId }),
      workspaceId: () => workspaceId,
    } as unknown as SiteService;
    const workspaces = {
      get: () => workspace,
      findDocument: () =>
        Promise.resolve({
          ref,
          summary: {
            ref,
            revision: current.revision,
            title: 'Before',
            tags: [],
            state: 'published',
          },
        }),
    } as unknown as WorkspaceService;
    new SqliteSiteRepository(database).create({
      id: siteId,
      workspaceId,
      displayName: 'One',
      configurationPath: '/one.yml',
      capabilities: {},
      createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-04T00:00:00.000Z',
    });
    const drafts = new SqliteDraftRepository(database);
    drafts.save({
      workspaceId,
      documentId,
      expectedVersion: 0,
      sourceRevision: original.revision,
      frontMatter: { title: 'After' },
      body: 'after\n',
      savedAt: '2026-08-04T00:00:01.000Z',
    });
    const records = new SqliteChangeSetRepository(database);
    const service = new ChangeSetService(
      sites,
      workspaces,
      drafts,
      records,
      () => new Date('2026-08-04T00:00:02.000Z'),
    );
    const prepared = await service.prepare(siteId);
    const document = prepared.payload.documents[0]!;
    records.beginApply({
      id: 'apply-crashed',
      changeSetId: prepared.id,
      journal: {
        siteId,
        documents: [{ ...document, ref }],
      },
      at: '2026-08-04T00:00:03.000Z',
    });
    current = {
      frontMatter: document.frontMatter as { title: string },
      body: document.body,
      revision: hash(JSON.stringify(document.frontMatter) + document.body),
    };

    await service.recover();

    expect(current.frontMatter).toEqual(original.frontMatter);
    expect(current.body).toBe(original.body);
    expect(records.applying()).toEqual([]);
    expect(records.get(prepared.id)?.status).toBe('prepared');
    database.close();
  });
});
