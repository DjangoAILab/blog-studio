import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  openStudioDatabase,
  SiteAlreadyExistsError,
  SiteRevisionConflictError,
  SqliteSiteRepository,
} from '../src/index.js';

const temporaryDirectories: string[] = [];

function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'blog-studio-site-'));
  temporaryDirectories.push(directory);
  return join(directory, 'studio.sqlite');
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('SQLite Site repository', () => {
  it('persists display identity separately from the technical workspace', () => {
    const path = databasePath();
    const database = openStudioDatabase(path);
    const sites = new SqliteSiteRepository(database);
    const created = sites.create({
      id: 'site-wj2015',
      workspaceId: 'wj2015-blog',
      displayName: '王二的博客',
      canonicalUrl: 'https://blog.wj2015.com',
      configurationPath: '/config/wj2015.yaml',
      capabilities: { generatorPreview: true, resources: ['image'] },
      createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-04T00:00:00.000Z',
    });
    expect(created.displayName).toBe('王二的博客');
    expect(created.workspaceId).toBe('wj2015-blog');
    expect(sites.getByWorkspaceId('wj2015-blog')).toEqual(created);
    database.close();

    const reopened = openStudioDatabase(path);
    expect(new SqliteSiteRepository(reopened).list()).toEqual([created]);
    reopened.close();
  });

  it('enforces case-insensitive display names and technical identities', () => {
    const database = openStudioDatabase(databasePath());
    const sites = new SqliteSiteRepository(database);
    sites.create({
      id: 'site-one',
      workspaceId: 'workspace-one',
      displayName: 'Personal Blog',
      configurationPath: '/config/one.yaml',
      capabilities: {},
      createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-04T00:00:00.000Z',
    });
    expect(() =>
      sites.create({
        id: 'site-two',
        workspaceId: 'workspace-two',
        displayName: 'personal blog',
        configurationPath: '/config/two.yaml',
        capabilities: {},
        createdAt: '2026-08-04T00:00:01.000Z',
        updatedAt: '2026-08-04T00:00:01.000Z',
      }),
    ).toThrow(SiteAlreadyExistsError);
    expect(() =>
      sites.create({
        id: 'site-three',
        workspaceId: 'workspace-one',
        displayName: 'Other Blog',
        configurationPath: '/config/three.yaml',
        capabilities: {},
        createdAt: '2026-08-04T00:00:01.000Z',
        updatedAt: '2026-08-04T00:00:01.000Z',
      }),
    ).toThrow(SiteAlreadyExistsError);
    database.close();
  });

  it('updates settings optimistically without changing the workspace binding', () => {
    const database = openStudioDatabase(databasePath());
    const sites = new SqliteSiteRepository(database);
    sites.create({
      id: 'site-one',
      workspaceId: 'workspace-one',
      displayName: 'Before',
      configurationPath: '/config/one.yaml',
      capabilities: { preview: false },
      createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-04T00:00:00.000Z',
    });
    const updated = sites.update({
      id: 'site-one',
      expectedUpdatedAt: '2026-08-04T00:00:00.000Z',
      displayName: 'After',
      canonicalUrl: 'https://example.com',
      capabilities: { preview: true },
      updatedAt: '2026-08-04T00:00:01.000Z',
    });
    expect(updated.workspaceId).toBe('workspace-one');
    expect(updated.configurationPath).toBe('/config/one.yaml');
    expect(() =>
      sites.update({
        id: 'site-one',
        expectedUpdatedAt: '2026-08-04T00:00:00.000Z',
        displayName: 'Stale',
        capabilities: {},
        updatedAt: '2026-08-04T00:00:02.000Z',
      }),
    ).toThrow(SiteRevisionConflictError);
    expect(sites.get('site-one')?.displayName).toBe('After');
    database.close();
  });
});
