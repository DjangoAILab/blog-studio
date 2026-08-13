import { Dialog } from '@base-ui/react/dialog';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import type {
  StudioApi,
  AgentAttachmentSummary,
  AgentPreferenceDefaults,
  AgentMessageContext,
  AgentSessionDetails,
  AgentSessionSummary,
} from '../../app/api.js';
import { AgentMarkdown } from './agent-markdown.js';
import { AgentMixInput, type AgentMixInputHandle } from './agent-mix-input.js';
import {
  presentAgentHistory,
  type PresentedChip,
  type PresentedProcess,
  type PresentedTool,
} from './agent-history.js';

interface AgentPanelProps {
  readonly api: StudioApi;
  readonly siteId?: string;
  readonly siteName?: string;
  readonly articleContext?: Extract<AgentMessageContext, { type: 'article' }>;
  readonly selectionContext?: Extract<
    AgentMessageContext,
    { type: 'markdown-selection' }
  >;
  readonly openRequest: number;
  readonly requestedSessionId?: string;
  readonly createRequested?: boolean;
  readonly host?: HTMLElement | null;
  readonly onOpenChange?: (open: boolean) => void;
  readonly onSelectionConsumed: () => void;
  readonly onWorkspaceChanged?: (paths: readonly string[]) => void;
}

const activeTurnStates = new Set(['queued', 'running', 'waiting-approval']);
const turnLabels = {
  queued: '已排队',
  running: '执行中',
  'waiting-approval': '等待审批',
  completed: '已完成',
  failed: '失败',
  canceled: '已取消',
  interrupted: '重启中断',
} as const;

