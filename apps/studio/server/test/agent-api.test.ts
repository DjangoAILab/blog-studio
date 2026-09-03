import { randomUUID } from 'node:crypto';
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  AgentRuntimeEvent,
  AgentRuntimeHistoryEntry,
  SiteAgentRuntimeFactory,
  SiteAgentRuntimeFactoryInput,
  SiteAgentRuntimeHandle,
} from '@blog-studio/agent-runtime-pi';
import {
  openStudioDatabase,
  SqliteAgentTurnRepository,
  SqliteSiteRepository,
} from '@blog-studio/persistence';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { createStudioServer } from '../app.js';
import type { SiteAgentVisionAdapter } from '../services/site-agent-vision.js';

const origin = 'https://studio.example.test';
const authToken = 'agent-api-test-token-at-least-sixteen';
const cookieSecret = 'agent-api-cookie-secret-at-least-thirty-two-characters';
const apps: FastifyInstance[] = [];

class FakeRuntime implements SiteAgentRuntimeHandle {
  readonly #listeners = new Set<(event: AgentRuntimeEvent) => void>();
  readonly #history: AgentRuntimeHistoryEntry[];
  readonly #input: SiteAgentRuntimeFactoryInput;
  #running = false;
  #cancel: (() => void) | undefined;
  #toolIndex = 0;

  public constructor(
    readonly piSessionId: string,
    readonly transcriptPath: string,
    input: SiteAgentRuntimeFactoryInput,
    history: AgentRuntimeHistoryEntry[] = [],
  ) {
    this.#input = input;
    this.#history = history;
  }

  public get running(): boolean {
    return this.#running;
  }

  public history(): readonly AgentRuntimeHistoryEntry[] {
    return [...this.#history];
  }

  public appendContext(text: string): string {
    const id = `context-${this.#history.length + 1}`;
    this.#history.push({ id, kind: 'context', role: 'context', text });
    void this.#append({ id, kind: 'context', role: 'context', text });
    return id;
  }

  public subscribe(listener: (event: AgentRuntimeEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  public async prompt(text: string): Promise<void> {
    this.#running = true;
    this.#emit({ type: 'started', payload: {} });
    await this.#message('user', text);
    if (text === 'hold until canceled') {
      await new Promise<void>((resolve) => {
        this.#cancel = resolve;
      });
      this.#emit({ type: 'settled', payload: {} });
      this.#running = false;
      return;
    }
    if (text.startsWith('mutate')) {
      const path = text.includes('yolo')
        ? 'agent-yolo.md'
        : 'agent-approved.md';
      const toolCallId = `tool-${++this.#toolIndex}`;
      this.#emit({
        type: 'tool-start',
        payload: { toolCallId, toolName: 'write' },
      });
      await this.#input.mutationRunner({
        toolCallId,
        toolName: 'write',
        paths: [path],
        operation: async () => {
          await writeFile(
            join(this.#input.siteRoot, path),
            'written by Agent\n',
          );
        },
      });
      this.#emit({
        type: 'tool-end',
        payload: { toolCallId, toolName: 'write', failed: false },
      });
    }
    if (text.includes('then hold')) {
      await new Promise<void>((resolve) => {
        this.#cancel = resolve;
      });
      this.#emit({ type: 'settled', payload: {} });
      this.#running = false;
      return;
    }
    await this.#message('assistant', `Reply: ${text}`);
    this.#emit({ type: 'settled', payload: {} });
    this.#running = false;
  }

  public cancel(): Promise<void> {
    this.#cancel?.();
    this.#cancel = undefined;
    return Promise.resolve();
  }

  public dispose(): void {
    this.#listeners.clear();
  }

  async #message(role: string, text: string): Promise<void> {
    const entry: AgentRuntimeHistoryEntry = {
      id: `entry-${randomUUID()}`,
      kind: 'message',
      role,
      text,
      timestamp: Date.now(),
    };
    this.#emit({ type: 'message-start', payload: { role } });
    this.#emit({ type: 'message-update', payload: { role, text } });
    this.#history.push(entry);
    await appendFile(this.transcriptPath, `${JSON.stringify(entry)}\n`);
    this.#emit({ type: 'message-end', payload: { role } });
  }

  async #append(entry: AgentRuntimeHistoryEntry): Promise<void> {
    await appendFile(this.transcriptPath, `${JSON.stringify(entry)}\n`);
  }

  #emit(event: AgentRuntimeEvent): void {
    for (const listener of this.#listeners) listener(event);
  }
}

