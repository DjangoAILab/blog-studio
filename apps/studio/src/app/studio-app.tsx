import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  csrfFromCookie,
  StudioApi,
  type DocumentPayload,
  type DocumentSummary,
  type ReleaseDetails,
  type ReleaseStatus,
  type WorkspaceSummary,
} from './api.js';

type SaveState =
  'clean' | 'changed' | 'saving' | 'saved' | 'error' | 'conflict';
type PreviewState = 'idle' | 'building' | 'ready' | 'error';
interface AssetUpload {
  readonly id: string;
  readonly file: File;
  readonly previewUrl: string;
  readonly state: 'uploading' | 'ready' | 'error';
  readonly error?: string;
}
const VisualEditor = lazy(async () => {
  const module = await import('../features/editor/visual-editor.js');
  return { default: module.VisualEditor };
});

const terminalReleaseStatuses = new Set<ReleaseStatus>([
  'succeeded',
  'failed',
  'rolled-back',
  'canceled',
]);

const releaseLabels: Readonly<Record<ReleaseStatus, string>> = {
  queued: '等待发布',
  preflight: '环境检查',
  building: '生成站点',
  planning: '计算差异',
  'uploading-assets': '上传资源',
  'uploading-pages': '切换页面',
  'invalidating-cache': '刷新缓存',
  verifying: '公网验证',
  succeeded: '发布成功',
  failed: '发布失败',
  'rollback-required': '需要回滚',
  'rolling-back': '正在回滚',
  'rolled-back': '已安全回滚',
  canceled: '已取消',
};

function Login({
  onLogin,
}: {
  readonly onLogin: (token: string) => Promise<void>;
}) {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  return (
    <main className="login-shell">
      <div className="login-mark" aria-hidden="true">
        文
      </div>
      <form
        className="login-card"
        onSubmit={(event) => {
          event.preventDefault();
          setError('');
          void onLogin(token).catch((reason: unknown) => {
            setError(reason instanceof Error ? reason.message : '登录失败');
          });
        }}
      >
        <p className="eyebrow">SELF-HOSTED WRITING ROOM</p>
        <h1>回到文章本身。</h1>
        <p>一个安静、可靠的发布工作台。你的内容仍然属于文件与 Git。</p>
        <label>
          访问口令
          <input
            autoComplete="current-password"
            autoFocus
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
        </label>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <button className="primary-button" type="submit">
          进入 Studio →
        </button>
      </form>
    </main>
  );
}

function SaveBadge({ state }: { readonly state: SaveState }) {
  const labels: Record<SaveState, string> = {
    clean: '已同步',
    changed: '等待保存',
    saving: '保存中…',
    saved: '刚刚保存',
    error: '保存失败',
    conflict: '发现冲突',
  };
  return (
    <span className={`save-badge save-${state}`}>
      <i />
      {labels[state]}
    </span>
  );
}

