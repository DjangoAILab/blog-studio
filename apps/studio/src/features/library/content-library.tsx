import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';

import type {
  ContentQueryResult,
  ContentSortDirection,
  ContentSortField,
  ContentState,
  ContentSummary,
} from '../../app/api.js';

type ContentFilter = 'all' | ContentState;

export interface ContentAdvancedFilters {
  readonly collection: string;
  readonly tag: string;
  readonly from: string;
  readonly to: string;
}

interface ContentLibraryProps {
  readonly content?: ContentQueryResult | undefined;
  readonly error?: string | undefined;
  readonly filter: ContentFilter;
  readonly advancedFilters: ContentAdvancedFilters;
  readonly loading: boolean;
  readonly sort: ContentSortField;
  readonly direction: ContentSortDirection;
  readonly search: string;
  readonly selectedDocumentId?: string | undefined;
  readonly canCreate: boolean;
  readonly createRequest: number;
  readonly onCreate: (input: {
    readonly title: string;
    readonly slug?: string;
  }) => Promise<void>;
  readonly onFilterChange: (filter: ContentFilter) => void;
  readonly onAdvancedFiltersChange: (filters: ContentAdvancedFilters) => void;
  readonly onDiscardUnavailable: (item: ContentSummary) => Promise<void>;
  readonly onOpen: (item: ContentSummary) => void;
  readonly onPageChange: (page: number) => void;
  readonly onSearchChange: (search: string) => void;
  readonly onSortChange: (
    sort: ContentSortField,
    direction: ContentSortDirection,
  ) => void;
}

const filters: readonly {
  readonly id: ContentFilter;
  readonly label: string;
}[] = [
  { id: 'all', label: '全部' },
  { id: 'modified', label: '已修改' },
  { id: 'draft', label: '草稿' },
  { id: 'published', label: '已发布' },
];

const stateLabels: Readonly<Record<ContentState, string>> = {
  draft: '草稿',
  published: '已发布',
  modified: '工作副本',
};

const sortLabels: Readonly<Record<ContentSortField, string>> = {
  activityAt: '最近活动',
  publishedAt: '发布时间',
  contentUpdatedAt: '内容更新时间',
  filesystemModifiedAt: '文件修改时间',
  title: '标题',
  state: '状态',
  path: '路径',
};

