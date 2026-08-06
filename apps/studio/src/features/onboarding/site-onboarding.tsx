import type { Site, SiteDiscoveryCandidate } from '@blog-studio/core';
import { motion } from 'motion/react';
import { useEffect, useState } from 'react';

interface SiteOnboardingProps {
  readonly candidates: readonly SiteDiscoveryCandidate[];
  readonly loading: boolean;
  readonly error?: string;
  readonly onRefresh: () => void;
  readonly onRegister: (input: {
    readonly candidate: SiteDiscoveryCandidate;
    readonly displayName: string;
    readonly canonicalUrl?: string;
  }) => Promise<Site>;
}

function contentCount(candidate: SiteDiscoveryCandidate): number {
  return Object.values(candidate.contentCounts).reduce(
    (total, count) => total + count,
    0,
  );
}

export function SiteOnboarding({
  candidates,
  loading,
  error,
  onRefresh,
  onRegister,
}: SiteOnboardingProps) {
  const [selectedId, setSelectedId] = useState('');
  const selected =
    candidates.find((candidate) => candidate.candidateId === selectedId) ??
    candidates[0];
  const [displayName, setDisplayName] = useState('');
  const [canonicalUrl, setCanonicalUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  useEffect(() => {
    if (!selected) return;
    setSelectedId(selected.candidateId);
    setDisplayName(selected.proposedDisplayName);
    setCanonicalUrl(selected.canonicalUrl ?? '');
  }, [selected?.candidateId]);

  return (
    <motion.main
      className="studio2-page studio2-onboarding"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
    >
      <p className="studio2-onboarding-step">首次设置 · 站点</p>
      <h1>先把你的站点带进来。</h1>
      <p className="studio2-onboarding-lede">
        Blog Studio 只会检查管理员允许的目录。确认前不会修改
        Markdown、站点配置或 Git 历史。
      </p>

      {loading ? (
        <section className="studio2-discovery-state" role="status">
          <span className="studio2-loading-orb" />
          <div>
            <b>正在寻找可管理的站点</b>
            <p>检查生成器、文章集合、仓库状态和预览能力…</p>
          </div>
        </section>
      ) : error ? (
        <section className="studio2-discovery-state is-error" role="alert">
          <div>
            <b>站点检查没有完成</b>
            <p>{error}</p>
          </div>
          <button type="button" onClick={onRefresh}>
            重新检查
          </button>
        </section>
      ) : !selected ? (
        <section className="studio2-discovery-state">
          <div>
            <b>没有发现可添加的站点</b>
            <p>请先让管理员把站点配置放进允许的工作目录，再重新检查。</p>
          </div>
          <button type="button" onClick={onRefresh}>
            重新检查
          </button>
        </section>
      ) : (
        <div className="studio2-onboarding-grid">
          <section className="studio2-candidate-card">
            <header>
              <span className="studio2-candidate-mark" aria-hidden="true">
                {selected.proposedDisplayName.slice(0, 1)}
              </span>
              <div>
                <p>找到站点</p>
                <h2>{selected.proposedDisplayName}</h2>
                <small>{selected.canonicalUrl ?? selected.candidateId}</small>
              </div>
              <span className="studio2-found-badge">可以添加</span>
            </header>
            <dl>
              <div>
                <dt>内容</dt>
                <dd>{contentCount(selected)} 篇</dd>
              </div>
              <div>
                <dt>生成器</dt>
                <dd>{selected.capabilities.generator}</dd>
              </div>
              <div>
                <dt>仓库</dt>
                <dd>
                  {selected.repository.available
                    ? `${selected.repository.branch} · ${selected.repository.dirtyCount} 项本地修改`
                    : '不可用'}
                </dd>
              </div>
              <div>
                <dt>完整预览</dt>
                <dd>
                  {selected.capabilities.generatorPreview
                    ? '支持'
                    : '使用 Markdown'}
                </dd>
              </div>
            </dl>
          </section>

          <form
            className="studio2-site-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!selected || !displayName.trim()) return;
              setSubmitting(true);
              setSubmitError('');
              void onRegister({
                candidate: selected,
                displayName: displayName.trim(),
                ...(canonicalUrl.trim()
                  ? { canonicalUrl: canonicalUrl.trim() }
                  : {}),
              })
                .catch((reason: unknown) => {
                  setSubmitError(
                    reason instanceof Error ? reason.message : '添加站点失败',
                  );
                })
                .finally(() => setSubmitting(false));
            }}
          >
            <div>
              <p>确认站点资料</p>
              <h2>以后可以在“站点”中修改</h2>
            </div>
            <label>
              站点名称
              <input
                autoFocus
                maxLength={120}
                required
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </label>
            <label>
              公开网址 <small>可选</small>
              <input
                inputMode="url"
                type="url"
                value={canonicalUrl}
                onChange={(event) => setCanonicalUrl(event.target.value)}
              />
            </label>
            <p className="studio2-form-note">
              添加只会建立一个可撤销的管理记录，不会发布站点。
            </p>
            {submitError ? (
              <p className="form-error" role="alert">
                {submitError}
              </p>
            ) : null}
            <button
              className="studio2-prepare-button"
              disabled={submitting}
              type="submit"
            >
              {submitting ? '正在添加…' : '添加这个站点'}
              <span aria-hidden="true">→</span>
            </button>
          </form>
        </div>
      )}
    </motion.main>
  );
}
