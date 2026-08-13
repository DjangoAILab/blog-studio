import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';

import {
  SiteMutationRejectedError,
  StructuredSiteGit,
  type AgentRuntimeEvent,
  type AgentRuntimeHistoryEntry,
  type SiteAgentRuntimeFactory,
  type SiteAgentRuntimeHandle,
  type SiteToolMutationRunner,
  type TrackedFileSnapshot,
} from '@blog-studio/agent-runtime-pi';
import {
  AgentSessionNotFoundError,
  AgentTurnNotFoundError,
  type AgentApprovalMode,
  type AgentAttachmentRecord,
  type AgentEventRecord,
  type AgentSessionRecord,
  type AgentToolAuditRecord,
  type AgentTurnRecord,
  type SqliteAgentPreferenceRepository,
  type SqliteAgentAttachmentRepository,
  type SqliteAgentSessionRepository,
  type SqliteAgentToolAuditRepository,
  type SqliteAgentTurnRepository,
} from '@blog-studio/persistence';

import type { SiteAgentMutationCoordinator } from './site-agent-locks.js';
import {
  materializeAgentMessage,
  SiteAgentContextError,
  type SiteAgentMessageContext,
} from './site-agent-context.js';
import type { SiteService } from './sites.js';
import type { WorkspaceService } from './workspaces.js';
import {
  DisabledSiteAgentVisionAdapter,
  type SiteAgentVisionAdapter,
  SiteAgentVisionError,
} from './site-agent-vision.js';

type EventListener = (event: AgentPublishedEvent) => void;

interface ActiveTurnContext {
  readonly turnId: string;
  readonly siteId: string;
  readonly sessionId: string;
  mode: AgentApprovalMode;
}

interface PendingApproval {
  readonly sessionId: string;
  readonly turnId: string;
  readonly resolve: (decision: 'approved' | 'rejected') => void;
}

