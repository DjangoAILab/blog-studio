import { useEffect, useRef, useState } from 'react';

import type { ContentQueryResult, ContentSummary } from '../../app/api.js';

interface GlobalSearchProps {
  readonly content?: ContentQueryResult | undefined;
  readonly error?: string | undefined;
  readonly loading: boolean;
  readonly onClose: () => void;
  readonly onOpen: (item: ContentSummary) => void;
  readonly onQueryChange: (query: string) => void;
  readonly open: boolean;
  readonly query: string;
}

export function GlobalSearch({
  content,
  error,
  loading,
  onClose,
  onOpen,
  onQueryChange,
  open,
  query,
}: GlobalSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [input, setInput] = useState(query);

  useEffect(() => {
    if (!open) {
      previousFocus.current?.focus();
      previousFocus.current = null;
      return;
    }
    previousFocus.current = document.activeElement as HTMLElement | null;
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => setInput(query), [query]);
  useEffect(() => {
    if (input === query) return;
    const timer = window.setTimeout(() => onQueryChange(input.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [input, onQueryChange, query]);

  if (!open) return null;
  return (
    <div className="studio3-search-backdrop" onMouseDown={onClose}>
      <section
        aria-label="搜索内容"
        aria-modal="true"
        className="studio3-global-search"
        role="dialog"
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <label className="studio3-global-search-input">
          <span aria-hidden="true">⌕</span>
          <input
            ref={inputRef}
            aria-label="全局搜索"
            placeholder="搜索标题、标签、分类或路径"
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
          <kbd>Esc</kbd>
        </label>
        <div className="studio3-global-search-results" aria-live="polite">
          {loading ? <p>正在搜索…</p> : null}
          {!loading && error ? <p role="alert">{error}</p> : null}
          {!loading && !error && query.trim() && content?.items.length ? (
            <ol>
              {content.items.map((item) => (
                <li key={`${item.collectionId}/${item.documentId}`}>
                  <button
                    type="button"
                    onClick={() => {
                      onOpen(item);
                      onClose();
                    }}
                  >
                    <b>{item.title}</b>
                    <small>{item.path || item.collectionId}</small>
                  </button>
                </li>
              ))}
            </ol>
          ) : null}
          {!loading && !error && query.trim() && !content?.items.length ? (
            <p>没有匹配内容</p>
          ) : null}
          {!query.trim() ? <p>输入关键词即可跨站点内容检索。</p> : null}
        </div>
      </section>
    </div>
  );
}
