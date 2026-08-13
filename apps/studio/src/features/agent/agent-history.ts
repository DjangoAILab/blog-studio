import type {
  AgentAttachmentSummary,
  AgentHistoryEntry,
} from '../../app/api.js';

const contextMarker =
  'The following Blog Studio context applies only to this user message.';

export interface PresentedChip {
  readonly kind: 'article' | 'selection' | 'attachment' | 'context';
  readonly label: string;
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

export type PresentedHistoryItem =
  PresentedUser | PresentedAssistant | PresentedTool;

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

export function presentAgentHistory(input: {
  readonly history: readonly AgentHistoryEntry[];
  readonly attachments?: readonly AgentAttachmentSummary[];
  readonly liveTools?: readonly PresentedTool[];
  readonly liveText?: string;
}): readonly PresentedHistoryItem[] {
  const attachments = input.attachments ?? [];
  const items: PresentedHistoryItem[] = [];
  for (const entry of input.history) {
    if (entry.role === 'user') {
      const split = splitUserMessage(entry.text ?? '');
      const bound = attachments.filter(
        (attachment) => attachment.messageEntryId === entry.id,
      );
      const chips = [
        ...split.chips,
        ...bound
          .filter(
            (attachment) =>
              !split.chips.some((chip) =>
                chip.label.includes(attachment.filename),
              ),
          )
          .map((attachment) => ({
            kind: 'attachment' as const,
            label: `附件 · ${attachment.filename}`,
          })),
      ];
      items.push({
        type: 'user',
        id: entry.id,
        text: split.text || (chips.length > 0 ? '' : (entry.text ?? '')),
        chips,
      });
      continue;
    }
    if (entry.role === 'assistant' && (entry.text || entry.imageCount)) {
      items.push({
        type: 'assistant',
        id: entry.id,
        text: entry.text ?? `图片 × ${entry.imageCount ?? 0}`,
      });
    }
  }
  if (input.liveTools && input.liveTools.length > 0)
    items.push(...input.liveTools);
  if (input.liveText) {
    items.push({
      type: 'assistant',
      id: 'live',
      text: input.liveText,
      streaming: true,
    });
  }
  return items;
}
