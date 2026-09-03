import type {
  ChangeSetReview,
  Site,
  SiteDiscoveryCandidate,
  StudioSetupStatus,
} from '@blog-studio/core';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';

import { ChangeSetReviewSheet } from '../features/changes/change-set-review.js';
import { AddToChatIcon } from '../features/agent/add-to-chat-icon.js';
import { AgentPanel } from '../features/agent/agent-panel.js';
import { WorkingCopyConflict } from '../features/editor/working-copy-conflict.js';
import { FrontMatterEditor } from '../features/editor/front-matter-editor.js';
import { ArticleActions } from '../features/library/article-actions.js';
import { ConfirmDialog } from '../features/shell/confirm-dialog.js';
import {
  ContentLibrary,
  type ContentAdvancedFilters,
} from '../features/library/content-library.js';
import { SiteOnboarding } from '../features/onboarding/site-onboarding.js';
import { SetupRecovery } from '../features/onboarding/setup-recovery.js';
import { PreviewPane } from '../features/preview/preview-pane.js';
import {
  ResourcePicker,
  type ResourceUploadView,
} from '../features/resources/resource-picker.js';
import { SystemSettings } from '../features/settings/system-settings.js';
import { LocalDebugControl } from '../features/site/local-debug-control.js';
import { SiteOverview } from '../features/site/site-overview.js';
import { GlobalSearch } from '../features/search/global-search.js';
import {
  StudioNavigation,
  type StudioDestination,
} from '../features/shell/studio-navigation.js';
import {
  csrfFromCookie,
  StudioApi,
  StudioApiError,
  type ContentQueryResult,
  type ContentSortDirection,
  type ContentSortField,
  type ContentState,
  type ContentSummary,
  type DocumentPayload,
  type AgentMessageContext,
  type OrphanAssetPlan,
  type PreviewFallbackReason,
  type ReleaseDetails,
} from './api.js';

type SaveState =
  'clean' | 'changed' | 'saving' | 'saved' | 'error' | 'conflict';
type PreviewState = 'idle' | 'building' | 'ready' | 'error';
const VisualEditor = lazy(() =>
  import('../features/editor/visual-editor.js').then((module) => ({
    default: module.VisualEditor,
  })),
);

type ContentFilter = 'all' | ContentState;

function initialContentSearch(): string {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get('contentSearch') ?? '';
}

function initialContentSort(): ContentSortField {
  if (typeof window === 'undefined') return 'filesystemModifiedAt';
  const sort = new URLSearchParams(window.location.search).get('contentSort');
  return [
    'activityAt',
    'publishedAt',
    'contentUpdatedAt',
    'filesystemModifiedAt',
    'title',
    'state',
    'path',
  ].includes(sort ?? '')
    ? (sort as ContentSortField)
    : 'filesystemModifiedAt';
}

function initialContentDirection(): ContentSortDirection {
  if (typeof window === 'undefined') return 'desc';
  return new URLSearchParams(window.location.search).get('contentDirection') ===
    'asc'
    ? 'asc'
    : 'desc';
}

