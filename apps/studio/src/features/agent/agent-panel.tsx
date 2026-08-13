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
import { presentAgentHistory, type PresentedTool } from './agent-history.js';

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

export function AgentPanel({
  api,
  siteId,
  siteName,
  articleContext,
  selectionContext,
  openRequest,
  onSelectionConsumed,
  onWorkspaceChanged,
}: AgentPanelProps) {
  const [open, setOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [sessions, setSessions] = useState<readonly AgentSessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState('');
  const [details, setDetails] = useState<AgentSessionDetails>();
  const [preferenceDefaults, setPreferenceDefaults] =
    useState<AgentPreferenceDefaults>({ global: null, site: null });
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [includeArticle, setIncludeArticle] = useState(true);
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

  const presented = useMemo(
    () =>
      presentAgentHistory({
        history: details?.history ?? [],
        attachments: details?.attachments ?? attachments,
        liveTools,
        liveText,
      }),
    [attachments, details, liveText, liveTools],
  );

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
    if (openRequest > 0) setOpen(true);
  }, [openRequest]);

  useEffect(() => {
    eventSource.current?.close();
    setDetails(undefined);
    setAttachments([]);
    setLiveTools([]);
    setLiveText('');
    setIncludeArticle(true);
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
  }, [api, siteId]);

  useEffect(() => {
    if (!siteId || !activeSessionId) return;
    window.sessionStorage.setItem(sessionStorageKey(siteId), activeSessionId);
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
    setIncludeArticle(true);
  }, [articleContext?.documentId]);

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
    if (includeArticle && articleContext) result.push(articleContext);
    if (includeSelection && selectionContext) result.push(selectionContext);
    return result;
  }, [articleContext, includeArticle, includeSelection, selectionContext]);

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
        displayName: `写作会话 ${sessions.length + 1}`,
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

  return (
    <>
      {open ? null : (
        <button
          className="agent-launcher"
          type="button"
          aria-expanded={open}
          aria-controls="site-agent-panel"
          disabled={!siteId}
          onClick={() => setOpen(true)}
        >
          <span aria-hidden="true">✦</span>
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
                  type="button"
                  aria-expanded={switcherOpen}
                  onClick={() => setSwitcherOpen((value) => !value)}
                >
                  切换会话
                </button>
                <button
                  type="button"
                  aria-label="关闭 Agent"
                  onClick={() => {
                    setSwitcherOpen(false);
                    setOpen(false);
                  }}
                >
                  ×
                </button>
              </div>
            </header>

            {switcherOpen ? (
              <div className="agent-switcher">
                <select
                  aria-label="Agent Session"
                  value={activeSessionId}
                  onChange={(event) => setActiveSessionId(event.target.value)}
                >
                  <option value="">选择 Session</option>
                  {sessions.map((session) => (
                    <option key={session.id} value={session.id}>
                      {session.state === 'archived' ? '〔已归档〕' : ''}
                      {session.displayName}
                    </option>
                  ))}
                </select>
                <div className="agent-switcher-actions">
                  <button
                    type="button"
                    disabled={busy || !siteId}
                    onClick={() => void createSession()}
                  >
                    新建
                  </button>
                  <button
                    type="button"
                    disabled={
                      !activeSession || activeSession.state === 'archived'
                    }
                    onClick={() => {
                      if (!siteId || !activeSession) return;
                      const displayName = window.prompt(
                        'Session 名称',
                        activeSession.displayName,
                      );
                      if (!displayName?.trim()) return;
                      void api
                        .updateAgentSession({
                          siteId,
                          sessionId: activeSession.id,
                          displayName,
                        })
                        .then(() => loadSessions(siteId));
                    }}
                  >
                    改名
                  </button>
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
                {activeSessionId ? (
                  <label>
                    执行模式
                    <select
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
                      <option value="inherit">跟随站点 / 全局</option>
                      <option value="approval">每次审批</option>
                      <option value="yolo">YOLO</option>
                    </select>
                  </label>
                ) : null}
                <details className="agent-mode-defaults">
                  <summary>默认模式</summary>
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
                            mode: event.target.value as 'approval' | 'yolo',
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
                </details>
                {details?.effectiveApproval.mode === 'yolo' ? (
                  <p className="agent-yolo-warning">
                    YOLO 仍受路径与工具边界保护，但删除未跟踪文件可能无法由
                    Studio 恢复。
                  </p>
                ) : null}
              </div>
            ) : null}

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
                    if (entry.type === 'tool') {
                      return (
                        <details
                          className="agent-tool"
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
                            {entry.chips.map((chip) => (
                              <em key={`${entry.id}-${chip.label}`}>
                                {chip.label}
                              </em>
                            ))}
                          </div>
                        ) : null}
                        {entry.text ? <p>{entry.text}</p> : null}
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

                {activeTurn ? (
                  <p
                    className="agent-turn-state"
                    data-state={activeTurn.status}
                    role="status"
                  >
                    {turnLabels[activeTurn.status]}
                    {activeTurn.errorCode ? ` · ${activeTurn.errorCode}` : ''}
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
                    {includeArticle && articleContext ? (
                      <ContextChip
                        label={`文章 · ${articleContext.title ?? articleContext.documentId}`}
                        details={`${articleContext.collectionId} · ${articleContext.path ?? articleContext.documentId}`}
                        onRemove={() => setIncludeArticle(false)}
                      />
                    ) : articleContext ? (
                      <button
                        type="button"
                        onClick={() => setIncludeArticle(true)}
                      >
                        ＋ 当前文章
                      </button>
                    ) : null}
                    {includeSelection && selectionContext ? (
                      <ContextChip
                        label={`选区 · L${selectionContext.startLine}–${selectionContext.endLine}`}
                        details={selectionContext.text}
                        onRemove={() => setIncludeSelection(false)}
                      />
                    ) : null}
                    {attachments.map((attachment) => (
                      <ContextChip
                        key={attachment.id}
                        label={`附件 · ${attachment.filename}`}
                        details={`${attachment.mimeType} · ${attachment.byteSize} bytes · ${attachment.status}`}
                        onRemove={() =>
                          setAttachments((items) =>
                            items.filter((item) => item.id !== attachment.id),
                          )
                        }
                      />
                    ))}
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
                      附件
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,application/pdf,text/plain,application/zip"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (!file || !siteId) return;
                          setBusy(true);
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
                            .finally(() => setBusy(false));
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
                <b>还没有 Session</b>
                <p>
                  点右上角「切换会话」新建一个；它会跟随当前
                  Site，而不是当前页面。
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