export interface AgentPublishedEvent extends AgentEventRecord {
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface AgentSessionDetails {
  readonly session: AgentSessionRecord;
  readonly effectiveApproval: ReturnType<
    SqliteAgentPreferenceRepository['resolve']
  >;
  readonly history: readonly AgentRuntimeHistoryEntry[];
  readonly turns: readonly AgentTurnRecord[];
  readonly approvals: readonly AgentToolAuditRecord[];
  readonly attachments: readonly Omit<AgentAttachmentRecord, 'storageKey'>[];
}

export class SiteAgentServiceError extends Error {
  public constructor(
    message: string,
    readonly code: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'SiteAgentServiceError';
  }
}

export interface SiteAgentSessionServiceOptions {
  readonly sites: SiteService;
  readonly workspaces: WorkspaceService;
  readonly sessions: SqliteAgentSessionRepository;
  readonly preferences: SqliteAgentPreferenceRepository;
  readonly turns: SqliteAgentTurnRepository;
  readonly audit: SqliteAgentToolAuditRepository;
  readonly attachments: SqliteAgentAttachmentRepository;
  readonly runtimeFactory: SiteAgentRuntimeFactory;
  readonly mutations: SiteAgentMutationCoordinator;
  readonly sessionDirectory: string;
  readonly attachmentDirectory: string;
  readonly visionAdapter?: SiteAgentVisionAdapter;
  readonly now?: () => string;
}

function terminal(status: AgentTurnRecord['status']): boolean {
  return ['completed', 'failed', 'canceled', 'interrupted'].includes(status);
}

function isPlaceholderSessionName(name: string): boolean {
  return (
    name === '新会话' ||
    /^站点会话\s+\d+$/.test(name) ||
    name.startsWith('文章 · ')
  );
}

function titleFromFirstMessage(text: string): string {
  const line = text.trim().split('\n', 1)[0] ?? '';
  const cleaned = line.replace(/^[#>*\-\s]+/, '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '新会话';
  return cleaned.length > 24 ? `${cleaned.slice(0, 23)}…` : cleaned;
}

function persistentPayload(
  event: AgentRuntimeEvent,
): Readonly<Record<string, unknown>> {
  if (event.type === 'message-start' || event.type === 'message-end') {
    return {
      ...(typeof event.payload.role === 'string'
        ? { role: event.payload.role }
        : {}),
      ...(typeof event.payload.imageCount === 'number'
        ? { imageCount: event.payload.imageCount }
        : {}),
    };
  }
  if (event.type === 'message-update') return {};
  return event.payload;
}

export class SiteAgentSessionService {
  readonly #sites: SiteService;
  readonly #workspaces: WorkspaceService;
  readonly #sessions: SqliteAgentSessionRepository;
  readonly #preferences: SqliteAgentPreferenceRepository;
  readonly #turns: SqliteAgentTurnRepository;
  readonly #audit: SqliteAgentToolAuditRepository;
  readonly #attachments: SqliteAgentAttachmentRepository;
  readonly #runtimeFactory: SiteAgentRuntimeFactory;
  readonly #mutations: SiteAgentMutationCoordinator;
  readonly #sessionDirectory: string;
  readonly #attachmentDirectory: string;
  readonly #vision: SiteAgentVisionAdapter;
  readonly #now: () => string;
  readonly #runtimes = new Map<string, Promise<SiteAgentRuntimeHandle>>();
  readonly #activeContexts = new Map<string, ActiveTurnContext>();
  readonly #turnTasks = new Map<string, Promise<void>>();
  readonly #pendingApprovals = new Map<string, PendingApproval>();
  readonly #turnSnapshots = new Map<string, Map<string, TrackedFileSnapshot>>();
  readonly #listeners = new Map<string, Set<EventListener>>();

  public constructor(options: SiteAgentSessionServiceOptions) {
    this.#sites = options.sites;
    this.#workspaces = options.workspaces;
    this.#sessions = options.sessions;
    this.#preferences = options.preferences;
    this.#turns = options.turns;
    this.#audit = options.audit;
    this.#attachments = options.attachments;
    this.#runtimeFactory = options.runtimeFactory;
    this.#mutations = options.mutations;
    this.#sessionDirectory = resolve(options.sessionDirectory);
    this.#attachmentDirectory = resolve(options.attachmentDirectory);
    this.#vision =
      options.visionAdapter ?? new DisabledSiteAgentVisionAdapter();
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  public recoverInterrupted(): readonly AgentTurnRecord[] {
    const at = this.#now();
    const recovered = this.#turns.recoverInterrupted(at);
    for (const turn of recovered) {
      this.#audit.interruptTurn(turn.id, at);
      this.#publish(
        this.#turns.appendEvent({
          siteId: turn.siteId,
          sessionId: turn.sessionId,
          turnId: turn.id,
          type: 'turn-interrupted',
          payload: { terminal: true, reason: 'studio-restarted' },
          at,
        }),
      );
    }
    return recovered;
  }

  public list(
    siteId: string,
    includeArchived = false,
  ): readonly AgentSessionRecord[] {
    this.#sites.workspaceId(siteId);
    return this.#sessions.list(siteId, { includeArchived });
  }

  public preferenceDefaults(siteId: string): {
    readonly global: AgentApprovalMode | null;
    readonly site: AgentApprovalMode | null;
  } {
    this.#sites.workspaceId(siteId);
    return {
      global: this.#preferences.global(),
      site: this.#preferences.site(siteId),
    };
  }

  public setGlobalApprovalMode(siteId: string, mode: AgentApprovalMode): void {
    this.#sites.workspaceId(siteId);
    this.#preferences.setGlobal(mode, this.#now());
  }

  public setSiteApprovalMode(
    siteId: string,
    mode: AgentApprovalMode | null,
  ): void {
    this.#sites.workspaceId(siteId);
    if (mode) this.#preferences.setSite(siteId, mode, this.#now());
    else this.#preferences.clearSite(siteId);
  }

  public async create(input: {
    readonly siteId: string;
    readonly displayName: string;
    readonly approvalMode?: AgentApprovalMode;
    readonly documentId?: string;
    readonly collectionId?: string;
  }): Promise<AgentSessionRecord> {
    const displayName = input.displayName.trim();
    if (!displayName || displayName.length > 120) {
      throw new SiteAgentServiceError(
        'Agent Session name must contain 1 to 120 characters',
        'AGENT_SESSION_NAME_INVALID',
        422,
      );
    }
    const workspace = this.#workspace(input.siteId);
    const id = `agent-session-${randomUUID()}`;
    const directory = join(this.#sessionDirectory, input.siteId);
    const runtimePromise = this.#runtimeFactory.create({
      siteRoot: workspace.config.workspace.root,
      sessionDirectory: directory,
      mutationRunner: this.#mutationRunner(id),
      attachmentSource: this.#attachmentSource(input.siteId, id),
      turnReversalSource: this.#turnReversalSource(input.siteId, id),
    });
    this.#runtimes.set(id, runtimePromise);
    try {
      const runtime = await runtimePromise;
      const transcriptKey = this.#dataKey(runtime.transcriptPath);
      const at = this.#now();
      return this.#sessions.create({
        id,
        siteId: input.siteId,
        piSessionId: runtime.piSessionId,
        transcriptKey,
        displayName,
        ...(input.approvalMode ? { approvalMode: input.approvalMode } : {}),
        ...(input.documentId && input.collectionId
          ? {
              documentId: input.documentId,
              collectionId: input.collectionId,
            }
          : {}),
        createdAt: at,
        updatedAt: at,
      });
    } catch (error) {
      this.#runtimes.delete(id);
      throw error;
    }
  }

  public rename(
    siteId: string,
    sessionId: string,
    displayName: string,
  ): AgentSessionRecord {
    this.#requireSession(siteId, sessionId);
    const value = displayName.trim();
    if (!value || value.length > 120) {
      throw new SiteAgentServiceError(
        'Agent Session name must contain 1 to 120 characters',
        'AGENT_SESSION_NAME_INVALID',
        422,
      );
    }
    return this.#sessions.rename(sessionId, value, this.#now());
  }

  public setSessionApprovalMode(
    siteId: string,
    sessionId: string,
    mode: AgentApprovalMode | null,
  ): AgentSessionRecord {
    this.#requireSession(siteId, sessionId);
    const at = this.#now();
    if (mode) this.#preferences.setSession(siteId, sessionId, mode, at);
    else this.#preferences.clearSession(siteId, sessionId, at);
    const live = this.#preferences.resolve(siteId, sessionId).mode;
    const context = this.#activeContexts.get(sessionId);
    if (context) context.mode = live;
    if (live === 'yolo') {
      for (const [toolCallId, pending] of this.#pendingApprovals) {
        if (pending.sessionId !== sessionId) continue;
        this.#pendingApprovals.delete(toolCallId);
        pending.resolve('approved');
      }
    }
    return this.#requireSession(siteId, sessionId);
  }

  public archive(siteId: string, sessionId: string): AgentSessionRecord {
    this.#requireSession(siteId, sessionId);
    if (this.#turns.active(sessionId)) {
      throw new SiteAgentServiceError(
        'An active Agent Session cannot be archived',
        'AGENT_SESSION_BUSY',
        409,
      );
    }
    void this.#disposeRuntime(sessionId);
    return this.#sessions.archive(sessionId, this.#now());
  }

  public restore(siteId: string, sessionId: string): AgentSessionRecord {
    this.#requireSession(siteId, sessionId);
    return this.#sessions.restore(sessionId, this.#now());
  }

  public async details(
    siteId: string,
    sessionId: string,
  ): Promise<AgentSessionDetails> {
    const session = this.#requireSession(siteId, sessionId);
    const runtime = await this.#runtime(session);
    return {
      session,
      effectiveApproval: this.#preferences.resolve(siteId, sessionId),
      history: runtime.history(),
      turns: this.#turns.list(sessionId),
      approvals: this.#audit.list(sessionId),
      attachments: this.#attachments
        .list(sessionId)
        .map(({ storageKey: _storageKey, ...attachment }) => {
          void _storageKey;
          return attachment;
        }),
    };
  }

  public async uploadAttachment(input: {
    readonly siteId: string;
    readonly sessionId: string;
    readonly filename: string;
    readonly claimedMimeType: string;
    readonly bytes: Buffer;
  }): Promise<AgentAttachmentRecord> {
    this.#requireSession(input.siteId, input.sessionId);
    if (input.bytes.length === 0 || input.bytes.length > 10 * 1024 * 1024) {
      throw new SiteAgentServiceError(
        'Agent attachments must contain 1 byte to 10 MiB',
        'AGENT_ATTACHMENT_SIZE_INVALID',
        413,
      );
    }
    const filename = this.#safeFilename(input.filename);
    const sniffed = this.#sniffMimeType(input.bytes);
    const claimed = input.claimedMimeType.split(';')[0]?.trim().toLowerCase();
    const mimeType =
      sniffed ??
      (claimed && claimed !== 'application/octet-stream'
        ? claimed
        : 'application/octet-stream');
    const id = `agent-attachment-${randomUUID()}`;
    const storageKey = join(input.siteId, input.sessionId, id);
    const path = this.#attachmentPath(storageKey);
    await mkdir(resolve(path, '..'), { recursive: true });
    await writeFile(path, input.bytes, { flag: 'wx', mode: 0o600 });
    const at = this.#now();
    try {
      return this.#attachments.create({
        id,
        sessionId: input.sessionId,
        filename,
        mimeType,
        byteSize: input.bytes.length,
        sha256: createHash('sha256').update(input.bytes).digest('hex'),
        storageKey,
        createdAt: at,
        updatedAt: at,
      });
    } catch (error) {
      await unlink(path).catch(() => undefined);
      throw error;
    }
  }

  public async attachmentBytes(
    siteId: string,
    sessionId: string,
    attachmentId: string,
  ): Promise<{
    readonly attachment: AgentAttachmentRecord;
    readonly bytes: Buffer;
  }> {
    this.#requireSession(siteId, sessionId);
    const attachment = this.#requireAttachment(sessionId, attachmentId);
    return {
      attachment,
      bytes: await readFile(this.#attachmentPath(attachment.storageKey)),
    };
  }

  public async retryVision(input: {
    readonly siteId: string;
    readonly sessionId: string;
    readonly attachmentId: string;
  }): Promise<AgentAttachmentRecord> {
    const session = this.#requireSession(input.siteId, input.sessionId);
    const attachment = this.#requireAttachment(
      input.sessionId,
      input.attachmentId,
    );
    if (!attachment.mimeType.startsWith('image/')) {
      throw new SiteAgentServiceError(
        'Only image attachments have a vision interpretation',
        'AGENT_VISION_MEDIA_UNSUPPORTED',
        415,
      );
    }
    this.#attachments.setVisionState({
      id: attachment.id,
      status: 'processing',
      updatedAt: this.#now(),
    });
    try {
      const result = await this.#vision.interpret({
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        bytes: await readFile(this.#attachmentPath(attachment.storageKey)),
      });
      const runtime = await this.#runtime(session);
      runtime.appendContext(
        `[Vision retry for attachment ${attachment.id} (${attachment.filename}) via ${result.model}]\n${result.text}`,
      );
      return this.#attachments.setVisionState({
        id: attachment.id,
        status: 'ready',
        visionModel: result.model,
        updatedAt: this.#now(),
      });
    } catch (error) {
      this.#attachments.setVisionState({
        id: attachment.id,
        status: 'failed',
        updatedAt: this.#now(),
      });
      if (error instanceof SiteAgentVisionError) {
        throw new SiteAgentServiceError(error.message, error.code, 409);
      }
      throw error;
    }
  }

  public submitMessage(input: {
    readonly siteId: string;
    readonly sessionId: string;
    readonly text: string;
    readonly contexts?: readonly SiteAgentMessageContext[];
    readonly attachmentIds?: readonly string[];
  }): AgentTurnRecord {
    const session = this.#requireSession(input.siteId, input.sessionId);
    if (session.state !== 'active') {
      throw new SiteAgentServiceError(
        'Archived Agent Sessions must be restored before sending a message',
        'AGENT_SESSION_ARCHIVED',
        409,
      );
    }
    let text: string;
    try {
      text = materializeAgentMessage({
        text: input.text,
        ...(input.contexts ? { contexts: input.contexts } : {}),
      });
    } catch (error) {
      if (error instanceof SiteAgentContextError) {
        throw new SiteAgentServiceError(error.message, error.code, 422);
      }
      throw error;
    }
    if (this.#turns.active(input.sessionId)) {
      throw new SiteAgentServiceError(
        'Agent Session already has an active turn',
        'AGENT_SESSION_BUSY',
        409,
      );
    }
    const contextAttachmentIds = (input.contexts ?? []).flatMap((context) =>
      context.type === 'attachment' || context.type === 'image'
        ? [context.attachmentId]
        : [],
    );
    const attachmentIds = [
      ...new Set([...(input.attachmentIds ?? []), ...contextAttachmentIds]),
    ];
    if (attachmentIds.length > 8) {
      throw new SiteAgentServiceError(
        'An Agent message can contain at most 8 attachments',
        'AGENT_ATTACHMENT_LIMIT',
        422,
      );
    }
    for (const id of attachmentIds) {
      const attachment = this.#requireAttachment(input.sessionId, id);
      const imageReference = input.contexts?.find(
        (context) =>
          context.type === 'image' && context.attachmentId === attachment.id,
      );
      if (imageReference && !attachment.mimeType.startsWith('image/')) {
        throw new SiteAgentServiceError(
          'An Agent image reference must point to an image attachment',
          'AGENT_IMAGE_REFERENCE_INVALID',
          422,
        );
      }
      if (attachment.messageEntryId) {
        throw new SiteAgentServiceError(
          'An Agent attachment is already bound to a message',
          'AGENT_ATTACHMENT_ALREADY_USED',
          409,
        );
      }
    }
    const at = this.#now();
    if (isPlaceholderSessionName(session.displayName)) {
      this.#sessions.rename(
        session.id,
        titleFromFirstMessage(input.text),
        at,
      );
    }
    const mode = this.#preferences.resolve(input.siteId, input.sessionId).mode;
    const turn = this.#turns.create({
      id: `agent-turn-${randomUUID()}`,
      siteId: input.siteId,
      sessionId: input.sessionId,
      approvalMode: mode,
      at,
    });
    this.#emit(turn, 'turn-queued', { approvalMode: mode }, at);
    const task = Promise.resolve()
      .then(() => this.#runTurn(turn, text, attachmentIds))
      .finally(() => this.#turnTasks.delete(turn.id));
    this.#turnTasks.set(turn.id, task);
    return turn;
  }

  public async cancel(
    siteId: string,
    sessionId: string,
    turnId: string,
  ): Promise<AgentTurnRecord> {
    this.#requireSession(siteId, sessionId);
    const turn = this.#requireTurn(sessionId, turnId);
    if (terminal(turn.status)) return turn;
    const at = this.#now();
    this.#turns.requestCancel(turnId, at);
    this.#emit(turn, 'cancel-requested', {}, at);
    for (const [toolCallId, pending] of this.#pendingApprovals) {
      if (pending.turnId === turnId) {
        this.#audit.update({
          sessionId,
          toolCallId,
          approvalDecision: 'rejected',
          status: 'canceled',
          updatedAt: at,
          decisionAt: at,
        });
        this.#pendingApprovals.delete(toolCallId);
        pending.resolve('rejected');
      }
    }
    const runtime = await this.#runtimes.get(sessionId)?.catch(() => undefined);
    if (runtime?.running) await runtime.cancel();
    await this.#turnTasks.get(turnId);
    return this.#turns.get(turnId) ?? turn;
  }

  public decideApproval(input: {
    readonly siteId: string;
    readonly sessionId: string;
    readonly turnId: string;
    readonly toolCallId: string;
    readonly decision: 'approved' | 'rejected';
  }): AgentToolAuditRecord {
    this.#requireSession(input.siteId, input.sessionId);
    this.#requireTurn(input.sessionId, input.turnId);
    const pending = this.#pendingApprovals.get(input.toolCallId);
    if (
      !pending ||
      pending.sessionId !== input.sessionId ||
      pending.turnId !== input.turnId
    ) {
      throw new SiteAgentServiceError(
        'Agent approval is not pending in this Studio process',
        'AGENT_APPROVAL_NOT_PENDING',
        409,
      );
    }
    const at = this.#now();
    const decided = this.#audit.decide({
      sessionId: input.sessionId,
      toolCallId: input.toolCallId,
      decision: input.decision,
      at,
    });
    this.#emit(
      this.#requireTurn(input.sessionId, input.turnId),
      `approval-${input.decision}`,
      { toolCallId: input.toolCallId },
      at,
    );
    this.#pendingApprovals.delete(input.toolCallId);
    pending.resolve(input.decision);
    return decided;
  }

  public events(
    siteId: string,
    sessionId: string,
    afterSequence = 0,
  ): readonly AgentEventRecord[] {
    this.#requireSession(siteId, sessionId);
    return this.#turns.events({ sessionId, afterSequence });
  }

  public activeTurn(siteId: string, sessionId: string): AgentTurnRecord | null {
    this.#requireSession(siteId, sessionId);
    return this.#turns.active(sessionId);
  }

  public subscribe(sessionId: string, listener: EventListener): () => void {
    const listeners =
      this.#listeners.get(sessionId) ?? new Set<EventListener>();
    listeners.add(listener);
    this.#listeners.set(sessionId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.#listeners.delete(sessionId);
    };
  }

  public async dispose(): Promise<void> {
    for (const pending of this.#pendingApprovals.values()) {
      pending.resolve('rejected');
    }
    this.#pendingApprovals.clear();
    const runtimes = await Promise.allSettled(this.#runtimes.values());
    await Promise.allSettled(
      runtimes.flatMap((runtime) =>
        runtime.status === 'fulfilled' && runtime.value.running
          ? [runtime.value.cancel()]
          : [],
      ),
    );
    await Promise.allSettled(this.#turnTasks.values());
    for (const runtime of runtimes) {
      if (runtime.status === 'fulfilled') runtime.value.dispose();
    }
    this.#runtimes.clear();
    this.#listeners.clear();
  }

  async #runTurn(
    turn: AgentTurnRecord,
    text: string,
    attachmentIds: readonly string[],
  ): Promise<void> {
    let unsubscribe = () => {};
    try {
      const beforeStart = this.#turns.get(turn.id);
      if (beforeStart?.cancelRequestedAt) {
        this.#finish(turn, 'canceled', 'turn-canceled');
        return;
      }
      const running = this.#turns.transition({
        id: turn.id,
        status: 'running',
        at: this.#now(),
      });
      this.#activeContexts.set(turn.sessionId, {
        turnId: turn.id,
        siteId: turn.siteId,
        sessionId: turn.sessionId,
        mode: turn.approvalMode,
      });
      this.#emit(running, 'turn-running');
      const runtime = await this.#runtime(
        this.#requireSession(turn.siteId, turn.sessionId),
      );
      const beforeEntryIds = new Set(
        runtime.history().map((entry) => entry.id),
      );
      const attachmentNotes = await this.#prepareAttachmentNotes(
        turn.sessionId,
        attachmentIds,
      );
      const prompt = materializeAgentMessage({
        text,
        ...(attachmentNotes.length > 0 ? { attachmentNotes } : {}),
      });
      unsubscribe = runtime.subscribe((event) => {
        const stored = this.#turns.appendEvent({
          siteId: turn.siteId,
          sessionId: turn.sessionId,
          turnId: turn.id,
          type: event.type,
          payload: persistentPayload(event),
          at: this.#now(),
        });
        this.#publish({ ...stored, payload: event.payload });
      });
      await runtime.prompt(prompt);
      const messageEntryId = runtime
        .history()
        .find(
          (entry) => entry.role === 'user' && !beforeEntryIds.has(entry.id),
        )?.id;
      if (messageEntryId) {
        for (const attachmentId of attachmentIds) {
          this.#attachments.bindToMessage(
            attachmentId,
            messageEntryId,
            this.#now(),
          );
        }
      }
      const latest = this.#turns.get(turn.id);
      if (latest?.cancelRequestedAt) {
        this.#finish(turn, 'canceled', 'turn-canceled');
      } else {
        this.#finish(turn, 'completed', 'turn-completed');
      }
    } catch (error) {
      const latest = this.#turns.get(turn.id);
      if (latest && !terminal(latest.status)) {
        if (latest.cancelRequestedAt) {
          this.#finish(turn, 'canceled', 'turn-canceled');
        } else {
          this.#finish(
            turn,
            'failed',
            'turn-failed',
            error instanceof Error ? error.name : 'AGENT_RUNTIME_ERROR',
          );
        }
      }
    } finally {
      unsubscribe();
      this.#activeContexts.delete(turn.sessionId);
      this.#turnSnapshots.delete(turn.id);
    }
  }

  #finish(
    turn: AgentTurnRecord,
    status: 'completed' | 'failed' | 'canceled',
    eventType: string,
    errorCode?: string,
  ): AgentTurnRecord {
    const at = this.#now();
    const finished = this.#turns.transition({
      id: turn.id,
      status,
      at,
      ...(errorCode ? { errorCode } : {}),
    });
    this.#emit(
      finished,
      eventType,
      { terminal: true, ...(errorCode ? { errorCode } : {}) },
      at,
    );
    return finished;
  }

  #mutationRunner(sessionId: string): SiteToolMutationRunner {
    return async (mutation) => {
      const context = this.#activeContexts.get(sessionId);
      if (!context) {
        throw new SiteAgentServiceError(
          'Agent mutation has no active turn context',
          'AGENT_MUTATION_CONTEXT_MISSING',
          409,
        );
      }
      let audit: AgentToolAuditRecord | undefined;
      const policy = this.#mutations.policy(async () => {
        const at = this.#now();
        audit = this.#audit.create({
          siteId: context.siteId,
          sessionId,
          turnId: context.turnId,
          toolCallId: mutation.toolCallId,
          toolName: mutation.toolName,
          mutation: true,
          approvalDecision: 'pending',
          status: 'requested',
          paths: mutation.paths,
          requestedAt: at,
          updatedAt: at,
        });
        const waiting = this.#turns.transition({
          id: context.turnId,
          status: 'waiting-approval',
          at,
        });
        this.#emit(waiting, 'approval-required', {
          toolCallId: mutation.toolCallId,
          toolName: mutation.toolName,
          paths: mutation.paths,
        });
        const decision = await new Promise<'approved' | 'rejected'>(
          (resolve) => {
            this.#pendingApprovals.set(mutation.toolCallId, {
              sessionId,
              turnId: context.turnId,
              resolve,
            });
          },
        );
        const current = this.#turns.get(context.turnId);
        if (current?.status === 'waiting-approval') {
          const running = this.#turns.transition({
            id: context.turnId,
            status: 'running',
            at: this.#now(),
          });
          this.#emit(running, 'turn-running');
        }
        if (decision === 'rejected') {
          const currentAudit = this.#audit.get(sessionId, mutation.toolCallId);
          if (currentAudit?.status === 'requested') {
            audit = this.#audit.update({
              sessionId,
              toolCallId: mutation.toolCallId,
              approvalDecision: 'rejected',
              status: 'canceled',
              updatedAt: this.#now(),
              decisionAt: currentAudit.decisionAt ?? this.#now(),
            });
          }
        }
        return decision;
      });

      try {
        return await policy.run(
          {
            siteId: context.siteId,
            sessionId,
            turnId: context.turnId,
            toolCallId: mutation.toolCallId,
            toolName: mutation.toolName,
            paths: mutation.paths,
            mode: this.#preferences.resolve(context.siteId, sessionId).mode,
          },
          async () => {
            const at = this.#now();
            if (
              this.#preferences.resolve(context.siteId, sessionId).mode ===
              'yolo'
            ) {
              audit = this.#audit.create({
                siteId: context.siteId,
                sessionId,
                turnId: context.turnId,
                toolCallId: mutation.toolCallId,
                toolName: mutation.toolName,
                mutation: true,
                approvalDecision: 'auto-approved',
                status: 'running',
                paths: mutation.paths,
                requestedAt: at,
                updatedAt: at,
              });
            } else {
              audit = this.#audit.update({
                sessionId,
                toolCallId: mutation.toolCallId,
                approvalDecision: 'approved',
                status: 'running',
                updatedAt: at,
              });
            }
            this.#emit(
              this.#requireTurn(sessionId, context.turnId),
              'tool-running',
              {
                toolCallId: mutation.toolCallId,
                toolName: mutation.toolName,
              },
            );
            const reversible = await this.#captureMutationSnapshot(
              context,
              mutation.toolName,
              mutation.paths,
            );
            const result = await mutation.operation();
            if (reversible) {
              const workspace = this.#workspace(context.siteId);
              const sealed = await new StructuredSiteGit(
                workspace.config.workspace.root,
              ).sealTrackedFile(reversible);
              const snapshots =
                this.#turnSnapshots.get(context.turnId) ??
                new Map<string, TrackedFileSnapshot>();
              snapshots.set(sealed.path, sealed);
              this.#turnSnapshots.set(context.turnId, snapshots);
            }
            audit = this.#audit.update({
              sessionId,
              toolCallId: mutation.toolCallId,
              approvalDecision: audit.approvalDecision,
              status: 'succeeded',
              updatedAt: this.#now(),
            });
            this.#emit(
              this.#requireTurn(sessionId, context.turnId),
              'tool-succeeded',
              {
                toolCallId: mutation.toolCallId,
                toolName: mutation.toolName,
                paths: mutation.paths,
              },
            );
            this.#emit(
              this.#requireTurn(sessionId, context.turnId),
              'workspace-changed',
              { paths: mutation.paths },
            );
            return result;
          },
        );
      } catch (error) {
        if (!(error instanceof SiteMutationRejectedError) && audit) {
          this.#audit.update({
            sessionId,
            toolCallId: mutation.toolCallId,
            approvalDecision: audit.approvalDecision,
            status: 'failed',
            updatedAt: this.#now(),
          });
        }
        throw error;
      }
    };
  }

  async #runtime(session: AgentSessionRecord): Promise<SiteAgentRuntimeHandle> {
    const existing = this.#runtimes.get(session.id);
    if (existing) return await existing;
    const workspace = this.#workspace(session.siteId);
    const directory = join(this.#sessionDirectory, session.siteId);
    const runtimePromise = this.#runtimeFactory.resume({
      siteRoot: workspace.config.workspace.root,
      sessionDirectory: directory,
      transcriptPath: this.#dataPath(session.transcriptKey),
      expectedPiSessionId: session.piSessionId,
      mutationRunner: this.#mutationRunner(session.id),
      attachmentSource: this.#attachmentSource(session.siteId, session.id),
      turnReversalSource: this.#turnReversalSource(session.siteId, session.id),
    });
    this.#runtimes.set(session.id, runtimePromise);
    try {
      return await runtimePromise;
    } catch (error) {
      this.#runtimes.delete(session.id);
      throw new SiteAgentServiceError(
        error instanceof Error ? error.message : 'Agent Session is unavailable',
        'AGENT_TRANSCRIPT_UNAVAILABLE',
        409,
      );
    }
  }

  async #disposeRuntime(sessionId: string): Promise<void> {
    const runtime = await this.#runtimes.get(sessionId)?.catch(() => undefined);
    runtime?.dispose();
    this.#runtimes.delete(sessionId);
  }

  #attachmentSource(siteId: string, sessionId: string) {
    return {
      load: async (attachmentId: string) => {
        const { attachment, bytes } = await this.attachmentBytes(
          siteId,
          sessionId,
          attachmentId,
        );
        return { filename: attachment.filename, bytes };
      },
    };
  }

  #turnReversalSource(siteId: string, sessionId: string) {
    return {
      restore: async (path: string) => {
        const context = this.#activeContexts.get(sessionId);
        if (!context || context.siteId !== siteId) {
          throw new SiteAgentServiceError(
            'Agent reversal has no active turn context',
            'AGENT_REVERSAL_CONTEXT_MISSING',
            409,
          );
        }
        const snapshots = this.#turnSnapshots.get(context.turnId);
        const snapshot = snapshots?.get(path);
        if (!snapshot) {
          throw new SiteAgentServiceError(
            'No tracked change for this path is attributable to the current Agent turn',
            'AGENT_REVERSAL_NOT_ATTRIBUTABLE',
            409,
          );
        }
        const workspace = this.#workspace(siteId);
        await new StructuredSiteGit(
          workspace.config.workspace.root,
        ).restoreAgentSnapshot(snapshot);
        snapshots?.delete(path);
      },
    };
  }

  async #captureMutationSnapshot(
    context: ActiveTurnContext,
    toolName: Parameters<SiteToolMutationRunner>[0]['toolName'],
    paths: readonly string[],
  ): Promise<TrackedFileSnapshot | null> {
    if (
      toolName === 'git_revert_agent_path' ||
      paths.length !== 1 ||
      !['write', 'edit', 'delete_path', 'git_restore_path'].includes(toolName)
    ) {
      return null;
    }
    const existing = this.#turnSnapshots.get(context.turnId)?.get(paths[0]!);
    if (existing) return existing;
    const workspace = this.#workspace(context.siteId);
    return await new StructuredSiteGit(
      workspace.config.workspace.root,
    ).captureTrackedFile(paths[0]!);
  }

  #workspace(siteId: string) {
    const workspaceId = this.#sites.workspaceId(siteId);
    return this.#workspaces.get(workspaceId);
  }

  #requireSession(siteId: string, sessionId: string): AgentSessionRecord {
    this.#sites.workspaceId(siteId);
    const session = this.#sessions.get(sessionId);
    if (!session || session.siteId !== siteId) {
      throw new AgentSessionNotFoundError(sessionId);
    }
    return session;
  }

  #requireTurn(sessionId: string, turnId: string): AgentTurnRecord {
    const turn = this.#turns.get(turnId);
    if (!turn || turn.sessionId !== sessionId)
      throw new AgentTurnNotFoundError(turnId);
    return turn;
  }

  #requireAttachment(
    sessionId: string,
    attachmentId: string,
  ): AgentAttachmentRecord {
    const attachment = this.#attachments.get(attachmentId);
    if (!attachment || attachment.sessionId !== sessionId) {
      throw new SiteAgentServiceError(
        'Agent attachment was not found for this Session',
        'AGENT_ATTACHMENT_NOT_FOUND',
        404,
      );
    }
    return attachment;
  }

  async #prepareAttachmentNotes(
    sessionId: string,
    attachmentIds: readonly string[],
  ): Promise<readonly string[]> {
    const notes: string[] = [];
    for (const attachmentId of attachmentIds) {
      const attachment = this.#requireAttachment(sessionId, attachmentId);
      const identity = `Attachment ${attachment.id}: ${attachment.filename} (${attachment.mimeType}, ${attachment.byteSize} bytes, sha256 ${attachment.sha256})`;
      if (!attachment.mimeType.startsWith('image/')) {
        this.#attachments.setVisionState({
          id: attachment.id,
          status: 'ready',
          updatedAt: this.#now(),
        });
        notes.push(identity);
        continue;
      }
      this.#attachments.setVisionState({
        id: attachment.id,
        status: 'processing',
        updatedAt: this.#now(),
      });
      try {
        const result = await this.#vision.interpret({
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          bytes: await readFile(this.#attachmentPath(attachment.storageKey)),
        });
        this.#attachments.setVisionState({
          id: attachment.id,
          status: 'ready',
          visionModel: result.model,
          updatedAt: this.#now(),
        });
        notes.push(
          `${identity}\nVision model: ${result.model}\n${result.text}`,
        );
      } catch (error) {
        this.#attachments.setVisionState({
          id: attachment.id,
          status: 'failed',
          updatedAt: this.#now(),
        });
        notes.push(
          `${identity}\nVision interpretation failed: ${error instanceof Error ? error.message : 'unknown error'}. The original image is retained and can be retried.`,
        );
      }
    }
    return notes;
  }

  #safeFilename(value: string): string {
    const normalized = value.normalize('NFKC').trim();
    if (
      !normalized ||
      normalized.length > 180 ||
      basename(normalized) !== normalized ||
      normalized === '.' ||
      normalized === '..'
    ) {
      throw new SiteAgentServiceError(
        'Agent attachment filename is invalid',
        'AGENT_ATTACHMENT_FILENAME_INVALID',
        422,
      );
    }
    return [...normalized]
      .map((character) => {
        const code = character.charCodeAt(0);
        return code <= 31 || code === 127 ? '_' : character;
      })
      .join('');
  }

  #sniffMimeType(bytes: Buffer): string | undefined {
    if (bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')))
      return 'image/png';
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
      return 'image/jpeg';
    if (
      bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
      bytes.subarray(8, 12).toString('ascii') === 'WEBP'
    )
      return 'image/webp';
    if (bytes.subarray(0, 5).toString('ascii') === '%PDF-')
      return 'application/pdf';
    if (bytes.subarray(0, 4).equals(Buffer.from('504b0304', 'hex')))
      return 'application/zip';
    if (!bytes.includes(0)) return 'text/plain';
    return undefined;
  }

  #attachmentPath(storageKey: string): string {
    const path = resolve(this.#attachmentDirectory, storageKey);
    const fromRoot = relative(this.#attachmentDirectory, path);
    if (!fromRoot || fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
      throw new SiteAgentServiceError(
        'Stored Agent attachment path is invalid',
        'AGENT_ATTACHMENT_PATH_INVALID',
        500,
      );
    }
    return path;
  }

  #dataKey(path: string): string {
    const key = relative(this.#sessionDirectory, resolve(path));
    if (!key || key.startsWith('..') || isAbsolute(key)) {
      throw new SiteAgentServiceError(
        'Agent runtime returned a transcript outside application storage',
        'AGENT_TRANSCRIPT_PATH_INVALID',
        500,
      );
    }
    return key;
  }

  #dataPath(key: string): string {
    if (!key || isAbsolute(key)) {
      throw new SiteAgentServiceError(
        'Stored Agent transcript path is invalid',
        'AGENT_TRANSCRIPT_PATH_INVALID',
        409,
      );
    }
    const path = resolve(this.#sessionDirectory, key);
    const fromRoot = relative(this.#sessionDirectory, path);
    if (!fromRoot || fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
      throw new SiteAgentServiceError(
        'Stored Agent transcript path is invalid',
        'AGENT_TRANSCRIPT_PATH_INVALID',
        409,
      );
    }
    return path;
  }

  #emit(
    turn: AgentTurnRecord,
    type: string,
    payload: Readonly<Record<string, unknown>> = {},
    at = this.#now(),
  ): AgentEventRecord {
    const event = this.#turns.appendEvent({
      siteId: turn.siteId,
      sessionId: turn.sessionId,
      turnId: turn.id,
      type,
      payload,
      at,
    });
    this.#publish(event);
    return event;
  }

  #publish(event: AgentPublishedEvent): void {
    for (const listener of this.#listeners.get(event.sessionId) ?? []) {
      listener(event);
    }
  }
}