class FakeRuntimeFactory implements SiteAgentRuntimeFactory {
  readonly handles = new Map<string, FakeRuntime>();
  resumeCount = 0;

  public async create(
    input: SiteAgentRuntimeFactoryInput,
  ): Promise<SiteAgentRuntimeHandle> {
    await mkdir(input.sessionDirectory, { recursive: true });
    const piSessionId = `pi-${randomUUID()}`;
    const transcriptPath = join(input.sessionDirectory, `${piSessionId}.jsonl`);
    await writeFile(
      transcriptPath,
      `${JSON.stringify({
        type: 'session',
        version: 3,
        id: piSessionId,
        timestamp: new Date().toISOString(),
        cwd: input.siteRoot,
      })}\n`,
    );
    const handle = new FakeRuntime(piSessionId, transcriptPath, input);
    this.handles.set(piSessionId, handle);
    return handle;
  }

  public async resume(
    input: SiteAgentRuntimeFactoryInput,
  ): Promise<SiteAgentRuntimeHandle> {
    this.resumeCount++;
    if (!input.transcriptPath || !input.expectedPiSessionId) {
      throw new Error('Missing fake resume identity');
    }
    const lines = (await readFile(input.transcriptPath, 'utf8'))
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(1)
      .map((line) => JSON.parse(line) as AgentRuntimeHistoryEntry);
    const handle = new FakeRuntime(
      input.expectedPiSessionId,
      input.transcriptPath,
      input,
      lines,
    );
    this.handles.set(input.expectedPiSessionId, handle);
    return handle;
  }
}

interface Fixture {
  readonly app: FastifyInstance;
  readonly parent: string;
  readonly databasePath: string;
  readonly workspaceOne: string;
  readonly runtimeFactory: FakeRuntimeFactory;
}

async function fixture(
  existing?: {
    readonly parent: string;
    readonly databasePath: string;
    readonly runtimeFactory?: FakeRuntimeFactory;
  },
  visionAdapter?: SiteAgentVisionAdapter,
): Promise<Fixture> {
  const parent =
    existing?.parent ?? (await mkdtemp(join(tmpdir(), 'agent-api-')));
  const databasePath = existing?.databasePath ?? join(parent, 'studio.sqlite');
  const workspaceOne = join(parent, 'site-one');
  const workspaceTwo = join(parent, 'site-two');
  const configOne = join(parent, 'site-one.yml');
  const configTwo = join(parent, 'site-two.yml');
  if (!existing) {
    for (const workspace of [workspaceOne, workspaceTwo]) {
      await mkdir(join(workspace, 'source', '_posts'), { recursive: true });
      await writeFile(
        join(workspace, '_config.yml'),
        'url: https://example.test/\n',
      );
    }
    const configuration = (id: string, root: string) => `version: 1
workspace:
  id: ${id}
  root: ${root}
generator:
  adapter: hexo
  options:
    config: _config.yml
repository:
  adapter: local-git
assets:
  adapter: filesystem
  options:
    rootDirectory: source
    managedPrefix: media/posts
    publicBaseUrl: https://example.test/
publish:
  adapter: none
  options: {}
verification:
  baseUrl: https://example.test/
`;
    await writeFile(configOne, configuration('workspace-one', workspaceOne));
    await writeFile(configTwo, configuration('workspace-two', workspaceTwo));
    const database = openStudioDatabase(databasePath);
    const sites = new SqliteSiteRepository(database);
    for (const [id, workspaceId, path] of [
      ['site-one', 'workspace-one', configOne],
      ['site-two', 'workspace-two', configTwo],
    ] as const) {
      sites.create({
        id,
        workspaceId,
        displayName: id,
        configurationPath: path,
        capabilities: {},
        createdAt: '2026-08-10T00:00:00.000Z',
        updatedAt: '2026-08-10T00:00:00.000Z',
      });
    }
    database.close();
  }
  const runtimeFactory = existing?.runtimeFactory ?? new FakeRuntimeFactory();
  const app = await createStudioServer({
    configurationPaths: [configOne, configTwo],
    allowedWorkspaceRoot: parent,
    databasePath,
    authenticationMode: 'password',
    agentSessionDirectory: join(parent, 'agent-sessions'),
    agentRuntimeFactory: runtimeFactory,
    agentAttachmentDirectory: join(parent, 'agent-attachments'),
    ...(visionAdapter ? { agentVisionAdapter: visionAdapter } : {}),
    authToken,
    cookieSecret,
    allowedOrigins: [origin],
    secureCookies: false,
  });
  apps.push(app);
  return { app, parent, databasePath, workspaceOne, runtimeFactory };
}

