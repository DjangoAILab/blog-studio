import { mkdtemp, mkdir, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SessionManager } from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { describe, expect, it } from 'vitest';

import {
  assertSitePath,
  createSiteAgentSession,
  createSiteFileTools,
  resolveAgentApprovalMode,
  SitePathEscapeError,
  SiteWriteLocks,
} from '../src/index.js';

describe('Site Agent Pi feasibility', () => {
  it('streams lifecycle events and cancels without a provider request', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'blog-studio-events-'));
    const siteRoot = join(fixtureRoot, 'site');
    await mkdir(siteRoot);
    const modelRuntime = await ModelRuntime.create({
      authPath: join(fixtureRoot, 'auth.json'),
      modelsPath: null,
      refreshOnCreate: false,
      allowModelNetwork: false,
    });
    modelRuntime.registerProvider('poc-provider', {
      baseUrl: 'https://example.invalid',
      apiKey: 'poc-only',
      api: 'openai-completions',
      models: [
        {
          id: 'poc-model',
          name: 'POC model',
          reasoning: false,
          input: ['text'],
          cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
          },
          contextWindow: 8_192,
          maxTokens: 1_024,
        },
      ],
      streamSimple: (model, _context, options) => {
        const stream = createAssistantMessageEventStream();
        const message = {
          role: 'assistant' as const,
          content: [],
          api: model.api,
          provider: model.provider,
          model: model.id,
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
          stopReason: 'aborted' as const,
          timestamp: Date.now(),
        };
        stream.push({ type: 'start', partial: message });
        options?.signal?.addEventListener(
          'abort',
          () =>
            stream.push({ type: 'error', reason: 'aborted', error: message }),
          { once: true },
        );
        return stream;
      },
    });
    const model = modelRuntime.getModel('poc-provider', 'poc-model');
    expect(model).toBeDefined();
    const { session } = await createSiteAgentSession({
      siteRoot,
      agentDir: join(fixtureRoot, 'agent'),
      modelRuntime,
      model,
      sessionManager: SessionManager.inMemory(siteRoot),
    });
    const eventTypes: string[] = [];
    let started!: () => void;
    const startEvent = new Promise<void>((resolve) => {
      started = resolve;
    });
    const unsubscribe = session.subscribe((event) => {
      eventTypes.push(event.type);
      if (event.type === 'agent_start') started();
    });

    const prompt = session.prompt('Wait until canceled.');
    await startEvent;
    await session.abort();
    await prompt;
    unsubscribe();
    session.dispose();

    expect(eventTypes).toContain('agent_start');
    expect(eventTypes).toContain('agent_end');
    expect(eventTypes).toContain('agent_settled');
    expect(session.state.messages.at(-1)).toMatchObject({
      role: 'assistant',
      stopReason: 'error',
      errorMessage: 'This operation was aborted',
    });
  });

  it('creates a Pi SDK session offline with only the scoped tools', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'blog-studio-runtime-'));
    const siteRoot = join(fixtureRoot, 'site');
    await mkdir(siteRoot);

    const { session } = await createSiteAgentSession({
      siteRoot,
      agentDir: join(fixtureRoot, 'agent'),
      sessionManager: SessionManager.inMemory(siteRoot),
    });

    expect(session.getActiveToolNames()).toEqual([
      'read',
      'write',
      'edit',
      'grep',
      'find',
      'ls',
      'git_status',
      'git_diff',
      'git_log',
      'git_show',
    ]);
  });

  it('exposes Pi file tools without bash', async () => {
    const siteRoot = await mkdtemp(join(tmpdir(), 'blog-studio-site-'));
    const names = createSiteFileTools(siteRoot).map((tool) => tool.name);

    expect(names).toEqual(['read', 'write', 'edit', 'grep', 'find', 'ls']);
    expect(names).not.toContain('bash');
  });

  it('rejects lexical, absolute, and symlink escapes', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'blog-studio-paths-'));
    const siteRoot = join(fixtureRoot, 'site');
    const outsideRoot = join(fixtureRoot, 'outside');
    await mkdir(siteRoot);
    await mkdir(outsideRoot);
    await writeFile(join(outsideRoot, 'secret.txt'), 'outside');
    await symlink(outsideRoot, join(siteRoot, 'linked-outside'));

    const canonicalSiteRoot = await realpath(siteRoot);
    await expect(assertSitePath(siteRoot, 'content/new.md')).resolves.toBe(
      join(canonicalSiteRoot, 'content/new.md'),
    );
    await expect(
      assertSitePath(siteRoot, '../outside/secret.txt'),
    ).rejects.toBeInstanceOf(SitePathEscapeError);
    await expect(
      assertSitePath(siteRoot, join(outsideRoot, 'secret.txt')),
    ).rejects.toBeInstanceOf(SitePathEscapeError);
    await expect(
      assertSitePath(siteRoot, 'linked-outside/secret.txt'),
    ).rejects.toBeInstanceOf(SitePathEscapeError);
  });

  it('persists selection context once and restores it from Pi JSONL', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'blog-studio-session-'));
    const siteRoot = join(fixtureRoot, 'site');
    const sessionRoot = join(fixtureRoot, 'sessions');
    await mkdir(siteRoot);

    const session = SessionManager.create(siteRoot, sessionRoot);
    session.appendCustomMessageEntry(
      'blog-studio.selection',
      'Selected Markdown:\n\nA paragraph attached to one message.',
      true,
      { articlePath: 'content/post.md', startLine: 8, endLine: 9 },
    );
    session.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'Acknowledged.' }],
      api: 'openai-completions',
      provider: 'openai',
      model: 'poc-model',
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'stop',
      timestamp: Date.now(),
    });

    const sessionFile = session.getSessionFile();
    expect(sessionFile).toBeDefined();
    const restored = SessionManager.open(sessionFile!, sessionRoot, siteRoot);
    const selectionEntries = restored
      .getEntries()
      .filter(
        (entry) =>
          entry.type === 'custom_message' &&
          entry.customType === 'blog-studio.selection',
      );

    expect(restored.getSessionId()).toBe(session.getSessionId());
    expect(selectionEntries).toHaveLength(1);
    expect(restored.buildSessionContext().messages[0]).toMatchObject({
      role: 'custom',
      customType: 'blog-studio.selection',
      content: 'Selected Markdown:\n\nA paragraph attached to one message.',
    });
  });

  it('round-trips image content for a replaceable vision adapter', async () => {
    const fixtureRoot = await mkdtemp(
      join(tmpdir(), 'blog-studio-image-session-'),
    );
    const siteRoot = join(fixtureRoot, 'site');
    const sessionRoot = join(fixtureRoot, 'sessions');
    await mkdir(siteRoot);

    const session = SessionManager.create(siteRoot, sessionRoot);
    session.appendCustomMessageEntry(
      'blog-studio.vision',
      [
        { type: 'text', text: 'Vision result: a diagram.' },
        { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' },
      ],
      true,
      { attachmentId: 'attachment-poc' },
    );
    session.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'Image context received.' }],
      api: 'openai-completions',
      provider: 'openai',
      model: 'poc-model',
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'stop',
      timestamp: Date.now(),
    });

    const restored = SessionManager.open(
      session.getSessionFile()!,
      sessionRoot,
      siteRoot,
    );
    expect(restored.buildSessionContext().messages[0]).toMatchObject({
      role: 'custom',
      customType: 'blog-studio.vision',
      content: [
        { type: 'text', text: 'Vision result: a diagram.' },
        { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' },
      ],
    });
  });

  it('resolves approval preference as Session, Site, then global', () => {
    expect(
      resolveAgentApprovalMode({
        global: 'approval',
        site: 'yolo',
        session: 'approval',
      }),
    ).toBe('approval');
    expect(resolveAgentApprovalMode({ global: 'approval', site: 'yolo' })).toBe(
      'yolo',
    );
    expect(resolveAgentApprovalMode({ global: 'approval' })).toBe('approval');
  });

  it('serializes writes for one Site while allowing different Sites to overlap', async () => {
    const locks = new SiteWriteLocks();
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstMayFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = locks.run('site-a', async () => {
      events.push('a1:start');
      await firstMayFinish;
      events.push('a1:end');
    });
    const second = locks.run('site-a', () => {
      events.push('a2:start');
      events.push('a2:end');
      return Promise.resolve();
    });
    const otherSite = locks.run('site-b', () => {
      events.push('b:start');
      events.push('b:end');
      return Promise.resolve();
    });

    await otherSite;
    expect(events).toEqual(['a1:start', 'b:start', 'b:end']);
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual([
      'a1:start',
      'b:start',
      'b:end',
      'a1:end',
      'a2:start',
      'a2:end',
    ]);
  });
});
