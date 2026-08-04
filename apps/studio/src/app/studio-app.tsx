import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  csrfFromCookie,
  StudioApi,
  type DocumentPayload,
  type DocumentSummary,
  type OrphanAssetPlan,
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
const VisualEditor = lazy(() =>
  import('../features/editor/visual-editor.js').then((module) => ({
    default: module.VisualEditor,
  })),
);

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
  initialized,
}: {
  readonly onLogin: (password: string) => Promise<void>;
  readonly initialized: boolean;
}) {
  const [password, setPassword] = useState('');
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
          if (!initialized) return;
          void onLogin(password).catch((reason: unknown) => {
            setError(reason instanceof Error ? reason.message : '登录失败');
          });
        }}
      >
        <p className="eyebrow">SELF-HOSTED WRITING ROOM</p>
        <h1>回到文章本身。</h1>
        <p>一个安静、可靠的发布工作台。你的内容仍然属于文件与 Git。</p>
        {initialized ? (
          <label>
            Owner 密码
            <input
              autoComplete="current-password"
              autoFocus
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
        ) : (
          <div className="setup-notice" role="status">
            <b>需要先在可信终端设置 Owner 密码</b>
            <p>浏览器不能领取首次所有权。请在部署主机运行：</p>
            <code>pnpm --filter @blog-studio/studio auth init</code>
            <p>完成后刷新此页面。</p>
          </div>
        )}
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <button
          className="primary-button"
          disabled={!initialized}
          type="submit"
        >
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
  const [ownerInitialized, setOwnerInitialized] = useState<boolean | null>(
    null,
  );
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
  const [creating, setCreating] = useState(false);
  const [createTitle, setCreateTitle] = useState('');
  const [createSlug, setCreateSlug] = useState('');
  const [createError, setCreateError] = useState('');
  const [orphanPlan, setOrphanPlan] = useState<OrphanAssetPlan>();
  const [orphanState, setOrphanState] = useState<
    'idle' | 'loading' | 'ready' | 'deleting' | 'deleted' | 'error'
  >('idle');
  const [orphanError, setOrphanError] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [securityState, setSecurityState] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle');
  const [securityMessage, setSecurityMessage] = useState('');
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
    void api
      .authStatus()
      .then(async (status) => {
        setOwnerInitialized(status.initialized);
        if (status.initialized) await loadWorkspaces();
        else setAuthenticated(false);
      })
      .catch(() => {
        setOwnerInitialized(false);
        setAuthenticated(false);
      });
  }, [api]);
  useEffect(() => {
    if (!workspace) return;
    void Promise.all([
      api.documents(workspace.id, 'posts'),
      api.documents(workspace.id, 'drafts'),
      api.releases(workspace.id),
    ]).then(([postResult, draftResult, releaseResult]) => {
      const nextDocuments = [...draftResult.documents, ...postResult.documents];
      setDocuments(nextDocuments);
      setSelected(nextDocuments[0]);
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
    setOrphanPlan(undefined);
    setOrphanState('idle');
    setOrphanError('');
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
            void loadWorkspaces();
            void Promise.all([
              api.documents(workspace.id, 'posts'),
              api.documents(workspace.id, 'drafts'),
            ]).then(([posts, drafts]) => {
              const nextDocuments = [...drafts.documents, ...posts.documents];
              setDocuments(nextDocuments);
              setSelected(
                nextDocuments.find(
                  (item) => item.ref.documentId === selected.ref.documentId,
                ) ??
                  nextDocuments.find((item) => item.title === title) ??
                  nextDocuments[0],
              );
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

  if (authenticated === null || ownerInitialized === null)
    return <div className="boot-screen">BLOG / STUDIO</div>;
  if (!authenticated)
    return (
      <Login
        initialized={ownerInitialized}
        onLogin={async (password) => {
          await api.login(password);
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
        <details className="security-menu">
          <summary>安全</summary>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setSecurityMessage('');
              if (newPassword !== confirmPassword) {
                setSecurityState('error');
                setSecurityMessage('两次输入的新密码不一致');
                return;
              }
              setSecurityState('saving');
              void api
                .changePassword({ currentPassword, newPassword })
                .then(({ credentialGeneration }) => {
                  setCurrentPassword('');
                  setNewPassword('');
                  setConfirmPassword('');
                  setSecurityState('saved');
                  setSecurityMessage(
                    `密码已更新（凭据版本 ${credentialGeneration}），其他会话已退出`,
                  );
                })
                .catch((reason: unknown) => {
                  setSecurityState('error');
                  setSecurityMessage(
                    reason instanceof Error ? reason.message : '密码更新失败',
                  );
                });
            }}
          >
            <label>
              当前密码
              <input
                autoComplete="current-password"
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </label>
            <label>
              新密码
              <input
                autoComplete="new-password"
                minLength={12}
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </label>
            <label>
              确认新密码
              <input
                autoComplete="new-password"
                minLength={12}
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </label>
            {securityMessage ? (
              <p role={securityState === 'error' ? 'alert' : 'status'}>
                {securityMessage}
              </p>
            ) : null}
            <button disabled={securityState === 'saving'} type="submit">
              {securityState === 'saving' ? '正在更新…' : '更新密码'}
            </button>
            <button
              type="button"
              onClick={() => {
                void api.logout().finally(() => {
                  setAuthenticated(false);
                  setWorkspace(undefined);
                  setWorkspaces([]);
                });
              }}
            >
              退出登录
            </button>
          </form>
        </details>
        <button
          className="publish-button"
          disabled={
            !workspace?.publishTarget.configured ||
            (workspace.publishTarget.baselineAdoption !== 'required' &&
              (!selected ||
                ['changed', 'saving', 'error', 'conflict'].includes(
                  saveState,
                ))) ||
            (release !== undefined &&
              !terminalReleaseStatuses.has(release.release.status))
          }
          title={
            workspace?.publishTarget.baselineAdoption === 'required'
              ? '先逐个校验现有对象，仅写入可验证发布标记'
              : workspace?.publishTarget.configured
                ? '发布当前已保存文章与站点变更'
                : '管理员尚未配置发布目标'
          }
          onClick={() => {
            if (!workspace) return;
            setPanel('preview');
            setReleaseError('');
            if (workspace.publishTarget.baselineAdoption === 'required') {
              const confirmed = window.confirm(
                '接管前会只读下载并校验现有部署，校验完成后仅写入 Blog Studio 发布标记。不会覆盖文章或旧资源。继续吗？',
              );
              if (!confirmed) return;
              void api
                .adoptBaseline(workspace.id, workspace.publishTarget.id)
                .then(setRelease)
                .catch((reason: unknown) =>
                  setReleaseError(
                    reason instanceof Error
                      ? reason.message
                      : '现有部署接管失败',
                  ),
                );
              return;
            }
            if (!selected) return;
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
            : workspace?.publishTarget.baselineAdoption === 'required'
              ? '核验并接管现有站点 →'
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
            {workspace?.canCreateDocuments ? (
              <button
                aria-label="新建文章"
                aria-expanded={creating}
                onClick={() => {
                  setCreating((value) => !value);
                  setCreateError('');
                }}
              >
                {creating ? '×' : '＋'}
              </button>
            ) : null}
          </div>
          {creating && workspace?.canCreateDocuments ? (
            <form
              className="new-document-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!workspace || !createTitle.trim()) return;
                setCreateError('');
                void api
                  .createDocument(workspace.id, {
                    title: createTitle.trim(),
                    ...(createSlug.trim() ? { slug: createSlug.trim() } : {}),
                  })
                  .then(async (created) => {
                    const drafts = await api.documents(workspace.id, 'drafts');
                    const posts = await api.documents(workspace.id, 'posts');
                    const nextDocuments = [
                      ...drafts.documents,
                      ...posts.documents,
                    ];
                    setDocuments(nextDocuments);
                    setSelected(
                      nextDocuments.find(
                        (item) =>
                          item.ref.documentId === created.source.ref.documentId,
                      ),
                    );
                    setCreateTitle('');
                    setCreateSlug('');
                    setCreating(false);
                    setPanel('write');
                  })
                  .catch((reason: unknown) =>
                    setCreateError(
                      reason instanceof Error ? reason.message : '新建草稿失败',
                    ),
                  );
              }}
            >
              <label>
                标题
                <input
                  autoFocus
                  maxLength={200}
                  value={createTitle}
                  onChange={(event) => setCreateTitle(event.target.value)}
                  placeholder="这篇文章讲什么？"
                />
              </label>
              <label>
                Slug <small>可选，英文小写</small>
                <input
                  maxLength={80}
                  pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                  value={createSlug}
                  onChange={(event) => setCreateSlug(event.target.value)}
                  placeholder="my-new-post"
                />
              </label>
              {createError ? (
                <p className="form-error" role="alert">
                  {createError}
                </p>
              ) : null}
              <button className="primary-button" type="submit">
                建立原生草稿
              </button>
            </form>
          ) : null}
          <label className="search-box">
            <span>⌕</span>
            <input placeholder="搜索文章" />
          </label>
          <div className="collection-label">
            <span>原生草稿</span>
            <b>
              {
                documents.filter((item) => item.ref.collectionId === 'drafts')
                  .length
              }
            </b>
          </div>
          <ol className="document-list">
            {documents
              .filter((item) => item.ref.collectionId === 'drafts')
              .map((item) => (
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
          <div className="collection-label">
            <span>已发布</span>
            <b>
              {
                documents.filter((item) => item.ref.collectionId === 'posts')
                  .length
              }
            </b>
          </div>
          <ol className="document-list">
            {documents
              .filter((item) => item.ref.collectionId === 'posts')
              .map((item) => (
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
            <button
              className="asset-maintenance-button"
              disabled={
                !workspace ||
                !selected ||
                !['clean', 'saved'].includes(saveState) ||
                ['loading', 'deleting'].includes(orphanState)
              }
              onClick={() => {
                if (!workspace || !selected) return;
                setOrphanState('loading');
                setOrphanError('');
                void api
                  .orphanAssets({
                    workspaceId: workspace.id,
                    documentId: selected.ref.documentId,
                    collection: selected.ref.collectionId,
                  })
                  .then(({ plan }) => {
                    setOrphanPlan(plan);
                    setOrphanState('ready');
                  })
                  .catch((reason: unknown) => {
                    setOrphanPlan(undefined);
                    setOrphanState('error');
                    setOrphanError(
                      reason instanceof Error ? reason.message : '资源检查失败',
                    );
                  });
              }}
            >
              {orphanState === 'loading' ? '正在检查…' : '检查未引用资源'}
            </button>
            {version > 0 && workspace && selected ? (
              <button
                className="discard-button"
                onClick={() => {
                  if (
                    !window.confirm(
                      '放弃已自动保存的修改并恢复到文件版本？原生 Markdown 文件不会被删除。',
                    )
                  )
                    return;
                  void api
                    .discardDraft({
                      workspaceId: workspace.id,
                      documentId: selected.ref.documentId,
                      collection: selected.ref.collectionId,
                      expectedVersion: version,
                    })
                    .then(async () => {
                      const restored = await api.document(
                        workspace.id,
                        selected.ref.documentId,
                        selected.ref.collectionId,
                      );
                      setDocument(restored);
                      setBody(restored.source.body);
                      setFrontMatter(restored.source.frontMatter);
                      setTitle(
                        typeof restored.source.frontMatter.title === 'string'
                          ? restored.source.frontMatter.title
                          : selected.title,
                      );
                      setVersion(0);
                      setSaveState('clean');
                    })
                    .catch(() => setSaveState('conflict'));
                }}
              >
                放弃修改
              </button>
            ) : null}
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
          {orphanState !== 'idle' ? (
            <div className="orphan-assets" aria-live="polite">
              {orphanState === 'error' ? (
                <p role="alert">{orphanError}</p>
              ) : orphanState === 'deleted' ? (
                <p>未引用资源已删除；旧资源目录没有被扫描或修改。</p>
              ) : orphanPlan ? (
                <>
                  <div>
                    <b>删除预览</b>
                    <span>
                      {orphanPlan.assets.length
                        ? `${orphanPlan.assets.length} 个文章级资源未被当前草稿引用`
                        : '没有发现未引用的文章级资源'}
                    </span>
                  </div>
                  {orphanPlan.assets.length ? (
                    <ul>
                      {orphanPlan.assets.map((asset) => (
                        <li key={asset.id}>
                          <span>{asset.key.split('/').at(-1)}</span>
                          <small>
                            {(asset.byteLength / 1024).toFixed(1)} KiB
                          </small>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {orphanPlan.assets.length ? (
                    <button
                      className="danger-button"
                      disabled={
                        orphanState === 'deleting' ||
                        !['clean', 'saved'].includes(saveState)
                      }
                      onClick={() => {
                        if (!workspace || !selected) return;
                        if (
                          !window.confirm(
                            `永久删除预览中的 ${orphanPlan.assets.length} 个未引用文章资源？此操作不会触及配置的旧资源目录。`,
                          )
                        )
                          return;
                        setOrphanState('deleting');
                        setOrphanError('');
                        void api
                          .deleteOrphanAssets({
                            workspaceId: workspace.id,
                            documentId: selected.ref.documentId,
                            collection: selected.ref.collectionId,
                            confirmation: orphanPlan.confirmation,
                          })
                          .then(() => {
                            setOrphanPlan(undefined);
                            setOrphanState('deleted');
                          })
                          .catch((reason: unknown) => {
                            setOrphanPlan(undefined);
                            setOrphanState('error');
                            setOrphanError(
                              reason instanceof Error
                                ? `${reason.message}。请重新检查后再删除。`
                                : '删除计划已变化，请重新检查',
                            );
                          });
                      }}
                    >
                      {orphanState === 'deleting'
                        ? '正在删除…'
                        : `确认删除 ${orphanPlan.assets.length} 个资源`}
                    </button>
                  ) : null}
                </>
              ) : null}
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
                {release.release.status === 'succeeded' &&
                release.release.previousReleaseId &&
                workspace ? (
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