function formatDate(value?: string): string {
  if (!value) return '尚未记录时间';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

export function ContentLibrary({
  content,
  error,
  filter,
  advancedFilters,
  loading,
  sort,
  direction,
  search,
  selectedDocumentId,
  canCreate,
  createRequest,
  onCreate,
  onFilterChange,
  onAdvancedFiltersChange,
  onDiscardUnavailable,
  onOpen,
  onPageChange,
  onSearchChange,
  onSortChange,
}: ContentLibraryProps) {
  const [searchValue, setSearchValue] = useState(search);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draftFilters, setDraftFilters] =
    useState<ContentAdvancedFilters>(advancedFilters);
  const [creating, setCreating] = useState(false);
  const [createTitle, setCreateTitle] = useState('');
  const [createSlug, setCreateSlug] = useState('');
  const [createError, setCreateError] = useState('');
  const [createBusy, setCreateBusy] = useState(false);

  useEffect(() => setSearchValue(search), [search]);
  useEffect(() => {
    if (searchValue === search) return;
    const timer = window.setTimeout(
      () => onSearchChange(searchValue.trim()),
      250,
    );
    return () => window.clearTimeout(timer);
  }, [onSearchChange, search, searchValue]);
  useEffect(() => setDraftFilters(advancedFilters), [advancedFilters]);
  useEffect(() => {
    if (createRequest > 0) {
      setCreating(true);
      setCreateError('');
    }
  }, [createRequest]);

  const totalPages = content
    ? Math.max(1, Math.ceil(content.total / content.pageSize))
    : 1;
  const activeAdvancedFilters =
    Object.values(advancedFilters).filter(Boolean).length;

  return (
    <aside className="studio3-library" aria-label="内容库">
      <header className="studio3-library-header">
        <div>
          <p>CONTENT</p>
          <h2>内容</h2>
        </div>
        {canCreate ? (
          <button
            aria-expanded={creating}
            aria-label={creating ? '关闭新建文章表单' : '新建文章'}
            className="studio3-round-action"
            type="button"
            onClick={() => {
              setCreating((value) => !value);
              setCreateError('');
            }}
          >
            {creating ? '×' : '+'}
          </button>
        ) : null}
      </header>

      <AnimatePresence initial={false}>
        {creating ? (
          <motion.form
            animate={{ height: 'auto' }}
            className="studio3-create-form"
            exit={{ height: 0 }}
            initial={{ height: 0 }}
            transition={{ duration: 0.2 }}
            onSubmit={(event) => {
              event.preventDefault();
              if (!createTitle.trim() || createBusy) return;
              setCreateBusy(true);
              setCreateError('');
              void onCreate({
                title: createTitle.trim(),
                ...(createSlug.trim() ? { slug: createSlug.trim() } : {}),
              })
                .then(() => {
                  setCreateTitle('');
                  setCreateSlug('');
                  setCreating(false);
                })
                .catch((reason: unknown) =>
                  setCreateError(
                    reason instanceof Error ? reason.message : '新建草稿失败',
                  ),
                )
                .finally(() => setCreateBusy(false));
            }}
          >
            <label>
              标题
              <input
                autoFocus
                maxLength={200}
                placeholder="这篇文章讲什么？"
                value={createTitle}
                onChange={(event) => setCreateTitle(event.target.value)}
              />
            </label>
            <label>
              Slug <small>可选</small>
              <input
                maxLength={80}
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                placeholder="my-new-post"
                value={createSlug}
                onChange={(event) => setCreateSlug(event.target.value)}
              />
            </label>
            {createError ? (
              <p className="form-error" role="alert">
                {createError}
              </p>
            ) : null}
            <button className="studio3-create-submit" disabled={createBusy}>
              {createBusy ? '正在建立…' : '建立原生草稿'}
            </button>
          </motion.form>
        ) : null}
      </AnimatePresence>

      <form
        className="studio3-search"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          onSearchChange(searchValue.trim());
        }}
      >
        <span aria-hidden="true">⌕</span>
        <input
          aria-label="搜索内容"
          placeholder="搜索标题、标签或路径"
          value={searchValue}
          onChange={(event) => setSearchValue(event.target.value)}
        />
        {searchValue ? (
          <button
            aria-label="清除搜索"
            type="button"
            onClick={() => {
              setSearchValue('');
              onSearchChange('');
            }}
          >
            ×
          </button>
        ) : null}
      </form>

      <section className="studio3-query-toolbar" aria-label="整理内容">
        <div className="studio3-sort-controls" aria-label="内容排序">
          <label>
            排序
            <select
              aria-label="排序属性"
              value={sort}
              onChange={(event) =>
                onSortChange(event.target.value as ContentSortField, direction)
              }
            >
              {(Object.keys(sortLabels) as ContentSortField[]).map((field) => (
                <option key={field} value={field}>
                  {sortLabels[field]}
                </option>
              ))}
            </select>
          </label>
          <button
            aria-label={direction === 'desc' ? '当前为降序' : '当前为升序'}
            type="button"
            onClick={() =>
              onSortChange(sort, direction === 'desc' ? 'asc' : 'desc')
            }
          >
            {direction === 'desc' ? '↓ 降序' : '↑ 升序'}
          </button>
        </div>

        <div className="studio3-filter-actions">
          <button
            aria-controls="content-advanced-filters"
            aria-expanded={filtersOpen}
            type="button"
            onClick={() => setFiltersOpen((value) => !value)}
          >
            筛选内容
            {activeAdvancedFilters ? <b>{activeAdvancedFilters}</b> : null}
          </button>
          {activeAdvancedFilters ? (
            <button
              type="button"
              onClick={() => {
                const empty = { collection: '', tag: '', from: '', to: '' };
                setDraftFilters(empty);
                onAdvancedFiltersChange(empty);
              }}
            >
              清除
            </button>
          ) : null}
        </div>
      </section>

      <AnimatePresence initial={false}>
        {filtersOpen ? (
          <motion.form
            animate={{ height: 'auto' }}
            aria-label="内容筛选"
            className="studio3-advanced-filters"
            exit={{ height: 0 }}
            id="content-advanced-filters"
            initial={{ height: 0 }}
            onSubmit={(event) => {
              event.preventDefault();
              onAdvancedFiltersChange(draftFilters);
            }}
          >
            <label>
              集合
              <select
                value={draftFilters.collection}
                onChange={(event) =>
                  setDraftFilters((current) => ({
                    ...current,
                    collection: event.target.value,
                  }))
                }
              >
                <option value="">全部集合</option>
                {content?.facets.collections.map((collection) => (
                  <option key={collection.id} value={collection.id}>
                    {collection.id}（{collection.count}）
                  </option>
                ))}
              </select>
            </label>
            <label>
              标签
              <select
                value={draftFilters.tag}
                onChange={(event) =>
                  setDraftFilters((current) => ({
                    ...current,
                    tag: event.target.value,
                  }))
                }
              >
                <option value="">全部标签</option>
                {content?.facets.tags.map((tag) => (
                  <option key={tag.name} value={tag.name}>
                    {tag.name}（{tag.count}）
                  </option>
                ))}
              </select>
            </label>
            <label>
              从
              <input
                type="date"
                value={draftFilters.from}
                onChange={(event) =>
                  setDraftFilters((current) => ({
                    ...current,
                    from: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              到
              <input
                min={draftFilters.from || undefined}
                type="date"
                value={draftFilters.to}
                onChange={(event) =>
                  setDraftFilters((current) => ({
                    ...current,
                    to: event.target.value,
                  }))
                }
              />
            </label>
            <button className="studio3-apply-filters" type="submit">
              应用筛选
            </button>
          </motion.form>
        ) : null}
      </AnimatePresence>

      <div className="studio3-filter-strip" aria-label="内容状态">
        {filters.map((item) => (
          <button
            aria-pressed={filter === item.id}
            className={filter === item.id ? 'is-active' : ''}
            key={item.id}
            type="button"
            onClick={() => onFilterChange(item.id)}
          >
            <span>{item.label}</span>
            <b>{content?.counts[item.id] ?? 0}</b>
          </button>
        ))}
      </div>

      <div className="studio3-library-results" aria-busy={loading}>
        {!loading && content?.issues.length ? (
          <div className="studio3-library-warning" role="status">
            <b>部分内容暂时不可用</b>
            <p>
              {content.issues
                .map((issue) => `${issue.collectionId}：${issue.message}`)
                .join('；')}
            </p>
          </div>
        ) : null}
        {loading ? (
          <div className="studio3-library-state" role="status">
            <span className="studio2-loading-orb" />
            <p>正在整理内容…</p>
          </div>
        ) : error ? (
          <div className="studio3-library-state is-error" role="alert">
            <b>内容暂时无法读取</b>
            <p>{error}</p>
          </div>
        ) : content?.items.length ? (
          <motion.ol layout className="studio3-content-list">
            {content.items.map((item) => (
              <motion.li key={`${item.collectionId}/${item.documentId}`} layout>
                {item.sourceState === 'unavailable' ? (
                  <div className="studio3-unavailable-row">
                    <span className="studio3-state-dot is-conflicted" />
                    <span className="studio3-content-copy">
                      <b>{item.title}</b>
                      <small>源文件缺失或不兼容 · 工作副本仍安全保留</small>
                    </span>
                    <button
                      type="button"
                      onClick={() => void onDiscardUnavailable(item)}
                    >
                      删除副本
                    </button>
                  </div>
                ) : (
                  <button
                    aria-current={
                      selectedDocumentId === item.documentId
                        ? 'page'
                        : undefined
                    }
                    className={
                      selectedDocumentId === item.documentId
                        ? 'is-selected'
                        : ''
                    }
                    type="button"
                    onClick={() => onOpen(item)}
                  >
                    <span
                      className={`studio3-state-dot is-${
                        item.workingCopy?.stale ? 'conflicted' : item.state
                      }`}
                    />
                    <span className="studio3-content-copy">
                      <b>{item.title}</b>
                      <small>
                        {item.workingCopy?.stale
                          ? '工作副本 · 需处理冲突'
                          : stateLabels[item.state]}{' '}
                        · {formatDate(item.activityAt)}
                      </small>
                    </span>
                    <span aria-hidden="true" className="studio3-row-arrow">
                      ›
                    </span>
                  </button>
                )}
              </motion.li>
            ))}
          </motion.ol>
        ) : (
          <div className="studio3-library-state">
            <span className="studio3-empty-glyph" aria-hidden="true">
              ◫
            </span>
            <b>
              {search || filter !== 'all' || activeAdvancedFilters
                ? '没有匹配内容'
                : '从第一篇开始'}
            </b>
            <p>
              {search || filter !== 'all' || activeAdvancedFilters
                ? '换个关键词，或清除当前筛选。'
                : '原生草稿和已发布文章会在这里统一出现。'}
            </p>
          </div>
        )}
      </div>

      {content && totalPages > 1 ? (
        <footer className="studio3-pagination">
          <button
            disabled={content.page <= 1}
            type="button"
            onClick={() => onPageChange(content.page - 1)}
          >
            上一页
          </button>
          <span>
            {content.page} / {totalPages}
          </span>
          <button
            disabled={content.page >= totalPages}
            type="button"
            onClick={() => onPageChange(content.page + 1)}
          >
            下一页
          </button>
        </footer>
      ) : null}
    </aside>
  );
}
