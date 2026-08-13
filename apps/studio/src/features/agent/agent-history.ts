import type {
  AgentAttachmentSummary,
  AgentHistoryEntry,
} from '../../app/api.js';

const contextMarker =
  'The following Blog Studio context applies only to this user message.';

export interface PresentedChip {
  readonly kind: 'article' | 'selection' | 'attachment' | 'context';
  readonly label: string;
  readonly attachmentId?: string;
  readonly mimeType?: string;
  readonly filename?: string;
}

export interface PresentedUser {
  readonly type: 'user';
  readonly id: string;
  readonly text: string;
  readonly chips: readonly PresentedChip[];
}

export interface PresentedAssistant {
  readonly type: 'assistant';
  readonly id: string;
  readonly text: string;
  readonly streaming?: boolean;
}

export interface PresentedTool {
  readonly type: 'tool';
  readonly id: string;
  readonly name: string;
  readonly paths: readonly string[];
  readonly status: 'running' | 'succeeded' | 'failed' | 'canceled';
}

export interface PresentedProcess {
  readonly type: 'process';
  readonly id: string;
  readonly items: readonly (PresentedAssistant | PresentedTool)[];
  readonly collapsed: boolean;
  readonly outcome: 'running' | 'completed' | 'failed';
}

export type PresentedHistoryItem =
  PresentedUser | PresentedAssistant | PresentedTool | PresentedProcess;

export function splitUserMessage(text: string): {
  readonly text: string;
  readonly chips: readonly PresentedChip[];
} {
  const markerIndex = text.indexOf(contextMarker);
  const visible = (
    markerIndex === -1 ? text : text.slice(0, markerIndex)
  ).trim();
  const remainder = markerIndex === -1 ? '' : text.slice(markerIndex);
  const chips: PresentedChip[] = [];
  for (const match of remainder.matchAll(
    /<blog-studio-context[^>]*type="([^"]+)"[^>]*>([\s\S]*?)<\/blog-studio-context>/g,
  )) {
    const type = match[1] ?? 'context';
    const body = (match[2] ?? '').trim();
    chips.push({
      kind:
        type === 'article'
          ? 'article'
          : type === 'markdown-selection'
            ? 'selection'
            : 'context',
      label: chipLabel(type, body),
    });
  }
  for (const match of remainder.matchAll(
    /<blog-studio-attachment[^>]*>([\s\S]*?)<\/blog-studio-attachment>/g,
  )) {
    const note = (match[1] ?? '').trim();
    const filename = note.match(/Attachment [^:]+: ([^(]+)/)?.[1]?.trim();
    chips.push({
      kind: 'attachment',
      label: filename ? `附件 · ${filename}` : '附件',
      ...(filename ? { filename } : {}),
    });
  }
  return { text: visible, chips };
}

function chipLabel(type: string, body: string): string {
  if (type === 'article') {
    try {
      const value = JSON.parse(body) as { title?: string; path?: string };
      return `文章 · ${value.title ?? value.path ?? '当前文章'}`;
    } catch {
      return '文章';
    }
  }
  if (type === 'markdown-selection') return '选区';
  if (type === 'editor-buffer') return '未保存正文';
  return type;
}

function userItem(
  entry: AgentHistoryEntry,
  attachments: readonly AgentAttachmentSummary[],
): PresentedUser {
  const split = splitUserMessage(entry.text ?? '');
  const bound = attachments.filter(
    (attachment) => attachment.messageEntryId === entry.id,
  );
  const chips = [
    ...split.chips.map((chip) => {
      if (chip.kind !== 'attachment') return chip;
      const match = bound.find(
        (attachment) =>
          chip.filename === attachment.filename ||
          chip.label.includes(attachment.filename),
      );
      return match
        ? {
            ...chip,
            attachmentId: match.id,
            mimeType: match.mimeType,
            filename: match.filename,
          }
        : chip;
    }),
    ...bound
      .filter(
        (attachment) =>
          !split.chips.some(
            (chip) =>
              chip.kind === 'attachment' &&
              (chip.filename === attachment.filename ||
                chip.label.includes(attachment.filename)),
          ),
      )
      .map((attachment) => ({
        kind: 'attachment' as const,
        label: `附件 · ${attachment.filename}`,
        attachmentId: attachment.id,
        mimeType: attachment.mimeType,
        filename: attachment.filename,
      })),
  ];
  return {
    type: 'user',
    id: entry.id,
    text: split.text || (chips.length > 0 ? '' : (entry.text ?? '')),
    chips,
  };
}

export function presentAgentHistory(input: {
  readonly history: readonly AgentHistoryEntry[];
  readonly attachments?: readonly AgentAttachmentSummary[];
  readonly liveTools?: readonly PresentedTool[];
  readonly liveText?: string;
  readonly lastTurnStatus?:
    | 'queued'
    | 'running'
    | 'waiting-approval'
    | 'completed'
    | 'failed'
    | 'canceled'
    | 'interrupted';
}): readonly PresentedHistoryItem[] {
  const attachments = input.attachments ?? [];
  const items: PresentedHistoryItem[] = [];
  let process: Array<PresentedAssistant | PresentedTool> = [];
  let lastUserId = '';

  const flushTurn = (outcome: PresentedProcess['outcome']): void => {
    if (process.length === 0) return;
    const reply =
      outcome === 'failed'
        ? undefined
        : [...process]
            .reverse()
            .find((item) => item.type === 'assistant' && item.text.trim());
    const hidden = reply
      ? process.filter((item) => item.id !== reply.id)
      : process;
    if (hidden.length > 0) {
      items.push({
        type: 'process',
        id: `process-${lastUserId || reply?.id || hidden[0]?.id}`,
        items: hidden,
        collapsed: outcome === 'completed',
        outcome,
      });
    }
    if (reply) items.push(reply);
    process = [];
  };

  for (const entry of input.history) {
    if (entry.role === 'user') {
      flushTurn('completed');
      lastUserId = entry.id;
      items.push(userItem(entry, attachments));
      continue;
    }
    if (entry.role === 'assistant' && (entry.text || entry.imageCount)) {
      process.push({
        type: 'assistant',
        id: entry.id,
        text: entry.text ?? `图片 × ${entry.imageCount ?? 0}`,
      });
      continue;
    }
    if (entry.role === 'user' || entry.role === 'context') continue;
    process.push({
      type: 'tool',
      id: entry.id,
      name: (entry.text ?? '工具').split(/\s+/)[0] || '工具',
      paths: [],
      status: 'succeeded',
    });
  }

  if (input.liveTools && input.liveTools.length > 0)
    process.push(...input.liveTools);
  if (input.liveText) {
    process.push({
      type: 'assistant',
      id: 'live',
      text: input.liveText,
      streaming: true,
    });
  }

  const lastStatus = input.lastTurnStatus;
  const outcome: PresentedProcess['outcome'] =
    lastStatus === 'failed' || lastStatus === 'canceled'
      ? 'failed'
      : lastStatus === 'queued' ||
          lastStatus === 'running' ||
          lastStatus === 'waiting-approval' ||
          lastStatus === 'interrupted' ||
          Boolean(input.liveText || (input.liveTools && input.liveTools.length))
        ? 'running'
        : 'completed';
  flushTurn(outcome);
  return items;
}
