import { Dialog } from '@base-ui/react/dialog';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';

import type {
  StudioApi,
  AgentAttachmentSummary,
  AgentPreferenceDefaults,
  AgentMessageContext,
  AgentSessionDetails,
  AgentSessionSummary,
} from '../../app/api.js';
import { AgentMarkdown } from './agent-markdown.js';
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

function sessionStorageKey(siteId: string, documentId?: string): string {
  return `blog-studio:agent-session:${siteId}:${documentId ?? 'global'}`;
}

function ContextChip({
  label,
  details,
  onRemove,
}: {
  readonly label: string;
  readonly details: string;
  readonly onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <span className="agent-context-chip" data-expanded={expanded}>
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={`查看 ${label}`}
        onClick={() => setExpanded((value) => !value)}
      >
        {label}
      </button>
      <button type="button" aria-label={`移除 ${label}`} onClick={onRemove}>
        ×
      </button>
      {expanded ? (
        <span className="agent-context-detail">{details}</span>
      ) : null}
    </span>
  );
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
          <button
            type="button"
            aria-label={`移除 ${name}`}
            onClick={onRemove}
          >
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
  onOpenChange,
  onSelectionConsumed,
  onWorkspaceChanged,
}: AgentPanelProps) {
  const [open, setOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [switcherTab, setSwitcherTab] = useState<'create' | 'choose'>('create');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [sessions, setSessions] = useState<readonly AgentSessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState('');
  const [details, setDetails] = useState<AgentSessionDetails>();
  const [preferenceDefaults, setPreferenceDefaults] =
    useState<AgentPreferenceDefaults>({ global: null, site: null });
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [includeSelection, setIncludeSelection] = useState(false);
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
    const stored = window.sessionStorage.getItem(
      sessionStorageKey(nextSiteId, articleContext?.documentId),
    );
    const articleBound = articleContext
      ? result.sessions.find(
          (item) =>
            item.state === 'active' &&
            item.documentId === articleContext.documentId,
        )
      : undefined;
    const selected =
      result.sessions.find((item) => item.id === stored)?.id ??
      articleBound?.id ??
      result.sessions.find(
        (item) => item.state === 'active' && !item.documentId,
      )?.id ??
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
        setSwitcherTab('create');
        setSwitcherOpen(true);
      }
    }
  }, [openRequest]);

  useEffect(() => {
    eventSource.current?.close();
    setDetails(undefined);
    setAttachments([]);
    setLiveTools([]);
    setLiveText('');
    setIncludeSelection(false);
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
  }, [api, articleContext?.documentId, siteId]);

  useEffect(() => {
    if (!siteId || !activeSessionId) return;
    window.sessionStorage.setItem(
      sessionStorageKey(siteId, articleContext?.documentId),
      activeSessionId,
    );
    void refreshDetails().catch((reason: unknown) =>
      setError(reason instanceof Error ? reason.message : 'Agent 历史读取失败'),
    );
  }, [activeSessionId, siteId]);

  useEffect(() => {
    if (selectionContext) {
      setIncludeSelection(true);
      setOpen(true);
    }
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

  const contexts = useMemo(() => {
    const result: AgentMessageContext[] = [];
    if (articleContext) result.push(articleContext);
    if (includeSelection && selectionContext) result.push(selectionContext);
    return result;
  }, [articleContext, includeSelection, selectionContext]);

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
        displayName: articleContext
          ? `文章 · ${articleContext.title ?? '未命名'}`
          : `站点会话 ${sessions.filter((item) => !item.documentId).length + 1}`,
        ...(articleContext
          ? {
              documentId: articleContext.documentId,
              collectionId: articleContext.collectionId,
            }
          : {}),
      });
      await loadSessions(siteId);
      setActiveSessionId(session.id);
      setSwitcherOpen(false);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '新建 Session 失败');
    } finally {
      setBusy(false);
    }
  }

  async function send(): Promise<void> {
    if (!siteId || !activeSessionId || !text.trim()) return;
    setBusy(true);
    setError('');
    setLiveText('');
    setLiveTools([]);
    try {
      await api.submitAgentMessage({
        siteId,
        sessionId: activeSessionId,
        text,
        ...(contexts.length > 0 ? { contexts } : {}),
        ...(attachments.length > 0
          ? { attachmentIds: attachments.map((item) => item.id) }
          : {}),
      });
      setText('');
      setAttachments([]);
      setIncludeSelection(false);
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
          Agent
        </button>
      )}
      <AnimatePresence>
        {open ? (
          <motion.aside
            id="site-agent-panel"
            className="agent-panel"
            aria-label={`${siteName ?? '当前站点'} Agent`}
            initial={{ x: 28, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 28, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <header className="agent-panel-header">
              <strong>{sessionTitle}</strong>
              <div className="agent-header-actions">
                <button
                  className="studio2-secondary-button"
                  type="button"
                  onClick={() => {
                    setSwitcherTab(activeSessionId ? 'choose' : 'create');
                    setSwitcherOpen(true);
                  }}
                >
                  切换会话
                </button>
                <button
                  className="studio2-icon-more"
                  type="button"
                  aria-label="Agent 设置"
                  onClick={() => setSettingsOpen(true)}
                >
                  ⚙
                </button>
                <button
                  className="studio2-sheet-close"
                  type="button"
                  aria-label="关闭 Agent"
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
                        <Dialog.Title>会话</Dialog.Title>
                        <Dialog.Description>
                          {articleContext
                            ? `默认绑定「${articleContext.title ?? '当前文章'}」，能力仍覆盖整个站点。`
                            : '这是站点级会话，不绑定单篇文章。'}
                        </Dialog.Description>
                      </div>
                      <Dialog.Close
                        className="studio2-sheet-close"
                        aria-label="关闭"
                      >
                        ×
                      </Dialog.Close>
                    </header>
                    <div className="studio2-session-tabs" role="tablist">
                      <button
                        type="button"
                        role="tab"
                        aria-selected={switcherTab === 'create'}
                        className={switcherTab === 'create' ? 'is-active' : ''}
                        onClick={() => setSwitcherTab('create')}
                      >
                        新建
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={switcherTab === 'choose'}
                        className={switcherTab === 'choose' ? 'is-active' : ''}
                        onClick={() => setSwitcherTab('choose')}
                      >
                        选择
                      </button>
                    </div>
                    {switcherTab === 'create' ? (
                      <div className="agent-switcher">
                        <p>
                          {articleContext
                            ? '新建一个只挂在这篇文章上的会话。'
                            : '新建一个站点级会话。'}
                        </p>
                        <button
                          className="studio2-primary-button"
                          type="button"
                          disabled={busy || !siteId}
                          onClick={() => void createSession()}
                        >
                          {busy ? '正在创建…' : '创建会话'}
                        </button>
                      </div>
                    ) : (
                      <div className="agent-switcher">
                        <select
                          aria-label="Agent Session"
                          value={activeSessionId}
                          onChange={(event) => {
                            setActiveSessionId(event.target.value);
                            if (event.target.value) setSwitcherOpen(false);
                          }}
                        >
                          <option value="">选择会话</option>
                          {sessions.map((session) => (
                            <option key={session.id} value={session.id}>
                              {session.documentId ? '文章 · ' : '全局 · '}
                              {session.state === 'archived' ? '〔已归档〕' : ''}
                              {session.displayName}
                            </option>
                          ))}
                        </select>
                        <label>
                          会话名称
                          <input
                            aria-label="会话名称"
                            disabled={
                              !activeSession ||
                              activeSession.state === 'archived'
                            }
                            value={activeSession?.displayName ?? ''}
                            onChange={(event) => {
                              const displayName = event.target.value;
                              setSessions((items) =>
                                items.map((item) =>
                                  item.id === activeSessionId
                                    ? { ...item, displayName }
                                    : item,
                                ),
                              );
                            }}
                            onBlur={() => {
                              if (!siteId || !activeSession) return;
                              const displayName =
                                activeSession.displayName.trim();
                              if (!displayName) return;
                              void api
                                .updateAgentSession({
                                  siteId,
                                  sessionId: activeSession.id,
                                  displayName,
                                })
                                .then(() => loadSessions(siteId));
                            }}
                          />
                        </label>
                        <div className="agent-switcher-actions">
                          <button
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
                        </div>
                      </div>
                    )}
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
                        <Dialog.Title>Agent 设置</Dialog.Title>
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
                          aria-label="Agent 全局默认模式"
                          value={preferenceDefaults.global ?? 'approval'}
                          onChange={(event) => {
                            if (!siteId) return;
                            void api
                              .updateAgentPreferenceDefaults({
                                siteId,
                                scope: 'global',
                                mode: event.target.value as
                                  | 'approval'
                                  | 'yolo',
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
                          aria-label="Agent 当前站点默认模式"
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
                            {entry.status === 'running' ? '正在调用' : '已调用'}{' '}
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
                        data-role={entry.type === 'user' ? 'user' : 'assistant'}
                        className={
                          entry.type === 'assistant' && entry.streaming
                            ? 'is-streaming'
                            : undefined
                        }
                      >
                        <span>
                          {entry.type === 'assistant'
                            ? entry.streaming
                              ? 'Agent · 正在回答'
                              : 'Agent'
                            : '你'}
                        </span>
                        {entry.type === 'user' && entry.chips.length > 0 ? (
                          <div className="agent-history-chips">
                            {entry.chips.map((chip) =>
                              chip.kind === 'attachment' ? (
                                <AttachmentCard
                                  key={`${entry.id}-${chip.label}`}
                                  chip={chip}
                                  {...(attachmentHref(chip.attachmentId)
                                    ? {
                                        href: attachmentHref(chip.attachmentId),
                                        downloadHref: attachmentHref(
                                          chip.attachmentId,
                                          true,
                                        ),
                                      }
                                    : {})}
                                />
                              ) : (
                                <em key={`${entry.id}-${chip.label}`}>
                                  {chip.label}
                                </em>
                              ),
                            )}
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
                        Agent 可以阅读与修改当前 Site
                        的文件；页面只提供本次对话上下文。
                      </p>
                    </div>
                  ) : null}
                  <div ref={historyEnd} />
                </div>

                {(details?.approvals ?? [])
                  .filter((approval) => approval.approvalDecision === 'pending')
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
                  <div className="agent-contexts" aria-label="本次消息上下文">
                    {includeSelection && selectionContext ? (
                      <ContextChip
                        label={`选区 · L${selectionContext.startLine}–${selectionContext.endLine}`}
                        details={selectionContext.text}
                        onRemove={() => setIncludeSelection(false)}
                      />
                    ) : null}
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
                            items.filter((item) => item.id !== attachment.id),
                          )
                        }
                      />
                    ))}
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
                  <textarea
                    aria-label="发送给 Site Agent"
                    placeholder="告诉 Agent 要检查、修改或解释什么…"
                    rows={4}
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    onKeyDown={(event) => {
                      if (
                        (event.metaKey || event.ctrlKey) &&
                        event.key === 'Enter'
                      ) {
                        event.preventDefault();
                        void send();
                      }
                    }}
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
                              setAttachments((items) => [...items, attachment]),
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
                        disabled={busy || !text.trim()}
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
                <p>
                  先新建或选择一个会话。打开文章时默认挂到当前文章，能力仍覆盖整个站点。
                </p>
              </div>
            )}

            {error ? (
              <p className="agent-error" role="alert">
                {error}
              </p>
            ) : null}
          </motion.aside>
        ) : null}
      </AnimatePresence>
    </>
  );
}
