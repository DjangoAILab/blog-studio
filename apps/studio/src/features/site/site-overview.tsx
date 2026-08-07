import type { Site, SiteAuditEvent } from '@blog-studio/core';
import { motion } from 'motion/react';

import type { ContentQueryResult, ContentSummary } from '../../app/api.js';
import { SiteSettings } from '../settings/site-settings.js';

interface SiteOverviewProps {
  readonly site: Site;
  readonly content?: ContentQueryResult | undefined;
  readonly loading: boolean;
  readonly error?: string | undefined;
  readonly onOpenContent: () => void;
  readonly onOpenDocument: (document: ContentSummary) => void;
  readonly onPrepareChanges: () => void;
  readonly onLoadSiteEvents: (
    siteId: string,
  ) => Promise<readonly SiteAuditEvent[]>;
  readonly onReloadSite: (siteId: string) => Promise<Site>;
  readonly onUpdateSite: (input: {
    readonly siteId: string;
    readonly expectedUpdatedAt: string;
    readonly displayName: string;
    readonly canonicalUrl?: string;
  }) => Promise<Site>;
}

const stateLabels: Readonly<Record<ContentSummary['state'], string>> = {
  draft: '草稿',
  published: '已发布',
  modified: '已发布 · 有修改',
};

function formatDate(value?: string): string {
  if (!value) return '尚未记录时间';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
}

function friendlyUrl(site: Site): string {
  if (!site.canonicalUrl) return '尚未设置站点网址';
  try {
    return new URL(site.canonicalUrl).host;
  } catch {
    return site.canonicalUrl;
  }
}

function ArticleMark({ document }: { readonly document: ContentSummary }) {
  return (
    <span
      className={`studio2-article-mark is-${document.state}`}
      aria-hidden="true"
    >
      <i />
      <i />
      <i />
    </span>
  );
}

export function SiteOverview({
  site,
  content,
  loading,
  error,
  onOpenContent,
  onOpenDocument,
  onPrepareChanges,
  onLoadSiteEvents,
  onReloadSite,
  onUpdateSite,
}: SiteOverviewProps) {
  const recent = content?.items.slice(0, 5) ?? [];
  const pendingChanges = content?.counts.modified ?? 0;

  return (
    <motion.main
      className="studio2-page studio2-site-page"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -5 }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="studio2-breadcrumb" aria-label="当前位置">
        <span>站点</span>
        <i>/</i>
        <b>{site.displayName}</b>
      </div>

      <section className="studio2-site-identity" aria-labelledby="site-title">
        <div>
          <h1 id="site-title">{site.displayName}</h1>
          <p>{friendlyUrl(site)}</p>
        </div>
        <div className="studio2-site-identity-actions">
          <span className="studio2-health">
            <i />
            运行正常
          </span>
          <SiteSettings
            site={site}
            onLoadEvents={onLoadSiteEvents}
            onReload={onReloadSite}
            onSave={onUpdateSite}
          />
        </div>
      </section>

      <dl className="studio2-status-rail">
        <div>
          <dt>内容</dt>
          <dd>{loading ? '—' : `${content?.counts.all ?? 0} 篇文章`}</dd>
        </div>
        <div>
          <dt>草稿</dt>
          <dd>{loading ? '—' : `${content?.counts.draft ?? 0} 个草稿`}</dd>
        </div>
        <div>
          <dt>生成器</dt>
          <dd>{site.capabilities.generator}</dd>
        </div>
        <div>
          <dt>发布</dt>
          <dd>
            <span className="studio2-inline-status" />
            {site.capabilities.publishConfigured
              ? '发布目标已配置'
              : '仅保存在本地'}
          </dd>
        </div>
      </dl>

      <section className="studio2-recent" aria-labelledby="recent-content">
        <header>
          <div>
            <p>CONTENT</p>
            <h2 id="recent-content">最近内容</h2>
          </div>
          <button type="button" onClick={onOpenContent}>
            查看全部
            <span aria-hidden="true">→</span>
          </button>
        </header>

        <div className="studio2-content-group">
          {loading ? (
            <div className="studio2-list-state" role="status">
              <span className="studio2-loading-orb" />
              正在整理站点内容…
            </div>
          ) : error ? (
            <div className="studio2-list-state is-error" role="alert">
              <b>暂时无法读取内容</b>
              <span>{error}</span>
            </div>
          ) : recent.length === 0 ? (
            <div className="studio2-list-state">
              <b>站点还没有内容</b>
              <span>建立第一篇草稿后，它会出现在这里。</span>
            </div>
          ) : (
            <ol>
              {recent.map((document) => (
                <li key={`${document.collectionId}/${document.documentId}`}>
                  <button
                    className="studio2-article-row"
                    type="button"
                    onClick={() => onOpenDocument(document)}
                  >
                    <ArticleMark document={document} />
                    <span className="studio2-article-copy">
                      <strong>{document.title}</strong>
                      <small>
                        <span className={`is-${document.state}`} />
                        {stateLabels[document.state]}
                        <i>·</i>
                        {formatDate(document.activityAt)}
                      </small>
                    </span>
                    <span className="studio2-row-more" aria-hidden="true">
                      •••
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>

      {pendingChanges > 0 ? (
        <motion.button
          className="studio2-ready-capsule"
          layoutId="prepared-change-set"
          type="button"
          onClick={onPrepareChanges}
          whileTap={{ scale: 0.98 }}
        >
          <span aria-hidden="true">✓</span>
          <b>{pendingChanges} 项修改可整理检查</b>
          <i aria-hidden="true">→</i>
        </motion.button>
      ) : null}
    </motion.main>
  );
}
