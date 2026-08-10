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

interface AgentPanelProps {
  readonly api: StudioApi;
  readonly siteId?: string;
  readonly siteName?: string;
  readonly articleContext?: Extract<AgentMessageContext, { type: 'article' }>;
  readonly editorBufferContext?: Extract<
    AgentMessageContext,
    { type: 'editor-buffer' }
  >;
  readonly selectionContext?: Extract<
    AgentMessageContext,
    { type: 'markdown-selection' }
  >;
  readonly openRequest: number;
  readonly onSelectionConsumed: () => void;
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
  editorBufferContext,
  selectionContext,
  openRequest,
  onSelectionConsumed,
}: AgentPanelProps) {
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<readonly AgentSessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState('');
  const [details, setDetails] = useState<AgentSessionDetails>();
  const [preferenceDefaults, setPreferenceDefaults] =
    useState<AgentPreferenceDefaults>({ global: null, site: null });
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [includeArticle, setIncludeArticle] = useState(true);
  const [includeBuffer, setIncludeBuffer] = useState(false);
  const [includeSelection, setIncludeSelection] = useState(false);
  const [attachments, setAttachments] = useState<
    readonly AgentAttachmentSummary[]
  >([]);
  const [liveText, setLiveText] = useState('');
  const eventSource = useRef<EventSource | undefined>(undefined);
  const cursor = useRef(0);

  const activeSession = sessions.find((item) => item.id === activeSessionId);
  const activeTurn = [...(details?.turns ?? [])]
    .reverse()
    .find((turn) => activeTurnStates.has(turn.status));
  const latestTurn = details?.turns.at(-1);

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
    setIncludeArticle(true);
    setIncludeBuffer(false);
    setIncludeSelection(false);
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

  useEffect(
    () => () => {
      eventSource.current?.close();
    },
    [],
  );

  const contexts = useMemo(() => {
    const result: AgentMessageContext[] = [];
    if (includeArticle && articleContext) result.push(articleContext);
    if (includeBuffer && editorBufferContext) result.push(editorBufferContext);
    if (includeSelection && selectionContext) result.push(selectionContext);
    return result;
  }, [
    articleContext,
    editorBufferContext,
    includeArticle,
    includeBuffer,
    includeSelection,
    selectionContext,
  ]);

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
          readonly payload?: { readonly role?: string; readonly text?: string };
        };
        if (typeof value.sequence === 'number') cursor.current = value.sequence;
        if (value.payload?.role === 'assistant' && value.payload.text) {
          setLiveText(value.payload.text);
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
      setIncludeBuffer(false);
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

  return (
    <>
      <button
        className="agent-launcher"
        type="button"
        aria-expanded={open}
        aria-controls="site-agent-panel"
        disabled={!siteId}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">✦</span>
        Agent
      </button>
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
              <div>
                <span>SITE AGENT</span>
                <strong>{siteName ?? '选择一个站点'}</strong>
              </div>
              <button
                type="button"
                aria-label="关闭 Agent"
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </header>

            <div className="agent-session-bar">
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
              <button
                type="button"
                disabled={busy || !siteId}
                onClick={() => void createSession()}
              >
                新建
              </button>
              <button
                type="button"
                disabled={!activeSession || activeSession.state === 'archived'}
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
                <div className="agent-mode-row">
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
                  <small>
                    {details?.effectiveApproval.source ?? 'default'} ·
                    全站工作区
                  </small>
                </div>
                {latestTurn ? (
                  <p
                    className="agent-turn-state"
                    data-state={latestTurn.status}
                    role="status"
                  >
                    本轮：{turnLabels[latestTurn.status]}
                    {latestTurn.errorCode ? ` · ${latestTurn.errorCode}` : ''}
                  </p>
                ) : null}
                <details className="agent-mode-defaults">
                  <summary>默认模式与持久化层级</summary>
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

                <div className="agent-history" aria-live="polite">
                  {(details?.history ?? []).map((entry) => (
                    <article key={entry.id} data-role={entry.role}>
                      <span>
                        {entry.role === 'assistant'
                          ? 'Agent'
                          : entry.role === 'user'
                            ? '你'
                            : 'Context'}
                      </span>
                      <p>{entry.text ?? `图片 × ${entry.imageCount ?? 0}`}</p>
                    </article>
                  ))}
                  {liveText ? (
                    <article data-role="assistant" className="is-streaming">
                      <span>Agent · 正在回答</span>
                      <p>{liveText}</p>
                    </article>
                  ) : null}
                  {(details?.history.length ?? 0) === 0 && !liveText ? (
                    <div className="agent-empty">
                      <b>从整个站点开始。</b>
                      <p>
                        Agent 可以阅读与修改当前 Site
                        的文件；页面只提供本次对话上下文。
                      </p>
                    </div>
                  ) : null}
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
                    {includeBuffer && editorBufferContext ? (
                      <ContextChip
                        label="未保存编辑缓冲"
                        details={`${editorBufferContext.body.length} 字符 · revision ${editorBufferContext.sourceRevision}`}
                        onRemove={() => setIncludeBuffer(false)}
                      />
                    ) : editorBufferContext ? (
                      <button
                        type="button"
                        onClick={() => setIncludeBuffer(true)}
                      >
                        ＋ 编辑缓冲
                      </button>
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
                <p>新建一个会话；它会跟随当前 Site，而不是当前页面。</p>
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
