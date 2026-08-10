import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  SessionManager,
  type AgentSession,
  type AgentSessionEvent,
  type CreateAgentSessionOptions,
} from '@earendil-works/pi-coding-agent';

import type { SiteToolMutationRunner } from './mutation-runner.js';
import type { SiteAgentAttachmentSource } from './attachment-tool.js';
import type { AgentTurnReversalSource } from './turn-reversal-tool.js';
import { createSiteAgentSession } from './runtime.js';
import { validatePiTranscript } from './transcript.js';

export interface AgentRuntimeEvent {
  readonly type:
    | 'started'
    | 'message-start'
    | 'message-update'
    | 'message-end'
    | 'tool-start'
    | 'tool-end'
    | 'settled';
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface AgentRuntimeHistoryEntry {
  readonly id: string;
  readonly kind: 'message' | 'context';
  readonly role: string;
  readonly text?: string;
  readonly imageCount?: number;
  readonly timestamp?: number;
}

export interface SiteAgentRuntimeHandle {
  readonly piSessionId: string;
  readonly transcriptPath: string;
  readonly running: boolean;
  history(): readonly AgentRuntimeHistoryEntry[];
  appendContext(text: string): string;
  subscribe(listener: (event: AgentRuntimeEvent) => void): () => void;
  prompt(text: string): Promise<void>;
  cancel(): Promise<void>;
  dispose(): void;
}

export interface SiteAgentRuntimeFactoryInput {
  readonly siteRoot: string;
  readonly sessionDirectory: string;
  readonly transcriptPath?: string;
  readonly expectedPiSessionId?: string;
  readonly mutationRunner: SiteToolMutationRunner;
  readonly attachmentSource?: SiteAgentAttachmentSource;
  readonly turnReversalSource?: AgentTurnReversalSource;
}

export interface SiteAgentRuntimeFactory {
  create(input: SiteAgentRuntimeFactoryInput): Promise<SiteAgentRuntimeHandle>;
  resume(input: SiteAgentRuntimeFactoryInput): Promise<SiteAgentRuntimeHandle>;
}

function messageSummary(value: unknown): {
  readonly role: string;
  readonly text?: string;
  readonly imageCount?: number;
  readonly timestamp?: number;
} {
  if (value === null || typeof value !== 'object') return { role: 'unknown' };
  const message = value as {
    readonly role?: unknown;
    readonly content?: unknown;
    readonly timestamp?: unknown;
  };
  const role = typeof message.role === 'string' ? message.role : 'unknown';
  const content = message.content;
  let text: string | undefined;
  let imageCount = 0;
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content)) {
    text = content
      .filter(
        (item): item is { readonly type: 'text'; readonly text: string } =>
          item !== null &&
          typeof item === 'object' &&
          (item as { readonly type?: unknown }).type === 'text' &&
          typeof (item as { readonly text?: unknown }).text === 'string',
      )
      .map((item) => item.text)
      .join('');
    imageCount = content.filter(
      (item) =>
        item !== null &&
        typeof item === 'object' &&
        (item as { readonly type?: unknown }).type === 'image',
    ).length;
  }
  return {
    role,
    ...(text ? { text } : {}),
    ...(imageCount ? { imageCount } : {}),
    ...(typeof message.timestamp === 'number'
      ? { timestamp: message.timestamp }
      : {}),
  };
}

function normalizeEvent(event: AgentSessionEvent): AgentRuntimeEvent | null {
  if (event.type === 'agent_start') return { type: 'started', payload: {} };
  if (event.type === 'agent_settled') return { type: 'settled', payload: {} };
  if (
    event.type === 'message_start' ||
    event.type === 'message_update' ||
    event.type === 'message_end'
  ) {
    const summary = messageSummary(event.message);
    return {
      type:
        event.type === 'message_start'
          ? 'message-start'
          : event.type === 'message_update'
            ? 'message-update'
            : 'message-end',
      payload: summary,
    };
  }
  if (event.type === 'tool_execution_start') {
    return {
      type: 'tool-start',
      payload: { toolCallId: event.toolCallId, toolName: event.toolName },
    };
  }
  if (event.type === 'tool_execution_end') {
    return {
      type: 'tool-end',
      payload: {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        failed: event.isError,
      },
    };
  }
  return null;
}