function siteIdFromUrl(): string {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get('siteId') ?? '';
}

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
        <p className="eyebrow">SELF-HOSTED AI CONTENT WORKSPACE</p>
        <h1>让 AI 理解整个网站。</h1>
        <p>
          Site Agent 协助检查和修改；你的内容与发布决定仍属于文件、Git 和你。
        </p>
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
  const [authenticationMode, setAuthenticationMode] = useState<
    'none' | 'password' | null
  >(null);
  const [setupStatus, setSetupStatus] = useState<StudioSetupStatus>();
  const [setupChecked, setSetupChecked] = useState(false);
  const [setupRetrying, setSetupRetrying] = useState(false);
  const [setupError, setSetupError] = useState('');
  const [sites, setSites] = useState<readonly Site[]>([]);
  const [site, setSite] = useState<Site>();
  const [destination, setDestination] = useState<StudioDestination>('site');
  const [siteContent, setSiteContent] = useState<ContentQueryResult>();
  const [siteContentState, setSiteContentState] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle');
  const [siteContentError, setSiteContentError] = useState('');
  const [contentSearch, setContentSearch] = useState(initialContentSearch);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [contentFilter, setContentFilter] = useState<ContentFilter>('all');
  const [contentAdvancedFilters, setContentAdvancedFilters] =
    useState<ContentAdvancedFilters>({
      collection: '',
      tag: '',
      from: '',
      to: '',
    });
  const [contentPage, setContentPage] = useState(1);
  const [contentSort, setContentSort] =
    useState<ContentSortField>(initialContentSort);
  const [contentDirection, setContentDirection] =
    useState<ContentSortDirection>(initialContentDirection);
  const [candidates, setCandidates] = useState<
    readonly SiteDiscoveryCandidate[]
  >([]);
  const [discoveryState, setDiscoveryState] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle');
  const [discoveryError, setDiscoveryError] = useState('');
  const [changeSetOpen, setChangeSetOpen] = useState(false);
  const [changeSetState, setChangeSetState] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle');
  const [changeSet, setChangeSet] = useState<ChangeSetReview>();
  const [changeSetError, setChangeSetError] = useState('');
  const [changeSetRelease, setChangeSetRelease] = useState<ReleaseDetails>();
  const [selected, setSelected] = useState<ContentSummary>();
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
  const saveGeneration = useRef(0);
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewState, setPreviewState] = useState<PreviewState>('idle');
  const [previewError, setPreviewError] = useState('');
  const [previewFallback, setPreviewFallback] =
    useState<PreviewFallbackReason>();
  const [previewMode, setPreviewMode] = useState<'markdown' | 'enhanced'>(
    'markdown',
  );
  const [panel, setPanel] = useState<'library' | 'write' | 'preview'>('write');
  const [uploads, setUploads] = useState<readonly ResourceUploadView[]>([]);
  const [orphanPlan, setOrphanPlan] = useState<OrphanAssetPlan>();
  const [orphanBusy, setOrphanBusy] = useState(false);
  const [orphanError, setOrphanError] = useState('');
  const [createRequest, setCreateRequest] = useState(0);
  const [markdownSelection, setMarkdownSelection] = useState<
    Extract<AgentMessageContext, { type: 'markdown-selection' }> | undefined
  >();
  const [agentSelection, setAgentSelection] = useState<
    Extract<AgentMessageContext, { type: 'markdown-selection' }> | undefined
  >();
  const [agentOpenRequest, setAgentOpenRequest] = useState(0);
  const [agentCreateRequested, setAgentCreateRequested] = useState(false);
  const [agentDocked, setAgentDocked] = useState(false);
  const [agentSlot, setAgentSlot] = useState<HTMLDivElement | null>(null);
  const [libraryCollapsed, setLibraryCollapsed] = useState(false);
  const [confirm, setConfirm] = useState<{
    readonly title: string;
    readonly description: string;
    readonly confirmLabel?: string;
    readonly danger?: boolean;
    readonly run: () => void | Promise<void>;
  }>();
  const [editorEpoch, setEditorEpoch] = useState(0);
  const resourceInput = useRef<HTMLInputElement>(null);

  function uploadResource(file: File): void {
    if (!site || !selected) return;
    const id = crypto.randomUUID();
    const previewUrl = file.type.startsWith('image/')
      ? URL.createObjectURL(file)
      : undefined;
    setUploads((items) => [
      ...items,
      {
        id,
        file,
        ...(previewUrl ? { previewUrl } : {}),
        state: 'uploading',
      },
    ]);
    void api
      .uploadResource({
        siteId: site.id,
        documentId: selected.documentId,
        collection: selected.collectionId,
        file,
      })
      .then(({ resource }) => {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setUploads((items) =>
          items.map((item) =>
            item.id === id
              ? {
                  ...item,
                  kind: resource.kind,
                  storage: resource.storage,
                  ...(resource.inlinePreview
                    ? { previewUrl: resource.publicUrl }
                    : {}),
                  state: 'ready',
                }
              : item,
          ),
        );
        setBody(
          (value) => `${value.replace(/\s*$/, '')}\n\n${resource.insertion}\n`,
        );
        setSaveState('changed');
      })
      .catch((reason: unknown) => {
        const rejected =
          reason instanceof StudioApiError &&
          [
            'ASSET_TOO_LARGE',
            'ASSET_MEDIA_UNSUPPORTED',
            'ASSET_MEDIA_MISMATCH',
            'ASSET_PIXEL_LIMIT',
            'RESOURCE_EXECUTABLE_REJECTED',
            'RESOURCE_EXTENSION_MISMATCH',
          ].includes(reason.code ?? '');
        setUploads((items) =>
          items.map((item) =>
            item.id === id
              ? {
                  ...item,
                  state: rejected ? 'rejected' : 'error',
                  error:
                    reason instanceof Error ? reason.message : '资源上传失败',
                }
              : item,
          ),
        );
      });
  }

  async function discoverSites(): Promise<void> {
    setDiscoveryState('loading');
    setDiscoveryError('');
    try {
      const result = await api.discoverSites();
      setCandidates(result.candidates);
      setDiscoveryState('ready');
    } catch (reason: unknown) {
      setCandidates([]);
      setDiscoveryState('error');
      setDiscoveryError(
        reason instanceof Error ? reason.message : '站点检查失败',
      );
    }
  }

  async function loadStudioState(): Promise<void> {
    try {
      const siteResult = await api.sites();
      setSites(siteResult.sites);
      setSite(
        (current) =>
          siteResult.sites.find((item) => item.id === current?.id) ??
          siteResult.sites.find((item) => item.id === siteIdFromUrl()) ??
          siteResult.sites[0],
      );
      if (siteResult.sites.length === 0) void discoverSites();
      setAuthenticated(true);
    } catch {
      setAuthenticated(false);
    }
  }

  async function refreshSetupStatus(): Promise<StudioSetupStatus> {
    setSetupRetrying(true);
    setSetupError('');
    try {
      const status = await api.setupStatus();
      setSetupStatus(status);
      setSetupChecked(true);
      if (status.configuration.state === 'valid') {
        const auth = await api.authStatus();
        setAuthenticationMode(auth.mode);
        setOwnerInitialized(auth.initialized);
        if (auth.mode === 'none') {
          await api.openUnprotectedSession();
          await loadStudioState();
        } else if (auth.initialized) await loadStudioState();
        else setAuthenticated(false);
      }
      return status;
    } catch (reason: unknown) {
      setSetupChecked(true);
      setSetupError(
        reason instanceof Error ? reason.message : '无法读取首次运行状态',
      );
      throw reason;
    } finally {
      setSetupRetrying(false);
    }
  }

  useEffect(() => {
    const url = new URL(window.location.href);
    if (contentSearch) url.searchParams.set('contentSearch', contentSearch);
    else url.searchParams.delete('contentSearch');
    if (contentSort === 'filesystemModifiedAt')
      url.searchParams.delete('contentSort');
    else url.searchParams.set('contentSort', contentSort);
    if (contentDirection === 'desc')
      url.searchParams.delete('contentDirection');
    else url.searchParams.set('contentDirection', contentDirection);
    window.history.replaceState(null, '', url);
  }, [contentDirection, contentSearch, contentSort]);
  useEffect(() => {
    if (!site) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('siteId') === site.id) return;
    url.searchParams.set('siteId', site.id);
    window.history.replaceState(null, '', url);
  }, [site]);
  useEffect(() => {
    const onPopState = () => {
      const siteId = siteIdFromUrl();
      const restored = sites.find((item) => item.id === siteId);
      if (restored) setSite(restored);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [sites]);
  const contentQuery = useMemo(
    () => ({
      ...(contentSearch ? { search: contentSearch } : {}),
      ...(contentFilter === 'all' ? {} : { state: contentFilter }),
      ...(contentAdvancedFilters.collection
        ? { collection: contentAdvancedFilters.collection }
        : {}),
      ...(contentAdvancedFilters.tag
        ? { tag: contentAdvancedFilters.tag }
        : {}),
      ...(contentAdvancedFilters.from
        ? { from: `${contentAdvancedFilters.from}T00:00:00.000Z` }
        : {}),
      ...(contentAdvancedFilters.to
        ? { to: `${contentAdvancedFilters.to}T23:59:59.999Z` }
        : {}),
      sort: contentSort,
      direction: contentDirection,
      page: contentPage,
      pageSize: 30,
    }),
    [
      contentAdvancedFilters,
      contentDirection,
      contentFilter,
      contentPage,
      contentSearch,
      contentSort,
    ],
  );
  useEffect(() => {
    void Promise.all([api.setupStatus(), api.authStatus()])
      .then(async ([setup, auth]) => {
        setSetupStatus(setup);
        setSetupChecked(true);
        setAuthenticationMode(auth.mode);
        setOwnerInitialized(auth.initialized);
        if (setup.configuration.state !== 'valid') {
          setAuthenticated(false);
          return;
        }
        if (auth.mode === 'none') {
          await api.openUnprotectedSession();
          await loadStudioState();
        } else if (auth.initialized) await loadStudioState();
        else setAuthenticated(false);
      })
      .catch(() => {
        setSetupChecked(true);
        setSetupError('无法读取首次运行状态');
        setAuthenticationMode('password');
        setOwnerInitialized(false);
        setAuthenticated(false);
      });
  }, [api]);
  useEffect(() => {
    if (!site) {
      setSiteContent(undefined);
      setSiteContentState('idle');
      return;
    }
    let cancelled = false;
    setSiteContentState('loading');
    setSiteContentError('');
    void api
      .content(site.id, contentQuery)
      .then(({ content }) => {
        if (cancelled) return;
        setSiteContent(content);
        setSelected((current) =>
          current
            ? (content.items.find(
                (item) => item.documentId === current.documentId,
              ) ?? content.items[0])
            : content.items[0],
        );
        setSiteContentState('ready');
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setSiteContent(undefined);
        setSiteContentState('error');
        setSiteContentError(
          reason instanceof Error ? reason.message : '站点内容读取失败',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [api, contentQuery, site]);
  useEffect(() => {
    if (!site || !changeSetOpen || !changeSetRelease) return;
    if (
      ['succeeded', 'failed', 'rolled-back', 'canceled'].includes(
        changeSetRelease.release.status,
      )
    )
      return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void api
        .siteRelease(site.id, changeSetRelease.release.id)
        .then((details) => {
          if (!cancelled) setChangeSetRelease(details);
        })
        .catch(() => undefined);
    }, 900);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [api, changeSetOpen, changeSetRelease, site]);
  useEffect(() => {
    if (!site || !selected) return;
    let cancelled = false;
    setDocument(undefined);
    setLoadedDocumentId('');
    setPreviewUrl('');
    setPreviewState('idle');
    setPreviewError('');
    setPreviewFallback(undefined);
    setMarkdownSelection(undefined);
    setAgentSelection(undefined);
    setUploads((items) => {
      for (const item of items)
        if (item.previewUrl?.startsWith('blob:'))
          URL.revokeObjectURL(item.previewUrl);
      return [];
    });
    void api
      .siteDocument(site.id, selected.documentId, selected.collectionId)
      .then((result) => {
        if (cancelled) return;
        setDocument(result);
        setLoadedDocumentId(selected.documentId);
        const nextBody = result.source.body;
        setBody(nextBody);
        setMode(/\{%[\s\S]*?%\}/.test(nextBody) ? 'source' : 'visual');
        const matter = result.source.frontMatter;
        setFrontMatter(matter);
        setTitle(
          typeof matter.title === 'string' ? matter.title : selected.title,
        );
        setVersion(0);
        setSaveState('clean');
      });
    return () => {
      cancelled = true;
    };
  }, [api, selected, site]);

  useEffect(() => {
    if (!site || !selected || loadedDocumentId !== selected.documentId) {
      setOrphanPlan(undefined);
      return;
    }
    let cancelled = false;
    setOrphanError('');
    void api
      .orphanResources({
        siteId: site.id,
        documentId: selected.documentId,
        collection: selected.collectionId,
      })
      .then(({ plan }) => {
        if (!cancelled) setOrphanPlan(plan);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setOrphanPlan(undefined);
        setOrphanError(
          reason instanceof Error ? reason.message : '未引用资源检查失败',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [
    api,
    document?.source.revision,
    editorEpoch,
    loadedDocumentId,
    selected,
    site,
    version,
  ]);

  useEffect(() => {
    if (
      saveState !== 'changed' ||
      !site ||
      !selected ||
      !document ||
      loadedDocumentId !== selected.documentId
    )
      return;
    const generation = saveGeneration.current;
    const timer = window.setTimeout(() => {
      setSaveState('saving');
      void api
        .saveWorkingCopy({
          siteId: site.id,
          documentId: selected.documentId,
          collection: selected.collectionId,
          expectedVersion: version,
          sourceRevision: document.source.revision,
          frontMatter: { ...frontMatter, title },
          body,
        })
        .then((result) => {
          if (generation !== saveGeneration.current) return;
          setDocument({
            source: result.source,
            draft: null,
          });
          setVersion(0);
          setSaveState('saved');
        })
        .catch((reason: unknown) => {
          if (generation !== saveGeneration.current) return;
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
    site,
  ]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's')
        return;
      event.preventDefault();
      if (saveState === 'clean' || saveState === 'saved') setSaveState('saved');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [saveState]);

  function openContentDocument(item: ContentSummary): void {
    setSelected(item);
    setDestination('content');
    setPanel('write');
  }

  async function refreshContentList(): Promise<ContentQueryResult | undefined> {
    if (!site) return undefined;
    const refreshed = await api.content(site.id, contentQuery);
    setSiteContent(refreshed.content);
    return refreshed.content;
  }

  function publishArticle(item: ContentSummary): void {
    if (!site || item.sourceState !== 'draft') return;
    setConfirm({
      title: '转为正式文章',
      description: `把「${item.title}」从草稿移到已发布目录。之后再通过更改审阅提交到 Git。`,
      confirmLabel: '转为正式文章',
      run: async () => {
        const opened = await api.siteDocument(
          site.id,
          item.documentId,
          item.collectionId,
        );
        const published = await api.publishDraft({
          siteId: site.id,
          documentId: item.documentId,
          collection: item.collectionId,
          expectedRevision: opened.source.revision,
        });
        const list = await refreshContentList();
        const next = list?.items.find(
          (candidate) =>
            candidate.documentId === published.source.ref.documentId,
        );
        if (next) openContentDocument(next);
        else if (selected?.documentId === item.documentId) {
          setSelected(undefined);
          setDocument(undefined);
        }
      },
    });
  }

  function deleteArticle(item: ContentSummary): void {
    if (!site) return;
    setConfirm({
      title: item.sourceState === 'draft' ? '删除草稿' : '删除文章',
      description:
        item.sourceState === 'draft'
          ? `删除草稿「${item.title}」？文件会从磁盘移除。`
          : `从磁盘删除「${item.title}」？已提交的版本仍可通过 Git 恢复。`,
      confirmLabel: '删除',
      danger: true,
      run: async () => {
        await api.deleteContent({
          siteId: site.id,
          documentId: item.documentId,
          collection: item.collectionId,
        });
        await refreshContentList();
        if (selected?.documentId === item.documentId) {
          setSelected(undefined);
          setDocument(undefined);
          setBody('');
        }
      },
    });
  }

  async function reloadOpenDocument(paths?: readonly string[]): Promise<void> {
    if (!site || !selected) return;
    if (
      paths &&
      paths.length > 0 &&
      !paths.some(
        (path) =>
          path === selected.path ||
          path.endsWith(`/${selected.path}`) ||
          selected.path.endsWith(path),
      )
    ) {
      const refreshed = await api.content(site.id, contentQuery);
      setSiteContent(refreshed.content);
      return;
    }
    const restored = await api.siteDocument(
      site.id,
      selected.documentId,
      selected.collectionId,
    );
    saveGeneration.current += 1;
    setDocument(restored);
    setLoadedDocumentId(selected.documentId);
    setBody(restored.source.body);
    setFrontMatter(restored.source.frontMatter);
    setTitle(
      typeof restored.source.frontMatter.title === 'string'
        ? restored.source.frontMatter.title
        : selected.title,
    );
    setVersion(0);
    setSaveState('clean');
    setEditorEpoch((value) => value + 1);
    const refreshed = await api.content(site.id, contentQuery);
    setSiteContent(refreshed.content);
    setSelected(
      (current) =>
        refreshed.content.items.find(
          (item) => item.documentId === current?.documentId,
        ) ?? current,
    );
  }

  function prepareChanges(): void {
    if (!site) return;
    setChangeSetOpen(true);
    setChangeSetState('loading');
    setChangeSet(undefined);
    setChangeSetRelease(undefined);
    setChangeSetError('');
    void api
      .prepareChangeSet(site.id)
      .then(({ changeSet: prepared }) => {
        setChangeSet(prepared);
        setChangeSetState('ready');
      })
      .catch((reason: unknown) => {
        setChangeSetState('error');
        setChangeSetError(
          reason instanceof Error ? reason.message : '修改整理失败',
        );
      });
  }

  function startPreview(nextMode: 'markdown' | 'enhanced' = 'markdown'): void {
    if (!site || !selected) return;
    setPanel('preview');
    setPreviewMode(nextMode);
    setPreviewState('building');
    setPreviewError('');
    setPreviewFallback(undefined);
    void api
      .startContentPreview({
        siteId: site.id,
        documentId: selected.documentId,
        collection: selected.collectionId,
        mode: nextMode,
      })
      .then(({ preview }) => {
        setPreviewUrl(preview.url);
        setPreviewFallback(preview.fallbackReason);
        setPreviewState('ready');
      })
      .catch((reason: unknown) => {
        setPreviewUrl('');
        setPreviewFallback(undefined);
        setPreviewState('error');
        setPreviewError(
          reason instanceof Error ? reason.message : '预览生成失败',
        );
      });
  }

  if (
    !setupChecked ||
    authenticated === null ||
    ownerInitialized === null ||
    authenticationMode === null
  )
    return <div className="boot-screen">BLOG / STUDIO</div>;
  if (!setupStatus || setupStatus.configuration.state === 'invalid')
    return (
      <SetupRecovery
        error={setupError}
        retrying={setupRetrying}
        status={setupStatus}
        onRetry={() => void refreshSetupStatus().catch(() => undefined)}
      />
    );
  if (!authenticated)
    return (
      <Login
        initialized={ownerInitialized}
        onLogin={async (password) => {
          await api.login(password);
          await loadStudioState();
        }}
      />
    );

  return (
    <MotionConfig reducedMotion="user">
      <div
        className={`studio-shell studio2-shell${agentDocked ? ' is-agent-open' : ''}${destination === 'content' ? ' is-content' : ''}`}
      >
        <StudioNavigation
          destination={destination}
          onCreateDocument={() => {
            setDestination('content');
            setPanel('library');
            setCreateRequest((value) => value + 1);
          }}
          onDestinationChange={setDestination}
          onPrepareChanges={prepareChanges}
          onSearchOpen={() => {
            setDestination('content');
            setGlobalSearchOpen(true);
          }}
          onSiteChange={(nextSite) => {
            const url = new URL(window.location.href);
            url.searchParams.set('siteId', nextSite.id);
            window.history.pushState(null, '', url);
            setSite(nextSite);
            setDestination('site');
          }}
          pendingChanges={Math.max(
            siteContent?.counts.modified ?? 0,
            ['changed', 'saving', 'saved'].includes(saveState) ? 1 : 0,
          )}
          preparing={changeSetState === 'loading'}
          site={site}
          sites={sites}
        />

        <GlobalSearch
          content={siteContent}
          error={siteContentError || undefined}
          loading={siteContentState === 'loading'}
          open={globalSearchOpen}
          query={contentSearch}
          onClose={() => setGlobalSearchOpen(false)}
          onOpen={(item) => {
            openContentDocument(item);
            setPanel('write');
          }}
          onQueryChange={(query) => {
            setContentSearch(query);
            setContentPage(1);
          }}
        />

        <ChangeSetReviewSheet
          error={changeSetError}
          loading={changeSetState === 'loading'}
          open={changeSetOpen}
          release={changeSetRelease}
          review={changeSet}
          site={site}
          onApply={async (review) => {
            if (!site) return;
            const result = await api.applyChangeSet(site.id, review.id);
            setChangeSet(result.changeSet);
            const refreshed = await api.content(site.id, contentQuery);
            setSiteContent(refreshed.content);
            setSelected((current) =>
              current
                ? (refreshed.content.items.find(
                    (item) => item.documentId === current.documentId,
                  ) ?? refreshed.content.items[0])
                : refreshed.content.items[0],
            );
          }}
          onCancelRelease={async (details) => {
            if (!site) return;
            setChangeSetRelease(
              await api.cancelSiteRelease(site.id, details.release.id),
            );
          }}
          onClose={() => setChangeSetOpen(false)}
          onOpenAgent={() => {
            setChangeSetOpen(false);
            setAgentCreateRequested(false);
            setAgentOpenRequest((value) => value + 1);
          }}
          onCommit={async (review, input) => {
            if (!site) return;
            const result = await api.commitChangeSet({
              siteId: site.id,
              changeSetId: review.id,
              message: input.message,
              paths: input.paths,
            });
            setChangeSet(result.changeSet);
          }}
          onRelease={async (review, confirmation) => {
            if (!site) return;
            const result = await api.releaseChangeSet({
              siteId: site.id,
              changeSetId: review.id,
              confirmation,
            });
            setChangeSetRelease(result.release);
          }}
          onReprepare={async () => {
            if (!site) return;
            const result = await api.prepareChangeSet(site.id);
            setChangeSet(result.changeSet);
            setChangeSetError('');
          }}
          onRollbackRelease={async (details) => {
            if (!site) return;
            setChangeSetRelease(
              await api.rollbackSiteRelease(site.id, details.release.id),
            );
          }}
        />

        {!site ? (
          <SiteOnboarding
            candidates={candidates}
            error={discoveryError}
            loading={discoveryState === 'loading'}
            onRefresh={() => void discoverSites()}
            onRegister={async ({ candidate, displayName, canonicalUrl }) => {
              const result = await api.registerSite({
                candidateId: candidate.candidateId,
                displayName,
                ...(canonicalUrl ? { canonicalUrl } : {}),
              });
              setSites((items) => [...items, result.site]);
              setSite(result.site);
              setDestination('site');
              return result.site;
            }}
          />
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            {destination === 'site' ? (
              <SiteOverview
                content={siteContent}
                error={siteContentError}
                key={`site-${site.id}`}
                loading={siteContentState === 'loading'}
                site={site}
                onLoadSiteEvents={async (siteId) =>
                  (await api.siteEvents(siteId)).events
                }
                onLoadDevelopment={async (siteId) =>
                  (await api.development(siteId)).development
                }
                onControlDevelopment={async (siteId, action) =>
                  (await api.controlDevelopment(siteId, action)).development
                }
                onLoadConfiguration={async (siteId) =>
                  (await api.siteConfiguration(siteId)).configuration
                }
                onValidateConfiguration={async (siteId, yaml) => {
                  await api.validateSiteConfiguration(siteId, yaml);
                }}
                onLoadConfigurationHistory={async (siteId) =>
                  (await api.siteConfigurationHistory(siteId)).revisions
                }
                onActivateConfiguration={async (input) =>
                  (await api.activateSiteConfiguration(input)).configuration
                }
                onRevertConfiguration={async (input) =>
                  (await api.revertSiteConfiguration(input)).configuration
                }
                onOpenContent={() => setDestination('content')}
                onOpenDocument={openContentDocument}
                onPublishDocument={publishArticle}
                onDeleteDocument={deleteArticle}
                onPrepareChanges={prepareChanges}
                onReloadSite={async (siteId) => {
                  const latest = (await api.site(siteId)).site;
                  setSite(latest);
                  setSites((items) =>
                    items.map((item) =>
                      item.id === latest.id ? latest : item,
                    ),
                  );
                  return latest;
                }}
                onUpdateSite={async (input) => {
                  const updated = (await api.updateSite(input)).site;
                  setSite(updated);
                  setSites((items) =>
                    items.map((item) =>
                      item.id === updated.id ? updated : item,
                    ),
                  );
                  return updated;
                }}
                onUpdateLifecycle={async (input) => {
                  const updated = (await api.updateSiteLifecycle(input)).site;
                  setSite(updated);
                  setSites((items) =>
                    items.map((item) =>
                      item.id === updated.id ? updated : item,
                    ),
                  );
                  return updated;
                }}
              />
            ) : destination === 'settings' ? (
              <SystemSettings
                authenticationMode={authenticationMode}
                key="settings"
                onChangePassword={(input) => api.changePassword(input)}
                onLogout={async () => {
                  await api.logout();
                  setAuthenticated(false);
                  setSite(undefined);
                  setSites([]);
                }}
              />
            ) : null}
          </AnimatePresence>
        )}

        <motion.section
          className={`studio2-content-heading ${
            destination !== 'content' || !site ? 'studio2-hidden' : ''
          }`}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24 }}
        >
          <div>
            <div className="studio2-breadcrumb" aria-label="当前位置">
              <button type="button" onClick={() => setDestination('site')}>
                {site?.displayName}
              </button>
              <i>/</i>
              <b>内容</b>
            </div>
            <h1>{selected?.title ?? '内容'}</h1>
          </div>
          <div className="studio2-content-actions">
            {agentDocked ? (
              <button
                className="studio2-secondary-button"
                type="button"
                onClick={() => setLibraryCollapsed((value) => !value)}
              >
                {libraryCollapsed ? '显示内容' : '收起内容'}
              </button>
            ) : null}
            <SaveBadge state={saveState} />
            {selected ? (
              <ArticleActions
                compact
                article={selected}
                onOpen={openContentDocument}
                onPublish={publishArticle}
                onDelete={deleteArticle}
              />
            ) : null}
            {site ? (
              <LocalDebugControl
                configured={site.capabilities.developmentConfigured}
                profilesAvailable={
                  site.capabilities.developmentProfiles.length > 0
                }
                siteId={site.id}
                onConfigure={() => setDestination('site')}
                onLoad={async (siteId) =>
                  (await api.development(siteId)).development
                }
                onControl={async (siteId, action) =>
                  (await api.controlDevelopment(siteId, action)).development
                }
              />
            ) : null}
          </div>
        </motion.section>

        <nav
          className={`mobile-nav ${
            destination !== 'content' || !site ? 'studio2-hidden' : ''
          }`}
          aria-label="工作区面板"
        >
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

        <div
          className={`workspace-grid ${
            destination !== 'content' || !site ? 'studio2-hidden' : ''
          }${agentDocked ? ' is-agent-open' : ''}${
            libraryCollapsed ? ' is-library-collapsed' : ''
          }`}
        >
          <div className={`studio3-library-slot mobile-${panel}`}>
            <ContentLibrary
              advancedFilters={contentAdvancedFilters}
              canCreate={Boolean(site?.capabilities.createDocuments)}
              content={siteContent}
              createRequest={createRequest}
              error={siteContentError}
              filter={contentFilter}
              loading={siteContentState === 'loading'}
              search={contentSearch}
              selectedDocumentId={selected?.documentId}
              sort={contentSort}
              direction={contentDirection}
              onCreate={async (input) => {
                if (!site) throw new Error('当前站点不能新建文章');
                const created = await api.createContent(site.id, input);
                const refreshed = await api.content(site.id, {
                  sort: contentSort,
                  direction: contentDirection,
                  page: 1,
                  pageSize: 30,
                });
                setSiteContent(refreshed.content);
                setContentFilter('all');
                setContentAdvancedFilters({
                  collection: '',
                  tag: '',
                  from: '',
                  to: '',
                });
                setContentSearch('');
                setContentPage(1);
                setSelected(
                  refreshed.content.items.find(
                    (item) => item.documentId === created.source.ref.documentId,
                  ),
                );
                setPanel('write');
              }}
              onFilterChange={(nextFilter) => {
                setContentFilter(nextFilter);
                setContentPage(1);
              }}
              onAdvancedFiltersChange={(filters) => {
                setContentAdvancedFilters(filters);
                setContentPage(1);
              }}
              onDiscardUnavailable={(item) => {
                if (!site || !item.workingCopy) return;
                setConfirm({
                  title: '删除无法定位的工作副本',
                  description:
                    '只删除这个无法定位的工作副本？源文件与站点中的其他内容不会被修改。',
                  confirmLabel: '删除工作副本',
                  danger: true,
                  run: async () => {
                    if (!item.workingCopy) return;
                    await api.discardUnavailableWorkingCopy({
                      siteId: site.id,
                      documentId: item.documentId,
                      expectedVersion: item.workingCopy.version,
                    });
                    const refreshed = await api.content(site.id, contentQuery);
                    setSiteContent(refreshed.content);
                  },
                });
              }}
              onOpen={openContentDocument}
              onPublish={publishArticle}
              onDelete={deleteArticle}
              onPageChange={setContentPage}
              onSearchChange={(nextSearch) => {
                setContentSearch(nextSearch);
                setContentPage(1);
              }}
              onSortChange={(sort, direction) => {
                setContentSort(sort);
                setContentDirection(direction);
                setContentPage(1);
              }}
            />
          </div>

          <main className={`writing-panel mobile-${panel}`}>
            <div className="document-kicker">
              <span>文章</span>
              <i />
              {selected?.state === 'modified'
                ? '未提交改动'
                : selected?.sourceState === 'draft'
                  ? '草稿'
                  : '已发布'}
            </div>
            <textarea
              className="title-input"
              aria-label="文章标题"
              disabled={Boolean(document?.stale)}
              rows={1}
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                setSaveState('changed');
              }}
              placeholder="无标题文章"
            />
            <FrontMatterEditor
              disabled={Boolean(
                document?.stale || document?.source.frontMatterParseError,
              )}
              fields={site?.capabilities.frontMatterFields ?? []}
              frontMatter={frontMatter}
              {...((document?.draft?.frontMatterSource ??
              document?.source.frontMatterSource)
                ? {
                    frontMatterSource:
                      document.draft?.frontMatterSource ??
                      document.source.frontMatterSource,
                  }
                : {})}
              {...(document?.source.frontMatterParseError
                ? {
                    frontMatterParseError:
                      document.source.frontMatterParseError,
                  }
                : {})}
              {...(site && selected && document?.source.frontMatterParseError
                ? {
                    onRepair: async (frontMatterSource: string) => {
                      const repaired = await api.repairFrontMatter({
                        siteId: site.id,
                        documentId: selected.documentId,
                        collection: selected.collectionId,
                        sourceRevision: document.source.revision,
                        frontMatterSource,
                      });
                      setDocument({ source: repaired.source, draft: null });
                      setFrontMatter(repaired.source.frontMatter);
                      setTitle(
                        typeof repaired.source.frontMatter.title === 'string'
                          ? repaired.source.frontMatter.title
                          : selected.title,
                      );
                      setVersion(0);
                      setSaveState('clean');
                    },
                  }
                : {})}
              onChange={(nextFrontMatter) => {
                setFrontMatter(nextFrontMatter);
                setSaveState('changed');
              }}
            />
            <div className="editor-actions">
              {!document?.stale ? (
                <>
                  <div
                    className="mode-switch"
                    role="group"
                    aria-label="编辑模式"
                  >
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
                    className="studio2-secondary-button"
                    type="button"
                    onClick={() => setPanel('preview')}
                  >
                    预览
                  </button>
                  <ResourcePicker
                    accept={site?.capabilities.resourceMediaTypes ?? []}
                    inputRef={resourceInput}
                    orphanResources={
                      orphanPlan?.assets.length
                        ? {
                            count: orphanPlan.assets.length,
                            storage: orphanPlan.storage ?? 'local',
                            busy: orphanBusy,
                            ...(orphanError ? { error: orphanError } : {}),
                          }
                        : undefined
                    }
                    uploads={uploads}
                    onDeleteOrphans={() => {
                      if (!orphanPlan || !site || !selected) return;
                      setConfirm({
                        title: '清理未引用资源',
                        description: `清理这 ${orphanPlan.assets.length} 个未引用资源？删除前会再次核对文章版本；已引用资源不会被删除。`,
                        confirmLabel: '清理资源',
                        danger: true,
                        run: async () => {
                          setOrphanBusy(true);
                          setOrphanError('');
                          try {
                            await api.deleteOrphanResources({
                              siteId: site.id,
                              documentId: selected.documentId,
                              collection: selected.collectionId,
                              confirmation: orphanPlan.confirmation,
                            });
                            setOrphanPlan(undefined);
                          } catch (reason: unknown) {
                            setOrphanError(
                              reason instanceof Error
                                ? reason.message
                                : '未引用资源清理失败，请重新审阅',
                            );
                          } finally {
                            setOrphanBusy(false);
                          }
                        },
                      });
                    }}
                    onDismiss={(upload) =>
                      setUploads((items) =>
                        items.filter((item) => item.id !== upload.id),
                      )
                    }
                    onPick={uploadResource}
                    onRetry={(upload) => {
                      setUploads((items) =>
                        items.filter((item) => item.id !== upload.id),
                      );
                      if (upload.previewUrl?.startsWith('blob:'))
                        URL.revokeObjectURL(upload.previewUrl);
                      uploadResource(upload.file);
                    }}
                  />
                  {site && selected ? (
                    <button
                      className="discard-button"
                      onClick={() => {
                        setConfirm({
                          title: '放弃修改',
                          description:
                            '放弃磁盘上尚未提交的修改，恢复到 Git 中的版本？新草稿若还没有提交记录，正文会清空。',
                          confirmLabel: '放弃修改',
                          danger: true,
                          run: () => {
                            const generation = ++saveGeneration.current;
                            void api
                              .discardWorkingCopy({
                                siteId: site.id,
                                documentId: selected.documentId,
                                collection: selected.collectionId,
                                expectedVersion: version,
                              })
                              .then(async () => {
                                const restored = await api.siteDocument(
                                  site.id,
                                  selected.documentId,
                                  selected.collectionId,
                                );
                                if (generation !== saveGeneration.current)
                                  return;
                                setDocument(restored);
                                setBody(restored.source.body);
                                setFrontMatter(restored.source.frontMatter);
                                setTitle(
                                  typeof restored.source.frontMatter.title ===
                                    'string'
                                    ? restored.source.frontMatter.title
                                    : selected.title,
                                );
                                setVersion(0);
                                setSaveState('clean');
                                setEditorEpoch((value) => value + 1);
                                const refreshed = await api.content(
                                  site.id,
                                  contentQuery,
                                );
                                if (generation !== saveGeneration.current)
                                  return;
                                setSiteContent(refreshed.content);
                              })
                              .catch((reason: unknown) => {
                                if (generation !== saveGeneration.current)
                                  return;
                                setSaveState(
                                  reason instanceof Error &&
                                    /conflict/i.test(reason.message)
                                    ? 'conflict'
                                    : 'error',
                                );
                              });
                          },
                        });
                      }}
                    >
                      放弃修改
                    </button>
                  ) : null}
                </>
              ) : null}
            </div>
            {document?.stale && document.draft && site && selected ? (
              <WorkingCopyConflict
                document={document}
                onKeepWorkingCopy={async () => {
                  const saved = await api.saveWorkingCopy({
                    siteId: site.id,
                    documentId: selected.documentId,
                    collection: selected.collectionId,
                    expectedVersion: document.draft!.version,
                    sourceRevision: document.source.revision,
                    frontMatter: document.draft!.frontMatter,
                    body: document.draft!.body,
                  });
                  const restored = await api.siteDocument(
                    site.id,
                    selected.documentId,
                    selected.collectionId,
                  );
                  setDocument(restored);
                  setBody(restored.draft?.body ?? restored.source.body);
                  setFrontMatter(
                    restored.draft?.frontMatter ?? restored.source.frontMatter,
                  );
                  setTitle(
                    typeof (
                      restored.draft?.frontMatter ?? restored.source.frontMatter
                    ).title === 'string'
                      ? String(
                          (
                            restored.draft?.frontMatter ??
                            restored.source.frontMatter
                          ).title,
                        )
                      : selected.title,
                  );
                  setVersion(saved.draft.version);
                  setSaveState('clean');
                }}
                onUseFileVersion={async () => {
                  await api.discardWorkingCopy({
                    siteId: site.id,
                    documentId: selected.documentId,
                    collection: selected.collectionId,
                    expectedVersion: document.draft!.version,
                  });
                  const restored = await api.siteDocument(
                    site.id,
                    selected.documentId,
                    selected.collectionId,
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
                }}
              />
            ) : (
              <section
                className="editor-paper"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const file = event.dataTransfer.files[0];
                  if (file) uploadResource(file);
                }}
                onPaste={(event) => {
                  const file = event.clipboardData.files[0];
                  if (file) {
                    event.preventDefault();
                    uploadResource(file);
                  }
                }}
              >
                {(!document || loadedDocumentId !== selected?.documentId) && (
                  <div className="editor-loading">正在读取文章…</div>
                )}
                {document &&
                loadedDocumentId === selected?.documentId &&
                mode === 'visual' ? (
                  <Suspense
                    fallback={
                      <div className="editor-loading">正在铺开稿纸…</div>
                    }
                  >
                    <VisualEditor
                      key={`${selected?.documentId}-${mode}-${document.source.revision}-${editorEpoch}`}
                      markdown={body}
                      onSelectionChange={(selection) => {
                        if (!selected) {
                          setMarkdownSelection(undefined);
                          return;
                        }
                        if (!selection) {
                          setMarkdownSelection(undefined);
                          return;
                        }
                        setMarkdownSelection({
                          type: 'markdown-selection',
                          documentId: selected.documentId,
                          startLine: selection.startLine,
                          endLine: selection.endLine,
                          text: selection.text,
                        });
                      }}
                      onAddToChat={(selection) => {
                        if (!selected) return;
                        const next = {
                          type: 'markdown-selection' as const,
                          documentId: selected.documentId,
                          startLine: selection.startLine,
                          endLine: selection.endLine,
                          text: selection.text,
                        };
                        setMarkdownSelection(next);
                        setAgentSelection(next);
                        setAgentCreateRequested(false);
                        setAgentOpenRequest((value) => value + 1);
                      }}
                      resolveImageSource={(source) =>
                        `/api/sites/${site?.id ?? ''}/content/${selected?.documentId}/resource?collection=${encodeURIComponent(selected?.collectionId ?? '')}&source=${encodeURIComponent(source)}`
                      }
                      onChange={(value) => {
                        setBody(value);
                        setSaveState('changed');
                      }}
                    />
                  </Suspense>
                ) : document && loadedDocumentId === selected?.documentId ? (
                  <div className="source-editor-wrap">
                    <textarea
                      className="source-editor"
                      aria-label="Markdown 源码"
                      value={body}
                      onChange={(event) => {
                        setBody(event.target.value);
                        setSaveState('changed');
                      }}
                      onSelect={(event) => {
                        const start = event.currentTarget.selectionStart;
                        const end = event.currentTarget.selectionEnd;
                        if (start === end || !selected) {
                          setMarkdownSelection(undefined);
                          return;
                        }
                        const selectedText = body.slice(start, end);
                        const startLine = body
                          .slice(0, start)
                          .split('\n').length;
                        const endLine =
                          startLine + selectedText.split('\n').length - 1;
                        setMarkdownSelection({
                          type: 'markdown-selection',
                          documentId: selected.documentId,
                          startLine,
                          endLine,
                          text: selectedText,
                        });
                      }}
                    />
                  </div>
                ) : null}
                {markdownSelection &&
                document &&
                loadedDocumentId === selected?.documentId ? (
                  <button
                    className="agent-selection-button"
                    type="button"
                    aria-label="加入对话"
                    title="加入对话"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setAgentSelection(markdownSelection);
                      setAgentCreateRequested(false);
                      setAgentOpenRequest((value) => value + 1);
                    }}
                  >
                    <AddToChatIcon />
                  </button>
                ) : null}
              </section>
            )}
          </main>

          <div className={`studio3-preview-slot mobile-${panel}`}>
            <PreviewPane
              enhancedAvailable={Boolean(site?.capabilities.generatorPreview)}
              error={previewError}
              fallback={previewFallback}
              mode={previewMode}
              state={previewState}
              url={previewUrl}
              onClose={() => setPanel('write')}
              onPreview={startPreview}
            />
          </div>
          <div
            ref={setAgentSlot}
            className={`studio3-agent-slot${agentDocked ? ' is-open' : ''}`}
            hidden={!agentDocked}
          />
        </div>
        <ConfirmDialog
          open={Boolean(confirm)}
          title={confirm?.title ?? ''}
          description={confirm?.description ?? ''}
          {...(confirm?.confirmLabel
            ? { confirmLabel: confirm.confirmLabel }
            : {})}
          {...(confirm?.danger ? { danger: true } : {})}
          onConfirm={() => {
            const task = confirm?.run;
            setConfirm(undefined);
            void task?.();
          }}
          onOpenChange={(open) => {
            if (!open) setConfirm(undefined);
          }}
        />
        <AgentPanel
          api={api}
          openRequest={agentOpenRequest}
          createRequested={agentCreateRequested}
          onOpenChange={(open) => {
            setAgentDocked(open);
            setLibraryCollapsed(open && destination === 'content');
          }}
          {...(destination === 'content' && agentSlot
            ? { host: agentSlot }
            : {})}
          {...(site ? { siteId: site.id, siteName: site.displayName } : {})}
          {...(destination === 'content' && selected
            ? {
                articleContext: {
                  type: 'article' as const,
                  documentId: selected.documentId,
                  collectionId: selected.collectionId,
                  title: selected.title,
                  path: selected.path,
                },
              }
            : {})}
          {...(agentSelection ? { selectionContext: agentSelection } : {})}
          onSelectionConsumed={() => setAgentSelection(undefined)}
          onWorkspaceChanged={(paths) => {
            void reloadOpenDocument(paths);
          }}
        />
      </div>
    </MotionConfig>
  );
}