async function login(app: FastifyInstance) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/session',
    headers: { origin },
    payload: { token: authToken },
  });
  expect(response.statusCode, response.body).toBe(200);
  const setCookie = response.headers['set-cookie'];
  const values = Array.isArray(setCookie) ? setCookie : [setCookie ?? ''];
  return {
    cookie: values.map((value) => value.split(';')[0]).join('; '),
    csrf: response.json<{ csrfToken: string }>().csrfToken,
  };
}

function mutationHeaders(session: Awaited<ReturnType<typeof login>>) {
  return {
    cookie: session.cookie,
    origin,
    'x-csrf-token': session.csrf,
  };
}

async function createSession(
  app: FastifyInstance,
  auth: Awaited<ReturnType<typeof login>>,
  approvalMode?: 'approval' | 'yolo',
) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/sites/site-one/agent/sessions',
    headers: mutationHeaders(auth),
    payload: {
      displayName: 'Writing Session',
      ...(approvalMode ? { approvalMode } : {}),
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{
    id: string;
    piSessionId: string;
    state: string;
    displayName: string;
  }>();
}

async function waitFor(check: () => boolean | Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for Agent test state');
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('Site Agent HTTP and streaming API', () => {
  it('requires owner authentication and CSRF on every mutation', async () => {
    const { app } = await fixture();
    const anonymous = await app.inject({
      method: 'POST',
      url: '/api/sites/site-one/agent/sessions',
      payload: { displayName: 'Denied' },
    });
    expect(anonymous.statusCode).toBe(401);

    const auth = await login(app);
    const noCsrf = await app.inject({
      method: 'POST',
      url: '/api/sites/site-one/agent/sessions',
      headers: { cookie: auth.cookie },
      payload: { displayName: 'Denied' },
    });
    expect(noCsrf.statusCode).toBe(403);
    expect((await createSession(app, auth)).state).toBe('active');
  });

  it('rate limits Agent mutations before they can become an unbounded workload', async () => {
    const { app } = await fixture();
    const auth = await login(app);
    let response;
    for (let request = 0; request < 121; request += 1) {
      response = await app.inject({
        method: 'POST',
        url: '/api/sites/site-one/agent/not-found',
        headers: mutationHeaders(auth),
        payload: {},
      });
    }
    expect(response?.statusCode).toBe(429);
    expect(response?.headers['retry-after']).toBeDefined();
  });

  it('creates, renames, archives, restores, and isolates Sessions by Site', async () => {
    const { app } = await fixture();
    const auth = await login(app);
    const created = await createSession(app, auth);
    const renamed = await app.inject({
      method: 'PATCH',
      url: `/api/sites/site-one/agent/sessions/${created.id}`,
      headers: mutationHeaders(auth),
      payload: { displayName: 'Renamed Session', approvalMode: 'yolo' },
    });
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect(renamed.json()).toMatchObject({
      displayName: 'Renamed Session',
      approvalMode: 'yolo',
    });
    const crossSite = await app.inject({
      method: 'GET',
      url: `/api/sites/site-two/agent/sessions/${created.id}`,
      headers: { cookie: auth.cookie },
    });
    expect(crossSite.statusCode).toBe(404);

    const archived = await app.inject({
      method: 'POST',
      url: `/api/sites/site-one/agent/sessions/${created.id}/archive`,
      headers: mutationHeaders(auth),
    });
    expect(archived.json()).toMatchObject({ state: 'archived' });
    const activeList = await app.inject({
      method: 'GET',
      url: '/api/sites/site-one/agent/sessions',
      headers: { cookie: auth.cookie },
    });
    expect(activeList.json<{ sessions: unknown[] }>().sessions).toEqual([]);
    const allList = await app.inject({
      method: 'GET',
      url: '/api/sites/site-one/agent/sessions?includeArchived=true',
      headers: { cookie: auth.cookie },
    });
    expect(allList.json<{ sessions: unknown[] }>().sessions).toHaveLength(1);
    const restored = await app.inject({
      method: 'POST',
      url: `/api/sites/site-one/agent/sessions/${created.id}/restore`,
      headers: mutationHeaders(auth),
    });
    expect(restored.json()).toMatchObject({ state: 'active' });
  });

  it('persists and resolves approval mode as Session over Site over global', async () => {
    const { app } = await fixture();
    const auth = await login(app);
    const session = await createSession(app, auth);
    const setDefault = (scope: 'global' | 'site', mode: string | null) =>
      app.inject({
        method: 'PUT',
        url: '/api/sites/site-one/agent/preferences',
        headers: mutationHeaders(auth),
        payload: { scope, mode },
      });
    const details = async () =>
      (
        await app.inject({
          method: 'GET',
          url: `/api/sites/site-one/agent/sessions/${session.id}`,
          headers: { cookie: auth.cookie },
        })
      ).json<{ effectiveApproval: { mode: string; source: string } }>();

    expect((await setDefault('global', 'yolo')).statusCode).toBe(200);
    expect((await details()).effectiveApproval).toEqual({
      mode: 'yolo',
      source: 'global',
    });
    expect((await setDefault('site', 'approval')).statusCode).toBe(200);
    expect((await details()).effectiveApproval).toEqual({
      mode: 'approval',
      source: 'site',
    });
    await app.inject({
      method: 'PATCH',
      url: `/api/sites/site-one/agent/sessions/${session.id}`,
      headers: mutationHeaders(auth),
      payload: { approvalMode: 'yolo' },
    });
    expect((await details()).effectiveApproval).toEqual({
      mode: 'yolo',
      source: 'session',
    });
    await app.inject({
      method: 'PATCH',
      url: `/api/sites/site-one/agent/sessions/${session.id}`,
      headers: mutationHeaders(auth),
      payload: { approvalMode: null },
    });
    expect((await details()).effectiveApproval.source).toBe('site');
    expect((await setDefault('site', null)).statusCode).toBe(200);
    expect((await details()).effectiveApproval.source).toBe('global');
  });

  it('persists terminal state before SSE completion and resumes from a cursor', async () => {
    const { app } = await fixture();
    const auth = await login(app);
    const session = await createSession(app, auth);
    const submitted = await app.inject({
      method: 'POST',
      url: `/api/sites/site-one/agent/sessions/${session.id}/messages`,
      headers: mutationHeaders(auth),
      payload: { text: 'hello Agent' },
    });
    expect(submitted.statusCode, submitted.body).toBe(202);
    const stream = await app.inject({
      method: 'GET',
      url: `/api/sites/site-one/agent/sessions/${session.id}/events`,
      headers: { cookie: auth.cookie },
    });
    expect(stream.statusCode, stream.body).toBe(200);
    expect(stream.headers['content-type']).toContain('text/event-stream');
    expect(stream.body).toContain('event: turn-completed');

    const details = await app.inject({
      method: 'GET',
      url: `/api/sites/site-one/agent/sessions/${session.id}`,
      headers: { cookie: auth.cookie },
    });
    const body = details.json<{
      history: Array<{ role: string; text: string }>;
      turns: Array<{ status: string; finishedAt?: string }>;
    }>();
    expect(body.history.map((entry) => entry.role)).toEqual([
      'user',
      'assistant',
    ]);
    expect(body.turns).toHaveLength(1);
    expect(body.turns[0]?.status).toBe('completed');
    expect(typeof body.turns[0]?.finishedAt).toBe('string');
    const ids = [...stream.body.matchAll(/^id: (\d+)$/gm)].map((match) =>
      Number(match[1]),
    );
    const reconnect = await app.inject({
      method: 'GET',
      url: `/api/sites/site-one/agent/sessions/${session.id}/events?after=${Math.max(...ids)}`,
      headers: { cookie: auth.cookie },
    });
    expect(reconnect.body).not.toMatch(/^id:/m);
    expect(reconnect.body).toContain('event: snapshot');
  });

  it('keeps a live SSE response open until a delayed turn becomes terminal', async () => {
    const { app, runtimeFactory } = await fixture();
    const auth = await login(app);
    const session = await createSession(app, auth);
    const submitted = await app.inject({
      method: 'POST',
      url: `/api/sites/site-one/agent/sessions/${session.id}/messages`,
      headers: mutationHeaders(auth),
      payload: { text: 'hold until canceled' },
    });
    expect(submitted.statusCode, submitted.body).toBe(202);
    const turn = submitted.json<{ id: string }>();
    await waitFor(
      () => runtimeFactory.handles.get(session.piSessionId)?.running ?? false,
    );

    const streamPromise = app.inject({
      method: 'GET',
      url: `/api/sites/site-one/agent/sessions/${session.id}/events`,
      headers: { cookie: auth.cookie },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const canceled = await app.inject({
      method: 'POST',
      url: `/api/sites/site-one/agent/sessions/${session.id}/turns/${turn.id}/cancel`,
      headers: mutationHeaders(auth),
    });
    expect(canceled.statusCode, canceled.body).toBe(200);

    const stream = await streamPromise;
    expect(stream.statusCode, stream.body).toBe(200);
    expect(stream.body).toContain('event: turn-canceled');
  });

  it('preserves completed tools, stops remaining work, and releases the lock on cancel', async () => {
    const { app, runtimeFactory, workspaceOne } = await fixture();
    const auth = await login(app);
    const session = await createSession(app, auth, 'yolo');
    const submitted = await app.inject({
      method: 'POST',
      url: `/api/sites/site-one/agent/sessions/${session.id}/messages`,
      headers: mutationHeaders(auth),
      payload: { text: 'mutate yolo then hold' },
    });
    const turn = submitted.json<{ id: string }>();
    await waitFor(async () => {
      if (!(runtimeFactory.handles.get(session.piSessionId)?.running ?? false))
        return false;
      const details = await app.inject({
        method: 'GET',
        url: `/api/sites/site-one/agent/sessions/${session.id}`,
        headers: { cookie: auth.cookie },
      });
      return details
        .json<{ approvals: Array<{ status: string }> }>()
        .approvals.some((approval) => approval.status === 'succeeded');
    });
    const canceled = await app.inject({
      method: 'POST',
      url: `/api/sites/site-one/agent/sessions/${session.id}/turns/${turn.id}/cancel`,
      headers: mutationHeaders(auth),
    });
    expect(canceled.statusCode, canceled.body).toBe(200);
    expect(canceled.json()).toMatchObject({ status: 'canceled' });
    const events = await app.inject({
      method: 'GET',
      url: `/api/sites/site-one/agent/sessions/${session.id}/events`,
      headers: { cookie: auth.cookie },
    });
    expect(events.body).toContain('event: turn-canceled');
    expect(events.body).not.toContain('event: turn-completed');
    expect(await readFile(join(workspaceOne, 'agent-yolo.md'), 'utf8')).toBe(
      'written by Agent\n',
    );

    const next = await app.inject({
      method: 'POST',
      url: `/api/sites/site-one/agent/sessions/${session.id}/messages`,
      headers: mutationHeaders(auth),
      payload: { text: 'mutate yolo' },
    });
    expect(next.statusCode, next.body).toBe(202);
    const nextTurn = next.json<{ id: string }>();
    await waitFor(async () =>
      (
        await app.inject({
          method: 'GET',
          url: `/api/sites/site-one/agent/sessions/${session.id}`,
          headers: { cookie: auth.cookie },
        })
      )
        .json<{ turns: Array<{ id: string; status: string }> }>()
        .turns.some(
          (item) => item.id === nextTurn.id && item.status === 'completed',
        ),
    );
  });

  it('persists approval before writing and audits YOLO through the same boundary', async () => {
    const { app, workspaceOne } = await fixture();
    const auth = await login(app);
    const approvedSession = await createSession(app, auth);
    const submitted = await app.inject({
      method: 'POST',
      url: `/api/sites/site-one/agent/sessions/${approvedSession.id}/messages`,
      headers: mutationHeaders(auth),
      payload: { text: 'mutate with approval' },
    });
    const turn = submitted.json<{ id: string }>();
    let toolCallId = '';
    await waitFor(async () => {
      const details = await app.inject({
        method: 'GET',
        url: `/api/sites/site-one/agent/sessions/${approvedSession.id}`,
        headers: { cookie: auth.cookie },
      });
      const pending = details.json<{
        approvals: Array<{ toolCallId: string; approvalDecision: string }>;
      }>().approvals[0];
      toolCallId = pending?.toolCallId ?? '';
      return pending?.approvalDecision === 'pending';
    });
    await expect(
      readFile(join(workspaceOne, 'agent-approved.md')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    const decision = await app.inject({
      method: 'POST',
      url: `/api/sites/site-one/agent/sessions/${approvedSession.id}/turns/${turn.id}/approvals/${toolCallId}`,
      headers: mutationHeaders(auth),
      payload: { decision: 'approved' },
    });
    expect(decision.statusCode, decision.body).toBe(200);
    await waitFor(async () =>
      (
        await app.inject({
          method: 'GET',
          url: `/api/sites/site-one/agent/sessions/${approvedSession.id}`,
          headers: { cookie: auth.cookie },
        })
      )
        .json<{ turns: Array<{ status: string }> }>()
        .turns.some((item) => item.status === 'completed'),
    );
    expect(
      await readFile(join(workspaceOne, 'agent-approved.md'), 'utf8'),
    ).toBe('written by Agent\n');

    const yoloSession = await createSession(app, auth, 'yolo');
    await app.inject({
      method: 'POST',
      url: `/api/sites/site-one/agent/sessions/${yoloSession.id}/messages`,
      headers: mutationHeaders(auth),
      payload: { text: 'mutate yolo' },
    });
    await waitFor(async () =>
      (
        await app.inject({
          method: 'GET',
          url: `/api/sites/site-one/agent/sessions/${yoloSession.id}`,
          headers: { cookie: auth.cookie },
        })
      )
        .json<{ turns: Array<{ status: string }> }>()
        .turns.some((item) => item.status === 'completed'),
    );
    const yoloDetails = await app.inject({
      method: 'GET',
      url: `/api/sites/site-one/agent/sessions/${yoloSession.id}`,
      headers: { cookie: auth.cookie },
    });
    expect(yoloDetails.json()).toMatchObject({
      approvals: [
        expect.objectContaining({
          approvalDecision: 'auto-approved',
          status: 'succeeded',
        }),
      ],
    });
    expect(await readFile(join(workspaceOne, 'agent-yolo.md'), 'utf8')).toBe(
      'written by Agent\n',
    );
  });

  it('materializes one-message context and retains an image across vision retry', async () => {
    let visionCalls = 0;
    const retryingVision: SiteAgentVisionAdapter = {
      configured: true,
      interpret: (input) => {
        visionCalls++;
        return visionCalls === 1
          ? Promise.reject(new Error('temporary vision outage'))
          : Promise.resolve({
              model: 'minicpm-v-test',
              text: `Recovered interpretation for ${input.filename}`,
            });
      },
    };
    const { app } = await fixture(undefined, retryingVision);
    const auth = await login(app);
    const session = await createSession(app, auth);
    const png = Buffer.concat([
      Buffer.from('89504e470d0a1a0a', 'hex'),
      Buffer.from('test-image'),
    ]);
    const uploaded = await app.inject({
      method: 'POST',
      url: `/api/sites/site-one/agent/sessions/${session.id}/attachments`,
      headers: {
        ...mutationHeaders(auth),
        'content-type': 'image/png',
        'x-blog-studio-filename': encodeURIComponent('diagram.png'),
      },
      payload: png,
    });
    expect(uploaded.statusCode, uploaded.body).toBe(201);
    const attachmentId = uploaded.json<{
      attachment: { id: string };
    }>().attachment.id;

    const submitted = await app.inject({
      method: 'POST',
      url: `/api/sites/site-one/agent/sessions/${session.id}/messages`,
      headers: mutationHeaders(auth),
      payload: {
        text: 'Use the selected paragraph',
        contexts: [
          {
            type: 'markdown-selection',
            documentId: 'post-one',
            startLine: 4,
            endLine: 5,
            text: 'Only once selection',
          },
          { type: 'image', attachmentId },
        ],
      },
    });
    expect(submitted.statusCode, submitted.body).toBe(202);
    await waitFor(async () => {
      const details = await app.inject({
        method: 'GET',
        url: `/api/sites/site-one/agent/sessions/${session.id}`,
        headers: { cookie: auth.cookie },
      });
      return (
        details.json<{ turns: Array<{ status: string }> }>().turns[0]
          ?.status === 'completed'
      );
    });
    const details = await app.inject({
      method: 'GET',
      url: `/api/sites/site-one/agent/sessions/${session.id}`,
      headers: { cookie: auth.cookie },
    });
    const beforeRetry = details.json<{
      history: Array<{ role: string; text?: string }>;
      attachments: Array<{
        id: string;
        status: string;
        messageEntryId?: string;
      }>;
    }>();
    expect(JSON.stringify(beforeRetry)).not.toContain('storageKey');
    const userMessage = beforeRetry.history.find(
      (entry) => entry.role === 'user',
    );
    expect(userMessage?.text?.match(/Only once selection/g)).toHaveLength(1);
    expect(userMessage?.text).toContain('temporary vision outage');
    const storedAttachment = beforeRetry.attachments.find(
      (attachment) => attachment.id === attachmentId,
    );
    expect(storedAttachment?.status).toBe('failed');
    expect(typeof storedAttachment?.messageEntryId).toBe('string');

    const downloaded = await app.inject({
      method: 'GET',
      url: `/api/sites/site-one/agent/sessions/${session.id}/attachments/${attachmentId}`,
      headers: { cookie: auth.cookie },
    });
    expect(downloaded.rawPayload).toEqual(png);
    const crossSite = await app.inject({
      method: 'GET',
      url: `/api/sites/site-two/agent/sessions/${session.id}/attachments/${attachmentId}`,
      headers: { cookie: auth.cookie },
    });
    expect(crossSite.statusCode).toBe(404);

    const retried = await app.inject({
      method: 'POST',
      url: `/api/sites/site-one/agent/sessions/${session.id}/attachments/${attachmentId}/vision/retry`,
      headers: mutationHeaders(auth),
      payload: {},
    });
    expect(retried.statusCode, retried.body).toBe(200);
    expect(retried.json()).toMatchObject({
      attachment: { status: 'ready', visionModel: 'minicpm-v-test' },
    });
    const afterRetry = await app.inject({
      method: 'GET',
      url: `/api/sites/site-one/agent/sessions/${session.id}`,
      headers: { cookie: auth.cookie },
    });
    expect(
      afterRetry
        .json<{ history: Array<{ text?: string }> }>()
        .history.some((entry) =>
          entry.text?.includes('Recovered interpretation for diagram.png'),
        ),
    ).toBe(true);
  });

  it('resumes history after restart and marks pre-existing active work interrupted', async () => {
    const first = await fixture();
    const auth = await login(first.app);
    const session = await createSession(first.app, auth);
    await first.app.inject({
      method: 'POST',
      url: `/api/sites/site-one/agent/sessions/${session.id}/messages`,
      headers: mutationHeaders(auth),
      payload: { text: 'persist me' },
    });
    await waitFor(
      () =>
        first.runtimeFactory.handles
          .get(session.piSessionId)
          ?.history()
          .some((entry) => entry.role === 'assistant') ?? false,
    );
    await first.app.close();
    apps.splice(apps.indexOf(first.app), 1);

    const database = openStudioDatabase(first.databasePath);
    new SqliteAgentTurnRepository(database).create({
      id: 'agent-turn-interrupted',
      siteId: 'site-one',
      sessionId: session.id,
      approvalMode: 'approval',
      at: '2026-08-10T02:00:00.000Z',
    });
    database.close();

    const secondFactory = new FakeRuntimeFactory();
    const second = await fixture({
      parent: first.parent,
      databasePath: first.databasePath,
      runtimeFactory: secondFactory,
    });
    const secondAuth = await login(second.app);
    const details = await second.app.inject({
      method: 'GET',
      url: `/api/sites/site-one/agent/sessions/${session.id}`,
      headers: { cookie: secondAuth.cookie },
    });
    expect(details.statusCode, details.body).toBe(200);
    const restored = details.json<{
      history: Array<{ role: string; text: string }>;
      turns: Array<{ id: string; status: string }>;
    }>();
    expect(restored).toMatchObject({
      history: [
        expect.objectContaining({ role: 'user', text: 'persist me' }),
        expect.objectContaining({
          role: 'assistant',
          text: 'Reply: persist me',
        }),
      ],
    });
    expect(
      restored.turns.some(
        (turn) =>
          turn.id === 'agent-turn-interrupted' && turn.status === 'interrupted',
      ),
    ).toBe(true);
    expect(secondFactory.resumeCount).toBe(1);
  });
});
