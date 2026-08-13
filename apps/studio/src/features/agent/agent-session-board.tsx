import type { AgentSessionSummary, ContentSummary } from '../../app/api.js';

interface AgentSessionBoardProps {
  readonly sessions: readonly AgentSessionSummary[];
  readonly articles: readonly ContentSummary[];
  readonly loading: boolean;
  readonly onOpenSession: (sessionId: string) => void;
  readonly onCreateSession: () => void;
}

function articleTitle(
  session: AgentSessionSummary,
  articles: readonly ContentSummary[],
): string {
  if (!session.documentId) return '全局';
  return (
    articles.find((item) => item.documentId === session.documentId)?.title ??
    '文章'
  );
}

export function AgentSessionBoard({
  sessions,
  articles,
  loading,
  onOpenSession,
  onCreateSession,
}: AgentSessionBoardProps) {
  const active = sessions.filter((item) => item.state === 'active');

  return (
    <section className="studio2-recent" aria-labelledby="agent-sessions">
      <header>
        <div>
          <p>AGENT</p>
          <h2 id="agent-sessions">会话</h2>
        </div>
        <button type="button" onClick={onCreateSession}>
          新建会话
          <span aria-hidden="true">+</span>
        </button>
      </header>
      <div className="studio2-content-group">
        {loading ? (
          <div className="studio2-list-state" role="status">
            <span className="studio2-loading-orb" />
            正在读取会话…
          </div>
        ) : active.length === 0 ? (
          <div className="studio2-list-state">
            <b>还没有会话</b>
            <span>大多数改写都挂在单篇文章上；首页也可以开一个全局会话。</span>
          </div>
        ) : (
          <ol>
            {active.map((session) => {
              const bound = Boolean(session.documentId);
              return (
                <li key={session.id}>
                  <div className="studio2-article-row">
                    <button
                      className="studio2-article-open"
                      type="button"
                      onClick={() => onOpenSession(session.id)}
                    >
                      <span
                        className={`studio2-session-mark ${bound ? 'is-article' : 'is-global'}`}
                        aria-hidden="true"
                      >
                        {bound ? '文' : '站'}
                      </span>
                      <span className="studio2-article-copy">
                        <strong>{session.displayName}</strong>
                        <small>
                          <b
                            className={`studio2-session-tag ${bound ? 'is-article' : 'is-global'}`}
                          >
                            {bound ? '文章' : '全局'}
                          </b>
                          {bound ? articleTitle(session, articles) : '站点级'}
                        </small>
                      </span>
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