export function StudioApp() {
  const api = useMemo(() => new StudioApi(csrfFromCookie()), []);
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [workspaces, setWorkspaces] = useState<readonly WorkspaceSummary[]>([]);
  const [workspace, setWorkspace] = useState<WorkspaceSummary>();
  const [documents, setDocuments] = useState<readonly DocumentSummary[]>([]);
  const [selected, setSelected] = useState<DocumentSummary>();
  const [document, setDocument] = useState<DocumentPayload>();
  const [loadedDocumentId, setLoadedDocumentId] = useState('');
  const [body, setBody] = useState('');
  const [title, setTitle] = useState('');
  const [frontMatter, setFrontMatter] = useState<
    Readonly<Record<string, unknown>>
  >({});
  const [version, setVersion] = useState(0);
  const [mode, setMode] = useState<'visual' | 'source'>('visual');
  const [saveState, setSaveState] = useState<SaveState>('clean');
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewState, setPreviewState] = useState<PreviewState>('idle');
  const [previewError, setPreviewError] = useState('');
  const [panel, setPanel] = useState<'library' | 'write' | 'preview'>('write');
  const [uploads, setUploads] = useState<readonly AssetUpload[]>([]);
  const [release, setRelease] = useState<ReleaseDetails>();
  const [releaseError, setReleaseError] = useState('');
  const assetInput = useRef<HTMLInputElement>(null);

  function uploadAsset(file: File): void {
    if (!workspace || !selected || !file.type.startsWith('image/')) return;
    const id = crypto.randomUUID();
    const previewUrl = URL.createObjectURL(file);
    setUploads((items) => [
      ...items,
      { id, file, previewUrl, state: 'uploading' },
    ]);
    void api
      .uploadAsset({
        workspaceId: workspace.id,
        documentId: selected.ref.documentId,
        collection: selected.ref.collectionId,
        file,
      })
      .then(({ asset }) => {
        URL.revokeObjectURL(previewUrl);
        setUploads((items) =>
          items.map((item) =>
            item.id === id
              ? { ...item, previewUrl: asset.publicUrl, state: 'ready' }
              : item,
          ),
        );
        const alt = file.name.replace(/\.[^.]+$/, '') || 'image';
        setBody(
          (value) =>
            `${value.replace(/\s*$/, '')}\n\n![${alt}](${asset.publicUrl})\n`,
        );
        setSaveState('changed');
      })
      .catch((reason: unknown) => {
        setUploads((items) =>
          items.map((item) =>
            item.id === id
              ? {
                  ...item,
                  state: 'error',
                  error:
                    reason instanceof Error ? reason.message : '图片上传失败',
                }
              : item,
          ),
        );
      });
  }

  async function loadWorkspaces(): Promise<void> {
    try {
      const result = await api.workspaces();
      setWorkspaces(result.workspaces);
      setWorkspace(result.workspaces[0]);
      setAuthenticated(true);
    } catch {
      setAuthenticated(false);
    }
  }

  useEffect(() => {
    void loadWorkspaces();
  }, []);
  useEffect(() => {
    if (!workspace) return;
    void Promise.all([
      api.documents(workspace.id),
      api.releases(workspace.id),
    ]).then(([documentResult, releaseResult]) => {
      setDocuments(documentResult.documents);
      setSelected(documentResult.documents[0]);
      setRelease(releaseResult.releases[0]);
    });
  }, [api, workspace]);
  useEffect(() => {
    if (!workspace || !selected) return;
    let cancelled = false;
    setDocument(undefined);
    setLoadedDocumentId('');
    setPreviewUrl('');
    setPreviewState('idle');
    setPreviewError('');
    setUploads((items) => {
      for (const item of items)
        if (item.previewUrl.startsWith('blob:'))
          URL.revokeObjectURL(item.previewUrl);
      return [];
    });
    void api
      .document(
        workspace.id,
        selected.ref.documentId,
        selected.ref.collectionId,
      )
      .then((result) => {
        if (cancelled) return;
        setDocument(result);
        setLoadedDocumentId(selected.ref.documentId);
        const nextBody = result.draft?.body ?? result.source.body;
        setBody(nextBody);
        setMode(/\{%[\s\S]*?%\}/.test(nextBody) ? 'source' : 'visual');
        const matter = result.draft?.frontMatter ?? result.source.frontMatter;
        setFrontMatter(matter);
        setTitle(
          typeof matter.title === 'string' ? matter.title : selected.title,
        );
        setVersion(result.draft?.version ?? 0);
        setSaveState('clean');
      });
    return () => {
      cancelled = true;
    };
  }, [api, selected, workspace]);

  useEffect(() => {
    if (
      !workspace ||
      !release ||
      terminalReleaseStatuses.has(release.release.status)
    )
      return;
    const timer = window.setInterval(() => {
      void api
        .release(workspace.id, release.release.id)
        .then((next) => {
          const becameTerminal = terminalReleaseStatuses.has(
            next.release.status,
          );
          setRelease(next);
          if (becameTerminal && selected) {
            void api
              .document(
                workspace.id,
                selected.ref.documentId,
                selected.ref.collectionId,
              )
              .then((result) => {
                setDocument(result);
                setLoadedDocumentId(selected.ref.documentId);
                setBody(result.draft?.body ?? result.source.body);
                const matter =
                  result.draft?.frontMatter ?? result.source.frontMatter;
                setFrontMatter(matter);
                setTitle(
                  typeof matter.title === 'string'
                    ? matter.title
                    : selected.title,
                );
                setVersion(result.draft?.version ?? 0);
                setSaveState('clean');
              });
          }
        })
        .catch((reason: unknown) =>
          setReleaseError(
            reason instanceof Error ? reason.message : '发布状态读取失败',
          ),
        );
    }, 800);
    return () => window.clearInterval(timer);
  }, [api, release, selected, workspace]);

  useEffect(() => {
    if (
      saveState !== 'changed' ||
      !workspace ||
      !selected ||
      !document ||
      loadedDocumentId !== selected.ref.documentId
    )
      return;
    const timer = window.setTimeout(() => {
      setSaveState('saving');
      void api
        .saveDraft({
          workspaceId: workspace.id,
          documentId: selected.ref.documentId,
          collection: selected.ref.collectionId,
          expectedVersion: version,
          sourceRevision: document.source.revision,
          frontMatter: { ...frontMatter, title },
          body,
        })
        .then((result) => {
          setVersion(result.draft.version);
          setSaveState('saved');
        })
        .catch((reason: unknown) => {
          setSaveState(
            reason instanceof Error && /conflict/i.test(reason.message)
              ? 'conflict'
              : 'error',
          );
        });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [
    api,
    body,
    document,
    frontMatter,
    loadedDocumentId,
    saveState,
    selected,
    title,
    version,
    workspace,
  ]);

  if (authenticated === null)
    return <div className="boot-screen">BLOG / STUDIO</div>;
  if (!authenticated)
    return (
      <Login
        onLogin={async (token) => {
          await api.login(token);
          await loadWorkspaces();
        }}
      />
    );

  return (
    <div className="studio-shell">
      <header className="topbar">
        <div className="wordmark">
          <b>BLOG</b>
          <span>/</span>STUDIO
        </div>
        <div className="workspace-switcher">
          <span className="live-dot" />
          <select
            aria-label="当前工作区"
            value={workspace?.id}
            onChange={(event) =>
              setWorkspace(
                workspaces.find((item) => item.id === event.target.value),
              )
            }
          >
            {workspaces.map((item) => (
              <option key={item.id}>{item.id}</option>
            ))}
          </select>
          <small>{workspace?.generator}</small>
        </div>
        <SaveBadge state={saveState} />
        <button
          className="publish-button"
          disabled={
            !workspace?.publishTarget.configured ||
            !selected ||
            ['changed', 'saving', 'error', 'conflict'].includes(saveState) ||
            (release !== undefined &&
              !terminalReleaseStatuses.has(release.release.status))
          }
          title={
            workspace?.publishTarget.configured
              ? '发布当前已保存文章与站点变更'
              : '管理员尚未配置发布目标'
          }
          onClick={() => {
            if (!workspace || !selected) return;
            setPanel('preview');
            setReleaseError('');
            void api
              .startRelease({
                workspaceId: workspace.id,
                targetId: workspace.publishTarget.id,
                ...(version > 0
                  ? {
                      draft: {
                        collectionId: selected.ref.collectionId,
                        documentId: selected.ref.documentId,
                        version,
                      },
                    }
                  : {}),
              })
              .then(setRelease)
              .catch((reason: unknown) =>
                setReleaseError(
                  reason instanceof Error ? reason.message : '发布启动失败',
                ),
              );
          }}
        >
          {release && !terminalReleaseStatuses.has(release.release.status)
            ? `${releaseLabels[release.release.status]}…`
            : '发布文章 →'}
        </button>
        <button
          className="preview-button"
          disabled={!workspace || !selected}
          onClick={() => {
            if (!workspace || !selected) return;
            setPanel('preview');
            setPreviewState('building');
            setPreviewError('');
            void api
              .startPreview(
                workspace.id,
                selected.ref.documentId,
                selected.ref.collectionId,
              )
              .then(({ preview }) => {
                setPreviewUrl(preview.url);
                setPreviewState('ready');
              })
              .catch((reason: unknown) => {
                setPreviewUrl('');
                setPreviewState('error');
                setPreviewError(
                  reason instanceof Error ? reason.message : '预览生成失败',
                );
              });
          }}
        >
          预览全文 ↗
        </button>
      </header>

      <nav className="mobile-nav" aria-label="工作区面板">
        {(['library', 'write', 'preview'] as const).map((item) => (
          <button
            className={panel === item ? 'active' : ''}
            key={item}
            onClick={() => setPanel(item)}
          >
            {{ library: '文章', write: '写作', preview: '预览' }[item]}
          </button>
        ))}
      </nav>

      <div className="workspace-grid">
        <aside className={`library-panel mobile-${panel}`}>
          <div className="panel-heading">
            <p>LIBRARY</p>
            <button aria-label="新建文章">＋</button>
          </div>
          <label className="search-box">
            <span>⌕</span>
            <input placeholder="搜索文章" />
          </label>
          <div className="collection-label">
            <span>已发布</span>
            <b>{documents.length}</b>
          </div>
          <ol className="document-list">
            {documents.map((item) => (
              <li key={item.ref.documentId}>
                <button
                  className={
                    item.ref.documentId === selected?.ref.documentId
                      ? 'selected'
                      : ''
                  }
                  onClick={() => {
                    setSelected(item);
                    setPanel('write');
                  }}
                >
                  <span>{item.title}</span>
                  <small>
                    {item.updatedAt
                      ? new Date(item.updatedAt).toLocaleDateString('zh-CN')
                      : item.state}
                  </small>
                </button>
              </li>
            ))}
          </ol>
        </aside>

        <main className={`writing-panel mobile-${panel}`}>
          <div className="document-kicker">
            <span>文章</span>
            <i />
            {selected?.state === 'draft' ? '草稿' : '已发布'}
          </div>
          <textarea
            className="title-input"
            aria-label="文章标题"
            rows={1}
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              setSaveState('changed');
            }}
            placeholder="无标题文章"
          />
          <div className="editor-actions">
            <div className="mode-switch" role="group" aria-label="编辑模式">
              <button
                className={mode === 'visual' ? 'active' : ''}
                onClick={() => setMode('visual')}
              >
                所见即所得
              </button>
              <button
                className={mode === 'source' ? 'active' : ''}
                onClick={() => setMode('source')}
              >
                Markdown 源码
              </button>
            </div>
            <button
              className="asset-button"
              onClick={() => assetInput.current?.click()}
            >
              插入图片 ＋
            </button>
            <input
              ref={assetInput}
              hidden
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) uploadAsset(file);
                event.target.value = '';
              }}
            />
          </div>
          {uploads.length ? (
            <div className="asset-uploads" aria-live="polite">
              {uploads.slice(-3).map((upload) => (
                <div
                  className={`asset-upload asset-${upload.state}`}
                  key={upload.id}
                >
                  <img alt="" src={upload.previewUrl} />
                  <span>
                    <b>{upload.file.name}</b>
                    <small>
                      {upload.state === 'uploading'
                        ? '处理中并上传…'
                        : upload.state === 'ready'
                          ? '已插入文章'
                          : upload.error}
                    </small>
                  </span>
                  {upload.state === 'error' ? (
                    <button
                      onClick={() => {
                        setUploads((items) =>
                          items.filter((item) => item.id !== upload.id),
                        );
                        URL.revokeObjectURL(upload.previewUrl);
                        uploadAsset(upload.file);
                      }}
                    >
                      重试
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
          <section
            className="editor-paper"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const file = [...event.dataTransfer.files].find((item) =>
                item.type.startsWith('image/'),
              );
              if (file) uploadAsset(file);
            }}
            onPaste={(event) => {
              const file = [...event.clipboardData.files].find((item) =>
                item.type.startsWith('image/'),
              );
              if (file) {
                event.preventDefault();
                uploadAsset(file);
              }
            }}
          >
            {(!document || loadedDocumentId !== selected?.ref.documentId) && (
              <div className="editor-loading">正在读取文章…</div>
            )}
            {document &&
            loadedDocumentId === selected?.ref.documentId &&
            mode === 'visual' ? (
              <Suspense
                fallback={<div className="editor-loading">正在铺开稿纸…</div>}
              >
                <VisualEditor
                  key={`${selected?.ref.documentId}-${mode}`}
                  markdown={body}
                  resolveImageSource={(source) =>
                    `/api/workspaces/${workspace?.id}/documents/${selected?.ref.documentId}/legacy-asset?collection=${selected?.ref.collectionId}&source=${encodeURIComponent(source)}`
                  }
                  onChange={(value) => {
                    setBody(value);
                    setSaveState('changed');
                  }}
                />
              </Suspense>
            ) : document && loadedDocumentId === selected?.ref.documentId ? (
              <textarea
                className="source-editor"
                aria-label="Markdown 源码"
                value={body}
                onChange={(event) => {
                  setBody(event.target.value);
                  setSaveState('changed');
                }}
              />
            ) : null}
          </section>
        </main>

        <aside className={`preview-panel mobile-${panel}`}>
          <div className="panel-heading">
            <p>{release ? 'RELEASE PROOF' : 'LIVE PROOF'}</p>
            <span>
              {release
                ? releaseLabels[release.release.status]
                : previewState.toUpperCase()}
            </span>
          </div>
          {release ? (
            <div className="release-proof" aria-live="polite">
              <div
                className={`release-summary release-${release.release.status}`}
              >
                <span>
                  {release.release.status === 'succeeded' ? '✓' : '◒'}
                </span>
                <div>
                  <small>{release.release.targetId}</small>
                  <h2>{releaseLabels[release.release.status]}</h2>
                  <p>{release.release.id}</p>
                </div>
              </div>
              <ol className="release-timeline">
                {release.release.stages.map((stage) => (
                  <li className={`stage-${stage.status}`} key={stage.name}>
                    <i />
                    <span>
                      <b>
                        {releaseLabels[stage.name as ReleaseStatus] ??
                          stage.name}
                      </b>
                      <small>{stage.status}</small>
                    </span>
                  </li>
                ))}
              </ol>
              {release.events.length ? (
                <div className="release-log">
                  {release.events.slice(-5).map((event, index) => (
                    <p key={`${event.at}-${index}`}>
                      <time>
                        {new Date(event.at).toLocaleTimeString('zh-CN')}
                      </time>
                      {event.message}
                    </p>
                  ))}
                </div>
              ) : null}
              {releaseError ? (
                <p className="form-error">{releaseError}</p>
              ) : null}
              <div className="release-controls">
                {!terminalReleaseStatuses.has(release.release.status) &&
                !['rollback-required', 'rolling-back'].includes(
                  release.release.status,
                ) ? (
                  <button
                    onClick={() => {
                      if (!workspace) return;
                      void api
                        .cancelRelease(workspace.id, release.release.id)
                        .then(setRelease)
                        .catch((reason: unknown) =>
                          setReleaseError(
                            reason instanceof Error
                              ? reason.message
                              : '取消发布失败',
                          ),
                        );
                    }}
                  >
                    取消发布
                  </button>
                ) : null}
                {release.release.status === 'succeeded' && workspace ? (
                  <button
                    className="danger-control"
                    onClick={() => {
                      setReleaseError('');
                      void api
                        .rollbackRelease(workspace.id, release.release.id)
                        .then(setRelease)
                        .catch((reason: unknown) =>
                          setReleaseError(
                            reason instanceof Error
                              ? reason.message
                              : '回滚启动失败',
                          ),
                        );
                    }}
                  >
                    回滚线上版本
                  </button>
                ) : null}
                {terminalReleaseStatuses.has(release.release.status) ? (
                  <button onClick={() => setRelease(undefined)}>
                    返回真实预览
                  </button>
                ) : null}
              </div>
            </div>
          ) : previewUrl ? (
            <iframe title="文章真实预览" sandbox="" src={previewUrl} />
          ) : (
            <div className="preview-empty" aria-live="polite">
              <span>{previewState === 'building' ? '◒' : '◌'}</span>
              <h2>
                {previewState === 'building'
                  ? '正在生成真实页面'
                  : previewState === 'error'
                    ? '预览生成失败'
                    : '真实主题预览'}
              </h2>
              <p>
                {previewState === 'error'
                  ? previewError
                  : previewState === 'building'
                    ? '正在隔离副本中应用草稿并运行站点生成器…'
                    : '运行站点生成器后，在隔离画布中检查最终页面。'}
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
