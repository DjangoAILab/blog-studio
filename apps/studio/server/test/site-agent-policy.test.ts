import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SiteAgentMutationCoordinator } from '../services/site-agent-locks.js';
import { createStudioSiteAgentTools } from '../services/site-agent-tools.js';

function git(root: string, ...arguments_: string[]): void {
  execFileSync('git', ['-C', root, ...arguments_], { stdio: 'ignore' });
}

describe('Studio Site Agent policy composition', () => {
  it('exposes file, structured Git, and a Site-scoped shell', async () => {
    const root = await mkdtemp(join(tmpdir(), 'blog-studio-agent-tools-'));
    git(root, 'init', '-q');
    const coordinator = new SiteAgentMutationCoordinator();
    const names = createStudioSiteAgentTools({
      siteRoot: root,
      runMutation: coordinator.runner({
        siteId: 'site-one',
        sessionId: 'session-one',
        turnId: 'turn-one',
        mode: 'yolo',
        approvalGate: () => Promise.resolve('approved'),
      }),
    }).map((tool) => tool.name);

    expect(names).toEqual([
      'read',
      'write',
      'edit',
      'grep',
      'find',
      'ls',
      'delete_path',
      'move_path',
      'git_status',
      'git_diff',
      'git_log',
      'git_show',
      'git_restore_path',
      'bash',
    ]);
    expect(names).not.toEqual(
      expect.arrayContaining([
        'shell',
        'exec',
        'git_clean',
        'git_reset_hard',
        'git_push',
        'git_config',
      ]),
    );
  });

  it('shares one writer queue across policies created for separate Sessions', async () => {
    const coordinator = new SiteAgentMutationCoordinator();
    const firstPolicy = coordinator.policy(() => Promise.resolve('approved'));
    const secondPolicy = coordinator.policy(() => Promise.resolve('approved'));
    const events: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const request = {
      siteId: 'site-one',
      turnId: 'turn-one',
      toolName: 'write',
      paths: ['post.md'],
      mode: 'yolo' as const,
    };
    const first = firstPolicy.run(
      {
        ...request,
        sessionId: 'session-one',
        toolCallId: 'tool-one',
      },
      async () => {
        events.push('first:start');
        await held;
        events.push('first:end');
      },
    );
    const second = secondPolicy.run(
      {
        ...request,
        sessionId: 'session-two',
        toolCallId: 'tool-two',
      },
      () => {
        events.push('second');
        return Promise.resolve();
      },
    );

    await writeFile(
      join(await mkdtemp(join(tmpdir(), 'agent-tick-')), 'tick'),
      'x',
    );
    expect(events).toEqual(['first:start']);
    release();
    await Promise.all([first, second]);
    expect(events).toEqual(['first:start', 'first:end', 'second']);
  });
});
