import { execFileSync } from 'node:child_process';
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rename,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  assertSitePath,
  createAttachmentImportTool,
  createSiteFileTools,
  createStructuredGitTools,
  SiteMutationPolicy,
  SiteMutationRejectedError,
  SitePathEscapeError,
  SitePathProtectedError,
  SiteWriteLocks,
  StructuredGitInputError,
  StructuredSiteGit,
} from '../src/index.js';

function git(root: string, ...arguments_: string[]): string {
  return execFileSync('git', ['-C', root, ...arguments_], {
    encoding: 'utf8',
  });
}

async function repositoryFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'blog-studio-structured-git-'));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'tests@example.invalid');
  git(root, 'config', 'user.name', 'Blog Studio Tests');
  await writeFile(join(root, 'post.md'), 'before\n');
  await writeFile(join(root, 'other.md'), 'stable\n');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'baseline');
  return root;
}

describe('Site Agent hard tool policy', () => {
  it('passes a canonical path to Pi and protects Git internals', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'blog-studio-canonical-'));
    const siteRoot = join(fixtureRoot, 'site');
    await mkdir(join(siteRoot, 'content'), { recursive: true });
    await writeFile(join(siteRoot, 'content', 'post.md'), 'safe\n');
    await symlink(join(siteRoot, 'content'), join(siteRoot, 'linked-content'));

    await expect(
      assertSitePath(siteRoot, 'linked-content/post.md'),
    ).resolves.toBe(await realpath(join(siteRoot, 'content', 'post.md')));
    await expect(
      assertSitePath(siteRoot, '.git/config'),
    ).rejects.toBeInstanceOf(SitePathProtectedError);

    const read = createSiteFileTools(siteRoot).find(
      (tool) => tool.name === 'read',
    );
    expect(read).toBeDefined();
    const result = await read!.execute(
      'read-one',
      { path: 'linked-content/post.md' },
      undefined,
      undefined,
      {} as never,
    );
    expect(result.content).toContainEqual({ type: 'text', text: 'safe\n' });
  });

  it('keeps approval and YOLO behind the same per-Site writer lock', async () => {
    const locks = new SiteWriteLocks();
    let decide!: (decision: 'approved' | 'rejected') => void;
    const decision = new Promise<'approved' | 'rejected'>((resolve) => {
      decide = resolve;
    });
    const policy = new SiteMutationPolicy(locks, () => decision);
    const events: string[] = [];
    const approval = policy.run(
      {
        siteId: 'site-a',
        sessionId: 'session-a1',
        turnId: 'turn-a1',
        toolCallId: 'tool-a1',
        toolName: 'write',
        paths: ['post.md'],
        mode: 'approval',
      },
      () => {
        events.push('approval-write');
        return Promise.resolve();
      },
    );
    const queuedYolo = policy.run(
      {
        siteId: 'site-a',
        sessionId: 'session-a2',
        turnId: 'turn-a2',
        toolCallId: 'tool-a2',
        toolName: 'edit',
        paths: ['other.md'],
        mode: 'yolo',
      },
      () => {
        events.push('yolo-same-site');
        return Promise.resolve();
      },
    );
    const otherSite = policy.run(
      {
        siteId: 'site-b',
        sessionId: 'session-b1',
        turnId: 'turn-b1',
        toolCallId: 'tool-b1',
        toolName: 'write',
        paths: ['post.md'],
        mode: 'yolo',
      },
      () => {
        events.push('yolo-other-site');
        return Promise.resolve();
      },
    );

    await otherSite;
    expect(events).toEqual(['yolo-other-site']);
    decide('approved');
    await Promise.all([approval, queuedYolo]);
    expect(events).toEqual([
      'yolo-other-site',
      'approval-write',
      'yolo-same-site',
    ]);
  });

  it('routes delete and move through the shared mutation runner', async () => {
    const root = await mkdtemp(join(tmpdir(), 'blog-studio-file-mutations-'));
    await writeFile(join(root, 'delete.md'), 'remove me\n');
    await writeFile(join(root, 'move.md'), 'move me\n');
    const calls: string[] = [];
    const tools = createSiteFileTools(root, async (input) => {
      calls.push(input.toolName);
      return await input.operation();
    });
    const deleteTool = tools.find((tool) => tool.name === 'delete_path')!;
    const moveTool = tools.find((tool) => tool.name === 'move_path')!;

    await deleteTool.execute(
      'delete-one',
      { path: 'delete.md' },
      undefined,
      undefined,
      {} as never,
    );
    await moveTool.execute(
      'move-one',
      { source: 'move.md', destination: 'moved.md' },
      undefined,
      undefined,
      {} as never,
    );

    await expect(access(join(root, 'delete.md'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(readFile(join(root, 'moved.md'), 'utf8')).resolves.toBe(
      'move me\n',
    );
    expect(calls).toEqual(['delete_path', 'move_path']);
  });

  it('revalidates a write after approval closes a symlink-swap window', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'blog-studio-race-'));
    const siteRoot = join(fixtureRoot, 'site');
    const outsideRoot = join(fixtureRoot, 'outside');
    await mkdir(join(siteRoot, 'content'), { recursive: true });
    await mkdir(outsideRoot, { recursive: true });
    const tools = createSiteFileTools(siteRoot, async (input) => {
      await rename(join(siteRoot, 'content'), join(siteRoot, 'original'));
      await symlink(outsideRoot, join(siteRoot, 'content'));
      return await input.operation();
    });
    const write = tools.find((tool) => tool.name === 'write')!;

    await expect(
      write.execute(
        'write-after-approval',
        { path: 'content/post.md', content: 'must stay contained\n' },
        undefined,
        undefined,
        {} as never,
      ),
    ).rejects.toBeInstanceOf(SitePathEscapeError);
    await expect(access(join(outsideRoot, 'post.md'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('imports a Session attachment only through the mutation runner', async () => {
    const root = await mkdtemp(
      join(tmpdir(), 'blog-studio-attachment-import-'),
    );
    await mkdir(join(root, 'source'), { recursive: true });
    const calls: string[] = [];
    const tool = createAttachmentImportTool(
      root,
      {
        load: (attachmentId) => {
          expect(attachmentId).toBe('attachment-one');
          return Promise.resolve({
            filename: 'photo.png',
            bytes: Buffer.from('original attachment bytes'),
          });
        },
      },
      async (input) => {
        calls.push(input.toolName);
        return await input.operation();
      },
    );

    await tool.execute(
      'import-one',
      {
        attachmentId: 'attachment-one',
        destination: 'source/photo.png',
      },
      undefined,
      undefined,
      {} as never,
    );

    expect(calls).toEqual(['import_attachment']);
    await expect(
      readFile(join(root, 'source', 'photo.png'), 'utf8'),
    ).resolves.toBe('original attachment bytes');
    await expect(
      tool.execute(
        'import-escape',
        { attachmentId: 'attachment-one', destination: '../photo.png' },
        undefined,
        undefined,
        {} as never,
      ),
    ).rejects.toBeInstanceOf(SitePathEscapeError);
    expect(calls).toEqual(['import_attachment']);
  });

  it('rejects an approval without running or blocking the next mutation', async () => {
    const policy = new SiteMutationPolicy(new SiteWriteLocks(), () =>
      Promise.resolve('rejected'),
    );
    let wrote = false;
    await expect(
      policy.run(
        {
          siteId: 'site-a',
          sessionId: 'session-a',
          turnId: 'turn-a',
          toolCallId: 'tool-a',
          toolName: 'write',
          paths: ['post.md'],
          mode: 'approval',
        },
        () => {
          wrote = true;
          return Promise.resolve();
        },
      ),
    ).rejects.toBeInstanceOf(SiteMutationRejectedError);
    expect(wrote).toBe(false);
  });

  it('offers only fixed local Git inspection and path restore operations', async () => {
    const root = await repositoryFixture();
    const structured = new StructuredSiteGit(root);
    await writeFile(join(root, 'post.md'), 'after\n');

    expect(await structured.status()).toContain(' M post.md');
    expect(await structured.diff('post.md')).toContain('+after');
    expect(await structured.log({ limit: 1 })).toContain('baseline');
    expect(
      await structured.show({ revision: 'HEAD', path: 'post.md' }),
    ).toContain('before');
    await structured.restorePath({ path: 'post.md' });
    expect(await readFile(join(root, 'post.md'), 'utf8')).toBe('before\n');
    expect(await readFile(join(root, 'other.md'), 'utf8')).toBe('stable\n');

    expect(
      Object.getOwnPropertyNames(StructuredSiteGit.prototype).sort(),
    ).toEqual([
      'captureTrackedFile',
      'constructor',
      'diff',
      'log',
      'restoreAgentSnapshot',
      'restorePath',
      'sealTrackedFile',
      'show',
      'status',
    ]);
    expect(createStructuredGitTools(root).map((tool) => tool.name)).toEqual([
      'git_status',
      'git_diff',
      'git_log',
      'git_show',
    ]);
    expect(
      createStructuredGitTools(
        root,
        async ({ operation }) => await operation(),
      ).map((tool) => tool.name),
    ).toEqual([
      'git_status',
      'git_diff',
      'git_log',
      'git_show',
      'git_restore_path',
    ]);
  });

  it('reverts only the current Agent delta and refuses later edits', async () => {
    const root = await repositoryFixture();
    const structured = new StructuredSiteGit(root);
    const first = await structured.captureTrackedFile('post.md');
    expect(first).not.toBeNull();
    await writeFile(join(root, 'post.md'), 'changed by Agent\n');
    const sealed = await structured.sealTrackedFile(first!);

    await structured.restoreAgentSnapshot(sealed);
    expect(await readFile(join(root, 'post.md'), 'utf8')).toBe('before\n');

    await writeFile(join(root, 'post.md'), 'changed by Agent again\n');
    const second = await structured.sealTrackedFile(first!);
    await writeFile(join(root, 'post.md'), 'later human work\n');
    await expect(
      structured.restoreAgentSnapshot(second),
    ).rejects.toBeInstanceOf(StructuredGitInputError);
    expect(await readFile(join(root, 'post.md'), 'utf8')).toBe(
      'later human work\n',
    );
  });

  it('rejects path escape, repository-wide restore, and option-like revisions', async () => {
    const root = await repositoryFixture();
    const outside = join(root, '..', 'outside.md');
    await writeFile(outside, 'outside\n');
    const structured = new StructuredSiteGit(root);

    await expect(structured.diff('../outside.md')).rejects.toBeInstanceOf(
      SitePathEscapeError,
    );
    await expect(structured.restorePath({ path: '.' })).rejects.toBeInstanceOf(
      StructuredGitInputError,
    );
    await expect(
      structured.show({ revision: '--help' }),
    ).rejects.toBeInstanceOf(StructuredGitInputError);
    await expect(structured.log({ limit: 51 })).rejects.toBeInstanceOf(
      StructuredGitInputError,
    );
  });
});