function sessionStorageKey(siteId: string): string {
  return `blog-studio:agent-session:${siteId}`;
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
  const cleaned = line
    .replace(/^[#>*\-\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '新会话';
  return cleaned.length > 24 ? `${cleaned.slice(0, 23)}…` : cleaned;
}

function isImageMime(mimeType?: string, filename?: string): boolean {
  if (mimeType?.startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp|avif)$/i.test(filename ?? '');
}

function AttachmentCard({
  chip,
  href,
  downloadHref,
  onRemove,
}: {
  readonly chip: PresentedChip;
  readonly href?: string | undefined;
  readonly downloadHref?: string | undefined;
  readonly onRemove?: () => void;
}) {
  const previewable = Boolean(
    href && isImageMime(chip.mimeType, chip.filename),
  );
  const name = chip.filename ?? chip.label.replace(/^附件 · /, '');
  return (
    <span className="studio2-attachment">
      {previewable ? (
        <a
          className="studio2-attachment-preview"
          href={href}
          target="_blank"
          rel="noreferrer"
          title="预览图片"
        >
          <img src={href} alt="" />
        </a>
      ) : (
        <span className="studio2-attachment-icon" aria-hidden="true">
          件
        </span>
      )}
      <span className="studio2-attachment-copy">
        <strong>{name}</strong>
        <small>{chip.mimeType ?? '文件'}</small>
      </span>
      <span className="studio2-attachment-actions">
        {downloadHref ? (
          <a href={downloadHref} download={chip.filename ?? true}>
            下载
          </a>
        ) : null}
        {onRemove ? (
          <button type="button" aria-label={`移除 ${name}`} onClick={onRemove}>
            移除
          </button>
        ) : null}
      </span>
    </span>
  );
}

function ProcessBlock({ process }: { readonly process: PresentedProcess }) {
  return (
    <details
      className="studio2-agent-process"
      data-outcome={process.outcome}
      open={!process.collapsed}
    >
      <summary>
        {process.outcome === 'running'
          ? '正在执行'
          : process.outcome === 'failed'
            ? '执行未完成，过程已展开'
            : '过程'}
      </summary>
      {process.items.map((item) =>
        item.type === 'tool' ? (
          <p key={item.id} data-status={item.status}>
            {item.status === 'running' ? '正在调用' : '已调用'} {item.name}
            {item.paths.length > 0 ? ` · ${item.paths.join(', ')}` : ''}
          </p>
        ) : (
          <p key={item.id}>{item.text}</p>
        ),
      )}
    </details>
  );
}

export function AgentPanel({
  api,
  siteId,
  siteName,
  articleContext,
  selectionContext,
  openRequest,
  requestedSessionId,
  createRequested = false,
  host,
  onOpenChange,
  onSelectionConsumed,
  onWorkspaceChanged,
}: AgentPanelProps) {
  const [open, setOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [uploading, setUploading] = useState(false);
  const [sessions, setSessions] = useState<readonly AgentSessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState('');
  const [details, setDetails] = useState<AgentSessionDetails>();
  const [preferenceDefaults, setPreferenceDefaults] =
    useState<AgentPreferenceDefaults>({ global: null, site: null });
  const [canSend, setCanSend] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const mixInput = useRef<AgentMixInputHandle>(null);
  const selectionSerial = useRef(0);
  const [selectionChips, setSelectionChips] = useState<
    readonly {
      readonly ref: string;
      readonly context: Extract<
        AgentMessageContext,
        { type: 'markdown-selection' }
      >;
    }[]
  >([]);
  const [attachments, setAttachments] = useState<
    readonly AgentAttachmentSummary[]
  >([]);
  const [liveText, setLiveText] = useState('');
  const [liveTools, setLiveTools] = useState<readonly PresentedTool[]>([]);
  const eventSource = useRef<EventSource | undefined>(undefined);
  const cursor = useRef(0);
  const historyEnd = useRef<HTMLDivElement>(null);

  const activeSession = sessions.find((item) => item.id === activeSessionId);
  const activeTurn = [...(details?.turns ?? [])]
    .reverse()
    .find((turn) => activeTurnStates.has(turn.status));

  const lastTurn = [...(details?.turns ?? [])].at(-1);
  const presented = useMemo(
    () =>
      presentAgentHistory({
        history: details?.history ?? [],
        attachments: details?.attachments ?? attachments,
        liveTools,
        liveText,
        ...(lastTurn ? { lastTurnStatus: lastTurn.status } : {}),
      }),
    [attachments, details, lastTurn?.status, liveText, liveTools],
  );

  function changeOpen(next: boolean): void {
    setOpen(next);
    if (!next) setSwitcherOpen(false);
    onOpenChange?.(next);
  }

  async function loadSessions(nextSiteId: string): Promise<void> {
    const result = await api.agentSessions(nextSiteId, true);
    setSessions(result.sessions);
    const stored = window.sessionStorage.getItem(sessionStorageKey(nextSiteId));
    const selected =
      result.sessions.find((item) => item.id === stored)?.id ??
      result.sessions.find((item) => item.state === 'active')?.id ??
      '';
    setActiveSessionId(selected);
  }

  async function refreshDetails(): Promise<void> {
    if (!siteId || !activeSessionId) {
      setDetails(undefined);
      return;
    }
    const next = await api.agentSession(siteId, activeSessionId);
    setDetails(next);
  }

  useEffect(() => {
    if (openRequest > 0) {
      changeOpen(true);
      if (requestedSessionId) {
        setActiveSessionId(requestedSessionId);
        setSwitcherOpen(false);
      } else if (createRequested || !activeSessionId) {
        void createSession();
      }
    }
  }, [openRequest]);

  useEffect(() => {
    eventSource.current?.close();
    setDetails(undefined);
    setAttachments([]);
    setLiveTools([]);
    setLiveText('');
    setSelectionChips([]);
    selectionSerial.current = 0;
    setCanSend(false);
    mixInput.current?.clear();
    setSwitcherOpen(false);
    if (!siteId) {
      setSessions([]);
      setActiveSessionId('');
      return;
    }
    void Promise.all([
      loadSessions(siteId),
      api.agentPreferenceDefaults(siteId).then(setPreferenceDefaults),
    ]).catch((reason: unknown) =>
      setError(
        reason instanceof Error ? reason.message : 'Agent Session 读取失败',
      ),
    );
  }, [api, siteId]);

  useEffect(() => {
    if (!siteId || !activeSessionId) return;
    window.sessionStorage.setItem(sessionStorageKey(siteId), activeSessionId);
    void refreshDetails().catch((reason: unknown) =>
      setError(reason instanceof Error ? reason.message : 'Agent 历史读取失败'),
    );
  }, [activeSessionId, siteId]);

  useEffect(() => {
    if (!selectionContext) return;
    selectionSerial.current += 1;
    const value = `#${selectionSerial.current}`;
    setSelectionChips((items) => [
      ...items,
      { ref: value, context: selectionContext },
    ]);
    setOpen(true);
    onSelectionConsumed();
  }, [selectionContext]);

  useEffect(() => {
    historyEnd.current?.scrollIntoView({ block: 'end' });
  }, [presented]);

  useEffect(
    () => () => {
      eventSource.current?.close();
    },
    [],
  );

  function upsertLiveTool(next: PresentedTool): void {
    setLiveTools((items) => {
      const index = items.findIndex((item) => item.id === next.id);
      if (index === -1) return [...items, next];
      return items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...next } : item,
      );
    });
  }

  function connectEvents(): void {
    if (!siteId || !activeSessionId) return;
    eventSource.current?.close();
    const source = new EventSource(
      api.agentEventsUrl(siteId, activeSessionId, cursor.current),
    );
    eventSource.current = source;
    const receive = (event: MessageEvent<string>) => {
      try {
        const value = JSON.parse(event.data) as {
          readonly sequence?: number;
          readonly type?: string;
          readonly payload?: {
            readonly role?: string;
            readonly text?: string;
            readonly toolCallId?: string;
            readonly toolName?: string;
            readonly paths?: readonly string[];
            readonly failed?: boolean;
          };
        };
        if (typeof value.sequence === 'number') cursor.current = value.sequence;
        const payload = value.payload;
        if (payload?.role === 'assistant' && payload.text) {
          setLiveText(payload.text);
        }
        const toolId = payload?.toolCallId;
        const toolName = payload?.toolName;
        if (toolId && toolName) {
          const running =
            value.type === 'tool-start' || value.type === 'tool-running';
          upsertLiveTool({
            type: 'tool',
            id: toolId,
            name: toolName,
            paths: payload.paths ?? [],
            status: running
              ? 'running'
              : payload.failed
                ? 'failed'
                : 'succeeded',
          });
        }
        if (payload?.paths && payload.paths.length > 0) {
          onWorkspaceChanged?.(payload.paths);
        }
      } catch {
        // A malformed transient event is followed by the durable snapshot.
      }
    };
    for (const type of [
      'message-update',
      'message-end',
      'approval-required',
      'turn-running',
      'tool-start',
      'tool-end',
      'tool-running',
      'tool-succeeded',
      'workspace-changed',
    ]) {
      source.addEventListener(type, receive as EventListener);
    }
    for (const type of ['message-end', 'approval-required', 'turn-running']) {
      source.addEventListener(type, () => void refreshDetails());
    }
    for (const type of [
      'turn-completed',
      'turn-failed',
      'turn-canceled',
      'turn-interrupted',
      'snapshot',
    ]) {
      source.addEventListener(type, () => {
        source.close();
        setLiveTools([]);
        setLiveText('');
        onWorkspaceChanged?.([]);
        void refreshDetails();
      });
    }
    source.onerror = () => {
      source.close();
      void refreshDetails();
    };
  }

  async function createSession(): Promise<void> {
    if (!siteId) return;
    setBusy(true);
    setError('');
    try {
      const session = await api.createAgentSession({
        siteId,
        displayName: '新会话',
      });
      await loadSessions(siteId);
      setActiveSessionId(session.id);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '新建 Session 失败');
    } finally {
      setBusy(false);
    }
  }

  async function send(): Promise<void> {
    const payload = mixInput.current?.read() ?? { text: '', refs: [] };
    const selections = payload.refs.flatMap((ref) => {
      const chip = selectionChips.find((item) => item.ref === ref);
      return chip ? [chip.context] : [];
    });
    const message =
      payload.text.trim() ||
      (selections.length > 0 ? payload.refs.join(' ') : '');
    if (!siteId || !activeSessionId || !message) return;
    const nextContexts = [
      ...(articleContext ? [articleContext] : []),
      ...selections,
    ];
    setBusy(true);
    setError('');
    setLiveText('');
    setLiveTools([]);
    try {
      await api.submitAgentMessage({
        siteId,
        sessionId: activeSessionId,
        text: message,
        ...(nextContexts.length > 0 ? { contexts: nextContexts } : {}),
        ...(attachments.length > 0
          ? { attachmentIds: attachments.map((item) => item.id) }
          : {}),
      });
      if (
        activeSession &&
        isPlaceholderSessionName(activeSession.displayName)
      ) {
        const displayName = titleFromFirstMessage(message);
        void api
          .updateAgentSession({
            siteId,
            sessionId: activeSessionId,
            displayName,
          })
          .then(() => loadSessions(siteId));
      }
      mixInput.current?.clear();
      setAttachments([]);
      setSelectionChips([]);
      setCanSend(false);
      selectionSerial.current = 0;
      onSelectionConsumed();
      await refreshDetails();
      connectEvents();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '消息提交失败');
    } finally {
      setBusy(false);
    }
  }

  const sessionTitle = activeSession?.displayName ?? '新会话';

  function attachmentHref(
    attachmentId: string | undefined,
    download = false,
  ): string | undefined {
    if (!siteId || !activeSessionId || !attachmentId) return undefined;
    return api.agentAttachmentUrl(
      siteId,
      activeSessionId,
      attachmentId,
      download,
    );
  }

  return (
    <>
      {open ? null : (
        <button
          className="agent-launcher"
          type="button"
          aria-expanded={open}
          aria-controls="site-agent-panel"
          disabled={!siteId}
          onClick={() => changeOpen(true)}
        >
          <span className="agent-launcher-glow" aria-hidden="true" />
          <span className="agent-launcher-spark" aria-hidden="true" />
          <span className="agent-launcher-mark" aria-hidden="true">
            ✦
          </span>
          AI
        </button>
      )}
      {((tree) => (host && open ? createPortal(tree, host) : tree))(
        <AnimatePresence>
          {open ? (
            <motion.aside
              id="site-agent-panel"
              className={`agent-panel${host ? ' is-embedded' : ''}`}
              aria-label={`${siteName ?? '当前站点'} AI`}
              initial={{ x: 28, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 28, opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <header className="agent-panel-header">
                <div className="agent-session-title">
                  {renaming ? (
                    <input
                      aria-label="会话名称"
                      value={renameValue}
                      autoFocus
                      onChange={(event) => setRenameValue(event.target.value)}
                      onBlur={() => {
                        const displayName = renameValue.trim();
                        setRenaming(false);
                        if (!siteId || !activeSession || !displayName) return;
                        void api
                          .updateAgentSession({
                            siteId,
                            sessionId: activeSession.id,
                            displayName,
                          })
                          .then(() => loadSessions(siteId));
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') event.currentTarget.blur();
                        if (event.key === 'Escape') setRenaming(false);
                      }}
                    />
                  ) : (
                    <>
                      <strong>{sessionTitle}</strong>
                      <button
                        className="agent-title-edit"
                        type="button"
                        aria-label="编辑会话名称"
                        disabled={!activeSession}
                        onClick={() => {
                          setRenameValue(sessionTitle);
                          setRenaming(true);
                        }}
                      >
                        ✎
                      </button>
                    </>
                  )}
                </div>
                <div className="agent-header-actions">
                  <button
                    className="studio2-secondary-button"
                    type="button"
                    disabled={busy || !siteId}
                    onClick={() => void createSession()}
                  >
                    新建
                  </button>
                  <button
                    className="studio2-secondary-button"
                    type="button"
                    onClick={() => setSwitcherOpen(true)}
                  >
                    切换
                  </button>
                  <button
                    className="studio2-secondary-button"
                    type="button"
                    disabled={
                      !activeSession ||
                      activeSession.state === 'archived' ||
                      Boolean(activeTurn)
                    }
                    onClick={() => {
                      if (!siteId || !activeSession) return;
                      void api
                        .archiveAgentSession(siteId, activeSession.id)
                        .then(() => loadSessions(siteId));
                    }}
                  >
                    归档
                  </button>
                  <button
                    className="agent-settings-button"
                    type="button"
                    aria-label="AI 设置"
                    onClick={() => setSettingsOpen(true)}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        fill="currentColor"
                        d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.2 7.2 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.9 2h-3.8a.5.5 0 0 0-.49.42l-.36 2.54c-.59.24-1.13.55-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.48a.5.5 0 0 0 .12.64L4.86 10.7c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.23.4.32.64.22l2.39-.96c.5.39 1.04.7 1.63.94l.36 2.54c.05.24.25.42.49.42h3.8c.24 0 .44-.18.49-.42l.36-2.54c.59-.24 1.13-.55 1.63-.94l2.39.96c.24.1.51 0 .64-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z"
                      />
                    </svg>
                  </button>
                  <button
                    className="studio2-sheet-close"
                    type="button"
                    aria-label="关闭 AI"
                    onClick={() => changeOpen(false)}
                  >
                    ×
                  </button>
                </div>
              </header>

              <Dialog.Root open={switcherOpen} onOpenChange={setSwitcherOpen}>
                <Dialog.Portal>
                  <Dialog.Backdrop className="studio2-dialog-backdrop" />
                  <Dialog.Viewport className="studio2-dialog-viewport is-center">
                    <Dialog.Popup className="studio2-dialog-card">
                      <header>
                        <div>
                          <Dialog.Title>切换会话</Dialog.Title>
                          <Dialog.Description>
                            会话属于整个站点。当前页面会作为这一轮的动态上下文。
                          </Dialog.Description>
                        </div>
                        <Dialog.Close
                          className="studio2-sheet-close"
                          aria-label="关闭"
                        >
                          ×
                        </Dialog.Close>
                      </header>
                      <div className="agent-switcher">
                        <select
                          aria-label="AI Session"
                          value={activeSessionId}
                          onChange={(event) => {
                            setActiveSessionId(event.target.value);
                            if (event.target.value) setSwitcherOpen(false);
                          }}
                        >
                          <option value="">选择会话</option>
                          {sessions.map((session) => (
                            <option key={session.id} value={session.id}>
                              {session.state === 'archived' ? '〔已归档〕' : ''}
                              {session.displayName}
                            </option>
                          ))}
                        </select>
                      </div>
                    </Dialog.Popup>
                  </Dialog.Viewport>
                </Dialog.Portal>
              </Dialog.Root>

              <Dialog.Root open={settingsOpen} onOpenChange={setSettingsOpen}>
                <Dialog.Portal>
                  <Dialog.Backdrop className="studio2-dialog-backdrop" />
                  <Dialog.Viewport className="studio2-dialog-viewport is-center">
                    <Dialog.Popup className="studio2-dialog-card">
                      <header>
                        <div>
                          <Dialog.Title>AI 设置</Dialog.Title>
                          <Dialog.Description>
                            全局和当前站点的默认执行模式。会话可以再覆盖。
                          </Dialog.Description>
                        </div>
                        <Dialog.Close
                          className="studio2-sheet-close"
                          aria-label="关闭"
                        >
                          ×
                        </Dialog.Close>
                      </header>
                      <div className="agent-switcher">
                        <label>
                          全局默认
                          <select
                            aria-label="AI 全局默认模式"
                            value={preferenceDefaults.global ?? 'approval'}
                            onChange={(event) => {
                              if (!siteId) return;
                              void api
                                .updateAgentPreferenceDefaults({
                                  siteId,
                                  scope: 'global',
                                  mode: event.target.value as
                                    'approval' | 'yolo',
                                })
                                .then((value) => {
                                  setPreferenceDefaults(value);
                                  return refreshDetails();
                                });
                            }}
                          >
                            <option value="approval">每次审批</option>
                            <option value="yolo">YOLO</option>
                          </select>
                        </label>
                        <label>
                          当前站点默认
                          <select
                            aria-label="AI 当前站点默认模式"
                            value={preferenceDefaults.site ?? 'inherit'}
                            onChange={(event) => {
                              if (!siteId) return;
                              const value = event.target.value;
                              void api
                                .updateAgentPreferenceDefaults({
                                  siteId,
                                  scope: 'site',
                                  mode:
                                    value === 'inherit'
                                      ? null
                                      : (value as 'approval' | 'yolo'),
                                })
                                .then((next) => {
                                  setPreferenceDefaults(next);
                                  return refreshDetails();
                                });
                            }}
                          >
                            <option value="inherit">跟随全局</option>
                            <option value="approval">每次审批</option>
                            <option value="yolo">YOLO</option>
                          </select>
                        </label>
                      </div>
                    </Dialog.Popup>
                  </Dialog.Viewport>
                </Dialog.Portal>
              </Dialog.Root>

              {activeSession?.state === 'archived' ? (
                <div className="agent-empty">
                  <p>这个 Session 已归档，历史仍然保留。</p>
                  <button
                    type="button"
                    onClick={() => {
                      if (!siteId) return;
                      void api
                        .restoreAgentSession(siteId, activeSession.id)
                        .then(() => loadSessions(siteId));
                    }}
                  >
                    恢复 Session
                  </button>
                </div>
              ) : activeSessionId ? (
                <>
                  <div className="agent-history" aria-live="polite">
                    {presented.map((entry) => {
                      if (entry.type === 'process') {
                        return <ProcessBlock key={entry.id} process={entry} />;
                      }
                      if (entry.type === 'tool') {
                        return (
                          <details
                            className="studio2-agent-process"
                            data-status={entry.status}
                            key={entry.id}
                            open={entry.status === 'running'}
                          >
                            <summary>
                              {entry.status === 'running'
                                ? '正在调用'
                                : '已调用'}{' '}
                              {entry.name}
                            </summary>
                            {entry.paths.length > 0 ? (
                              <code>{entry.paths.join(', ')}</code>
                            ) : null}
                          </details>
                        );
                      }
                      return (
                        <article
                          key={entry.id}
                          data-role={
                            entry.type === 'user' ? 'user' : 'assistant'
                          }
                          className={
                            entry.type === 'assistant' && entry.streaming
                              ? 'is-streaming'
                              : undefined
                          }
                        >
                          <span>
                            {entry.type === 'assistant'
                              ? entry.streaming
                                ? 'AI · 正在回答'
                                : 'AI'
                              : '你'}
                          </span>
                          {entry.type === 'user' &&
                          entry.chips.some(
                            (chip) => chip.kind !== 'attachment',
                          ) ? (
                            <div className="agent-history-chips">
                              {entry.chips
                                .filter((chip) => chip.kind !== 'attachment')
                                .map((chip) => (
                                  <em key={`${entry.id}-${chip.label}`}>
                                    {chip.label}
                                  </em>
                                ))}
                            </div>
                          ) : null}
                          {entry.type === 'user' &&
                          entry.chips.some(
                            (chip) => chip.kind === 'attachment',
                          ) ? (
                            <div className="studio2-attachment-list">
                              {entry.chips
                                .filter((chip) => chip.kind === 'attachment')
                                .map((chip) => (
                                  <AttachmentCard
                                    key={`${entry.id}-${chip.label}`}
                                    chip={chip}
                                    {...(attachmentHref(chip.attachmentId)
                                      ? {
                                          href: attachmentHref(
                                            chip.attachmentId,
                                          ),
                                          downloadHref: attachmentHref(
                                            chip.attachmentId,
                                            true,
                                          ),
                                        }
                                      : {})}
                                  />
                                ))}
                            </div>
                          ) : null}
                          {entry.text ? (
                            entry.type === 'assistant' ? (
                              <AgentMarkdown text={entry.text} />
                            ) : (
                              <p>{entry.text}</p>
                            )
                          ) : null}
                        </article>
                      );
                    })}
                    {presented.length === 0 ? (
                      <div className="agent-empty">
                        <b>从整个站点开始。</b>
                        <p>
                          AI
                          可以阅读与修改当前站点的文件；当前页面会作为这一轮的动态上下文。
                        </p>
                      </div>
                    ) : null}
                    <div ref={historyEnd} />
                  </div>

                  {(details?.approvals ?? [])
                    .filter(
                      (approval) => approval.approvalDecision === 'pending',
                    )
                    .map((approval) => (
                      <section
                        className="agent-approval"
                        key={approval.toolCallId}
                      >
                        <b>请求执行 {approval.toolName}</b>
                        <code>{approval.paths.join(', ')}</code>
                        <div>
                          <button
                            type="button"
                            onClick={() => {
                              if (!siteId) return;
                              void api
                                .decideAgentApproval({
                                  siteId,
                                  sessionId: activeSessionId,
                                  turnId: approval.turnId,
                                  toolCallId: approval.toolCallId,
                                  decision: 'rejected',
                                })
                                .then(() => refreshDetails());
                            }}
                          >
                            拒绝
                          </button>
                          <button
                            className="is-approve"
                            type="button"
                            onClick={() => {
                              if (!siteId) return;
                              void api
                                .decideAgentApproval({
                                  siteId,
                                  sessionId: activeSessionId,
                                  turnId: approval.turnId,
                                  toolCallId: approval.toolCallId,
                                  decision: 'approved',
                                })
                                .then(() => refreshDetails());
                            }}
                          >
                            批准
                          </button>
                        </div>
                      </section>
                    ))}

                  {busy || activeTurn ? (
                    <p
                      className="agent-turn-state"
                      data-state={activeTurn?.status ?? 'running'}
                      role="status"
                    >
                      <span className="studio2-loading-orb" />
                      {activeTurn
                        ? `${turnLabels[activeTurn.status]}${
                            activeTurn.errorCode
                              ? ` · ${activeTurn.errorCode}`
                              : ''
                          }`
                        : '正在处理…'}
                    </p>
                  ) : null}

                  <form
                    className="agent-composer"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void send();
                    }}
                  >
                    {attachments.length > 0 ? (
                      <div className="studio2-attachment-list">
                        {attachments.map((attachment) => (
                          <AttachmentCard
                            key={attachment.id}
                            chip={{
                              kind: 'attachment',
                              label: attachment.filename,
                              attachmentId: attachment.id,
                              mimeType: attachment.mimeType,
                              filename: attachment.filename,
                            }}
                            {...(attachmentHref(attachment.id)
                              ? {
                                  href: attachmentHref(attachment.id),
                                  downloadHref: attachmentHref(
                                    attachment.id,
                                    true,
                                  ),
                                }
                              : {})}
                            onRemove={() =>
                              setAttachments((items) =>
                                items.filter(
                                  (item) => item.id !== attachment.id,
                                ),
                              )
                            }
                          />
                        ))}
                      </div>
                    ) : null}
                    <div className="agent-contexts" aria-label="本次消息上下文">
                      {activeSessionId ? (
                        <label className="agent-mode-select">
                          执行模式
                          <select
                            aria-label="执行模式"
                            value={activeSession?.approvalMode ?? 'inherit'}
                            onChange={(event) => {
                              if (!siteId) return;
                              const value = event.target.value;
                              const approvalMode =
                                value === 'inherit'
                                  ? null
                                  : (value as 'approval' | 'yolo');
                              void api
                                .updateAgentSession({
                                  siteId,
                                  sessionId: activeSessionId,
                                  approvalMode,
                                })
                                .then(async () => {
                                  await loadSessions(siteId);
                                  await refreshDetails();
                                });
                            }}
                          >
                            <option value="inherit">跟随默认</option>
                            <option value="approval">每次审批</option>
                            <option value="yolo">YOLO</option>
                          </select>
                        </label>
                      ) : null}
                      {uploading ? (
                        <span className="studio2-inline-loading" role="status">
                          <span className="studio2-loading-orb" />
                          正在上传附件…
                        </span>
                      ) : null}
                    </div>
                    <AgentMixInput
                      handleRef={mixInput}
                      tags={selectionChips.map((item) => ({
                        value: item.ref,
                        title:
                          item.context.text.trim().slice(0, 80) || item.ref,
                      }))}
                      placeholder="这一段 #1 跟这一段 #2 矛盾…"
                      onChange={(payload) =>
                        setCanSend(
                          Boolean(payload.text.trim() || payload.refs.length),
                        )
                      }
                      onSubmit={() => void send()}
                      onRemoveRef={(value) =>
                        setSelectionChips((items) =>
                          items.filter((item) => item.ref !== value),
                        )
                      }
                    />
                    <div className="agent-composer-actions">
                      <label className="agent-upload-button">
                        {uploading ? '上传中…' : '附件'}
                        <input
                          type="file"
                          disabled={uploading || !activeSessionId}
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (!file || !siteId) return;
                            setUploading(true);
                            setError('');
                            void api
                              .uploadAgentAttachment({
                                siteId,
                                sessionId: activeSessionId,
                                file,
                              })
                              .then(({ attachment }) =>
                                setAttachments((items) => [
                                  ...items,
                                  attachment,
                                ]),
                              )
                              .catch((reason: unknown) =>
                                setError(
                                  reason instanceof Error
                                    ? reason.message
                                    : '附件上传失败',
                                ),
                              )
                              .finally(() => setUploading(false));
                            event.target.value = '';
                          }}
                        />
                      </label>
                      {activeTurn ? (
                        <button
                          type="button"
                          onClick={() => {
                            if (!siteId) return;
                            void api
                              .cancelAgentTurn({
                                siteId,
                                sessionId: activeSessionId,
                                turnId: activeTurn.id,
                              })
                              .then(() => refreshDetails());
                          }}
                        >
                          停止
                        </button>
                      ) : (
                        <button
                          className="agent-send"
                          type="submit"
                          disabled={busy || !canSend}
                        >
                          发送 ↗
                        </button>
                      )}
                    </div>
                  </form>
                </>
              ) : (
                <div className="agent-empty">
                  <b>还没有会话</b>
                  <p>点左上角「新建」开一个；当前页面会自动带进这一轮。</p>
                </div>
              )}

              {error ? (
                <p className="agent-error" role="alert">
                  {error}
                </p>
              ) : null}
            </motion.aside>
          ) : null}
        </AnimatePresence>,
      )}
    </>
  );
}
