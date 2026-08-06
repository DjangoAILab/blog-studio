import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  openStudioDatabase,
  SqliteSiteRepository,
} from '@blog-studio/persistence';
import { expect, it } from 'vitest';

import { SiteService } from '../services/sites.js';
import { WorkspaceService } from '../services/workspaces.js';

const referenceRoot = process.env.BLOG_STUDIO_REFERENCE_ROOT;
const verifyReference = referenceRoot ? it : it.skip;

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function git(root: string, ...arguments_: readonly string[]): string {
  return execFileSync('git', ['-C', root, ...arguments_], {
    encoding: 'utf8',
  }).trim();
}

verifyReference(
  'discovers and registers the real reference blog without mutating it',
  async () => {
    const root = referenceRoot!;
    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), 'blog-studio-reference-site-'),
    );
    const configurationPath = join(temporaryDirectory, 'blog-studio.yml');
    const databasePath = join(temporaryDirectory, 'blog-studio.sqlite');
    const sourceConfigurationPath = join(root, '_config.yml');
    const before = {
      head: git(root, 'rev-parse', 'HEAD'),
      status: git(root, 'status', '--porcelain=v1'),
      configuration: sha256(await readFile(sourceConfigurationPath)),
      staticIndex: sha256(
        Buffer.from(git(root, 'ls-files', '-s', 'source/static')),
      ),
    };
    expect(before.status).toBe('');

    await writeFile(
      configurationPath,
      `version: 1
site:
  displayName: wj2015-blog
  canonicalUrl: https://blog.wj2015.com/
resources:
  maxInputBytes: 12582912
  allowedMediaTypes:
    - image/png
    - image/jpeg
    - image/webp
    - application/pdf
    - application/zip
    - text/plain
  inlinePreviewMediaTypes:
    - image/png
    - image/jpeg
    - image/webp
    - application/pdf
workspace:
  id: wj2015-blog
  root: ${JSON.stringify(root)}
generator:
  adapter: hexo
  options:
    buildTimeoutMs: 180000
repository:
  adapter: local-git
  options: {}
assets:
  adapter: filesystem
  options:
    rootDirectory: source
    managedPrefix: media/posts
    protectedPrefixes: [static]
    publicBaseUrl: https://blog.wj2015.com/
publish:
  adapter: none
  options: {}
verification:
  baseUrl: https://blog.wj2015.com/
`,
    );

    const database = openStudioDatabase(databasePath);
    try {
      const workspaces = await WorkspaceService.load({
        configurationPaths: [configurationPath],
        allowedWorkspaceRoot: dirname(root),
      });
      const sites = new SiteService(
        workspaces,
        new SqliteSiteRepository(database),
      );
      const candidates = await sites.discover();
      expect(candidates).toHaveLength(1);
      const candidate = candidates[0]!;
      expect(candidate).toMatchObject({
        candidateId: 'wj2015-blog',
        proposedDisplayName: 'wj2015-blog',
        canonicalUrl: 'https://blog.wj2015.com/',
        capabilities: {
          generator: 'hexo',
          generatorPreview: true,
          nativeDrafts: true,
          assetProvider: 'filesystem',
          publishProvider: 'none',
          publishConfigured: false,
        },
        repository: {
          available: true,
          branch: 'master',
          dirtyCount: 0,
        },
      });
      expect(candidate.contentCounts.posts).toBeGreaterThan(0);
      expect(candidate.contentCounts.drafts).toBeGreaterThanOrEqual(0);
      expect(candidate.capabilities.resourceMediaTypes).toContain(
        'application/pdf',
      );
      expect(candidate.repository.available).toBe(true);

      const site = sites.register({
        candidateId: candidate.candidateId,
        displayName: candidate.proposedDisplayName,
        canonicalUrl: candidate.canonicalUrl!,
        at: '2026-08-04T08:00:00.000Z',
      });
      expect(site).toMatchObject({
        displayName: 'wj2015-blog',
        canonicalUrl: 'https://blog.wj2015.com/',
      });
      expect('workspaceId' in site).toBe(false);
      expect(await sites.discover()).toEqual([]);
    } finally {
      database.close();
      await rm(temporaryDirectory, { recursive: true, force: true });
    }

    expect({
      head: git(root, 'rev-parse', 'HEAD'),
      status: git(root, 'status', '--porcelain=v1'),
      configuration: sha256(await readFile(sourceConfigurationPath)),
      staticIndex: sha256(
        Buffer.from(git(root, 'ls-files', '-s', 'source/static')),
      ),
    }).toEqual(before);
  },
  30_000,
);