class PiSiteAgentRuntimeHandle implements SiteAgentRuntimeHandle {
  public constructor(
    private readonly session: AgentSession,
    readonly transcriptPath: string,
  ) {}

  public get piSessionId(): string {
    return this.session.sessionId;
  }

  public get running(): boolean {
    return !this.session.isIdle;
  }

  public history(): readonly AgentRuntimeHistoryEntry[] {
    return this.session.sessionManager
      .getEntries()
      .flatMap<AgentRuntimeHistoryEntry>((entry) => {
        if (entry.type === 'message') {
          return [
            {
              id: entry.id,
              kind: 'message' as const,
              ...messageSummary(entry.message),
            },
          ];
        }
        if (entry.type === 'custom_message') {
          const summary = messageSummary({
            role: 'context',
            content: entry.content,
          });
          return [
            {
              id: entry.id,
              kind: 'context' as const,
              ...summary,
            },
          ];
        }
        return [];
      });
  }

  public subscribe(listener: (event: AgentRuntimeEvent) => void): () => void {
    return this.session.subscribe((event) => {
      const normalized = normalizeEvent(event);
      if (normalized) listener(normalized);
    });
  }

  public appendContext(text: string): string {
    return this.session.sessionManager.appendCustomMessageEntry(
      'blog-studio-context',
      text,
      true,
    );
  }

  public async prompt(text: string): Promise<void> {
    await this.session.prompt(text, { source: 'rpc' });
  }

  public async cancel(): Promise<void> {
    await this.session.abort();
  }

  public dispose(): void {
    this.session.dispose();
  }
}

export interface PiSiteAgentRuntimeFactoryOptions {
  readonly agentDir: string;
  readonly modelRuntime?: CreateAgentSessionOptions['modelRuntime'];
  readonly model?: CreateAgentSessionOptions['model'];
}

export class PiSiteAgentRuntimeFactory implements SiteAgentRuntimeFactory {
  public constructor(
    private readonly options: PiSiteAgentRuntimeFactoryOptions,
  ) {}

  public async create(
    input: SiteAgentRuntimeFactoryInput,
  ): Promise<SiteAgentRuntimeHandle> {
    await mkdir(input.sessionDirectory, { recursive: true });
    const transcriptPath = join(
      input.sessionDirectory,
      `session-${randomUUID()}.jsonl`,
    );
    await writeFile(transcriptPath, '', { flag: 'wx', mode: 0o600 });
    const manager = SessionManager.open(
      transcriptPath,
      input.sessionDirectory,
      input.siteRoot,
    );
    return await this.#open(input, manager, transcriptPath);
  }

  public async resume(
    input: SiteAgentRuntimeFactoryInput,
  ): Promise<SiteAgentRuntimeHandle> {
    if (!input.transcriptPath || !input.expectedPiSessionId) {
      throw new Error('Resume requires transcriptPath and expectedPiSessionId');
    }
    const identity = await validatePiTranscript(input.transcriptPath);
    if (identity.sessionId !== input.expectedPiSessionId) {
      throw new Error('Pi transcript identity does not match Session metadata');
    }
    const manager = SessionManager.open(
      input.transcriptPath,
      input.sessionDirectory,
      input.siteRoot,
    );
    return await this.#open(input, manager, input.transcriptPath);
  }

  async #open(
    input: SiteAgentRuntimeFactoryInput,
    manager: SessionManager,
    transcriptPath: string,
  ): Promise<SiteAgentRuntimeHandle> {
    const { session } = await createSiteAgentSession({
      siteRoot: input.siteRoot,
      agentDir: this.options.agentDir,
      sessionManager: manager,
      mutationRunner: input.mutationRunner,
      ...(input.attachmentSource
        ? { attachmentSource: input.attachmentSource }
        : {}),
      ...(input.turnReversalSource
        ? { turnReversalSource: input.turnReversalSource }
        : {}),
      ...(this.options.modelRuntime
        ? { modelRuntime: this.options.modelRuntime }
        : {}),
      ...(this.options.model ? { model: this.options.model } : {}),
    });
    return new PiSiteAgentRuntimeHandle(session, transcriptPath);
  }
}
