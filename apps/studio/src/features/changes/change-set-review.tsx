import { Dialog } from '@base-ui/react/dialog';
import type { ChangeSetReview, Site } from '@blog-studio/core';
import { useEffect, useMemo, useState } from 'react';

import type { ReleaseDetails, ReleaseStatus } from '../../app/api.js';

const RELEASE_CONFIRMATION = 'RELEASE COMMITTED CHANGESET';

const changeLabels = {
  added: '新增',
  modified: '修改',
  deleted: '删除',
  conflicted: '冲突',
  unmanaged: '未纳入管理',
  ignored: '已忽略',
} as const;

const releaseLabels: Readonly<Record<ReleaseStatus, string>> = {
  queued: '等待开始',
  preflight: '环境检查',
  building: '生成站点',
  planning: '计算发布计划',
  'uploading-assets': '上传资源',
  'uploading-pages': '上传页面',
  'invalidating-cache': '刷新缓存',
  verifying: '线上校验',
  succeeded: '发布完成',
  failed: '发布失败',
  'rollback-required': '需要回滚',
  'rolling-back': '正在回滚',
  'rolled-back': '已回滚',
  canceled: '已取消',
};

interface ChangeSetReviewSheetProps {
  readonly open: boolean;
  readonly loading: boolean;
  readonly site?: Site | undefined;
  readonly review?: ChangeSetReview | undefined;
  readonly release?: ReleaseDetails | undefined;
  readonly error?: string | undefined;
  readonly onClose: () => void;
  readonly onOpenAgent: () => void;
  readonly onReprepare: () => Promise<void>;
  readonly onApply: (review: ChangeSetReview) => Promise<void>;
  readonly onCommit: (
    review: ChangeSetReview,
    input: { readonly message: string; readonly paths: readonly string[] },
  ) => Promise<void>;
  readonly onRelease: (
    review: ChangeSetReview,
    confirmation: string,
  ) => Promise<void>;
  readonly onCancelRelease: (release: ReleaseDetails) => Promise<void>;
  readonly onRollbackRelease: (release: ReleaseDetails) => Promise<void>;
}

function shortHash(value: string): string {
  return value.replace(/^sha256:/, '').slice(0, 9);
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function ReviewDetails({ review }: { readonly review: ChangeSetReview }) {
  const documentCount = review.payload.documents.length;
  const resourceCount = review.payload.resources.length;
  const repositoryCount = review.payload.repositoryChanges.length;

  return (
    <>
      <dl className="studio2-change-summary">
        <div>
          <dt>文章修改</dt>
          <dd>{documentCount}</dd>
        </div>
        <div>
          <dt>引用资源</dt>
          <dd>{resourceCount}</dd>
        </div>
        <div>
          <dt>仓库变更</dt>
          <dd>{repositoryCount}</dd>
        </div>
      </dl>

      <dl className="studio2-change-provenance">
        <div>
          <dt>分支</dt>
          <dd>{review.payload.branch}</dd>
        </div>
        <div>
          <dt>基准</dt>
          <dd>{shortHash(review.payload.baseRevision)}</dd>
        </div>
        <div>
          <dt>站点配置</dt>
          <dd>{shortHash(review.payload.configurationRevision)}</dd>
        </div>
        <div>
          <dt>冻结时间</dt>
          <dd>{formatTime(review.payload.preparedAt)}</dd>
        </div>
        <div>
          <dt>指纹</dt>
          <dd>{shortHash(review.fingerprint)}</dd>
        </div>
      </dl>

      <section className="studio2-change-list">
        <h3>文章工作副本</h3>
        {documentCount === 0 ? (
          <p className="studio2-change-empty">没有待应用的文章工作副本。</p>
        ) : (
          <div className="studio2-review-stack">
            {review.payload.documents.map((document) => (
              <details
                className={`studio2-review-item is-${document.state}`}
                key={`${document.collectionId}/${document.documentId}`}
              >
                <summary>
                  <span />
                  <div>
                    <b>{document.path}</b>
                    <small>
                      {document.state === 'conflicted'
                        ? '源文件已变化，需要重新核对'
                        : `草稿 v${document.draftVersion} · 点击查看冻结内容`}
                    </small>
                  </div>
                  <i aria-hidden="true">⌄</i>
                </summary>
                <div className="studio2-diff-grid">
                  <section>
                    <span>修改前</span>
                    <pre>{document.originalBody || '（空）'}</pre>
                  </section>
                  <section>
                    <span>准备应用</span>
                    <pre>{document.body || '（空）'}</pre>
                  </section>
                </div>
              </details>
            ))}
          </div>
        )}
      </section>

      {resourceCount > 0 ? (
        <section className="studio2-change-list">
          <h3>随文章引用的资源</h3>
          <ul>
            {review.payload.resources.map((resource) => (
              <li key={resource.id}>
                <span className="is-resource" />
                <div>
                  <b>{resource.key}</b>
                  <small>
                    {resource.mediaType} · {formatBytes(resource.byteLength)}
                  </small>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="studio2-change-list">
        <h3>当前仓库状态</h3>
        {repositoryCount === 0 ? (
          <p className="studio2-change-empty">仓库没有额外的文件变化。</p>
        ) : (
          <ul>
            {review.payload.repositoryChanges.map((change) => (
              <li key={`${change.state}/${change.path}`}>
                <span className={`is-repository is-${change.state}`} />
                <div>
                  <b>{change.path}</b>
                  <small>
                    {changeLabels[change.state]}
                    {change.staged ? ' · 已暂存' : ''}
                  </small>
                  {change.diff ? (
                    <details className="studio2-inline-diff">
                      <summary>查看差异</summary>
                      <pre>{change.diff}</pre>
                    </details>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function ReleaseProgress({
  details,
  busy,
  onCancel,
  onRollback,
}: {
  readonly details: ReleaseDetails;
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onRollback: () => void;
}) {
  const { release, events } = details;
  const active = !['succeeded', 'failed', 'rolled-back', 'canceled'].includes(
    release.status,
  );
  const canRollback =
    release.status === 'succeeded' && Boolean(release.previousReleaseId);

  return (
    <section className="studio2-release-progress" aria-live="polite">
      <header>
        <div>
          <p>RELEASE</p>
          <h3>{releaseLabels[release.status]}</h3>
        </div>
        <span className={`is-${release.status}`}>{release.status}</span>
      </header>
      <ol>
        {release.stages.map((stage) => (
          <li className={`is-${stage.status}`} key={stage.name}>
            <i />
            <span>{stage.name}</span>
          </li>
        ))}
      </ol>
      {events.at(-1) ? (
        <p className="studio2-release-event">{events.at(-1)?.message}</p>
      ) : null}
      {active || canRollback ? (
        <div className="studio2-release-controls">
          {active ? (
            <button disabled={busy} type="button" onClick={onCancel}>
              取消发布
            </button>
          ) : null}
          {canRollback ? (
            <button disabled={busy} type="button" onClick={onRollback}>
              回滚到上一版本
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export function ChangeSetReviewSheet({
  open,
  loading,
  site,
  review,
  release,
  error,
  onClose,
  onOpenAgent,
  onReprepare,
  onApply,
  onCommit,
  onRelease,
  onCancelRelease,
  onRollbackRelease,
}: ChangeSetReviewSheetProps) {
  const [step, setStep] = useState<'review' | 'apply'>('review');
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState('Apply reviewed site changes');
  const [selectedPaths, setSelectedPaths] = useState<readonly string[]>([]);
  const [releaseConfirmation, setReleaseConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');

  const mandatoryPaths = useMemo(
    () => review?.payload.documents.map((document) => document.path) ?? [],
    [review],
  );
  const commitCandidates = useMemo(() => {
    if (!review) return [];
    const documents = new Set(mandatoryPaths);
    return review.payload.repositoryChanges.filter(
      (change) =>
        !documents.has(change.path) &&
        change.state !== 'conflicted' &&
        change.state !== 'ignored',
    );
  }, [mandatoryPaths, review]);
  const hasConflict =
    review?.payload.documents.some(
      (document) => document.state === 'conflicted',
    ) ?? false;

  useEffect(() => {
    setStep('review');
    setConfirmed(false);
    setActionError('');
    setReleaseConfirmation('');
    setSelectedPaths(mandatoryPaths);
  }, [mandatoryPaths, review?.id]);

  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setActionError('');
    try {
      await action();
    } catch (reason: unknown) {
      setActionError(reason instanceof Error ? reason.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }

  function togglePath(path: string): void {
    if (mandatoryPaths.includes(path)) return;
    setSelectedPaths((paths) =>
      paths.includes(path)
        ? paths.filter((item) => item !== path)
        : [...paths, path],
    );
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="studio2-dialog-backdrop" />
        <Dialog.Viewport className="studio2-dialog-viewport">
          <Dialog.Popup className="studio2-change-sheet">
            <header>
              <div>
                <p>CHANGESET</p>
                <Dialog.Title>更改审阅</Dialog.Title>
                <Dialog.Description>
                  先看清冻结内容，再逐级应用、提交；远端发布始终单独确认。
                </Dialog.Description>
              </div>
              <div className="studio2-change-header-actions">
                <button
                  className="studio2-secondary-button"
                  type="button"
                  onClick={onOpenAgent}
                >
                  Agent
                </button>
                <Dialog.Close className="studio2-sheet-close" aria-label="关闭">
                  ×
                </Dialog.Close>
              </div>
            </header>

            {loading ? (
              <div className="studio2-sheet-state" role="status">
                <span className="studio2-loading-orb" />
                <div>
                  <b>正在整理本地修改</b>
                  <p>读取工作副本、资源、配置和仓库状态…</p>
                </div>
              </div>
            ) : error ? (
              <div className="studio2-sheet-state is-error" role="alert">
                <b>暂时无法准备修改</b>
                <p>{error}</p>
              </div>
            ) : review ? (
              <>
                <nav className="studio2-change-steps" aria-label="更改进度">
                  <span className="is-done">1</span>
                  <i />
                  <span
                    className={review.status !== 'prepared' ? 'is-done' : ''}
                  >
                    2
                  </span>
                  <i />
                  <span
                    className={review.status === 'committed' ? 'is-done' : ''}
                  >
                    3
                  </span>
                  <small>审阅</small>
                  <small>应用</small>
                  <small>提交</small>
                </nav>

                <ReviewDetails review={review} />

                {review.status === 'prepared' ? (
                  <section className="studio2-action-card">
                    <header>
                      <span>下一步</span>
                      <h3>应用到本地文件</h3>
                      <p>
                        把上方冻结的文章和资源写回站点目录，不会创建 Git 提交。
                      </p>
                    </header>
                    {hasConflict ? (
                      <p className="studio2-action-warning" role="alert">
                        存在冲突的文章。请关闭后重新核对工作副本，再准备一次。
                      </p>
                    ) : step === 'review' ? (
                      <button
                        className="studio2-action-primary"
                        disabled={busy}
                        type="button"
                        onClick={() => setStep('apply')}
                      >
                        应用到本地文件…
                      </button>
                    ) : (
                      <div className="studio2-confirm-panel">
                        <label>
                          <input
                            checked={confirmed}
                            type="checkbox"
                            onChange={(event) =>
                              setConfirmed(event.target.checked)
                            }
                          />
                          <span>
                            <b>我确认应用这份冻结记录</b>
                            <small>
                              写入后仍可通过 Git 查看和恢复；不会触发远端发布。
                            </small>
                          </span>
                        </label>
                        <div>
                          <button
                            type="button"
                            onClick={() => setStep('review')}
                          >
                            返回
                          </button>
                          <button
                            className="studio2-action-primary"
                            disabled={!confirmed || busy}
                            type="button"
                            onClick={() => void run(() => onApply(review))}
                          >
                            {busy ? '正在应用…' : '确认应用'}
                          </button>
                        </div>
                      </div>
                    )}
                  </section>
                ) : null}

                {review.status === 'applied' ? (
                  <section className="studio2-action-card is-commit">
                    <header>
                      <span>本地提交</span>
                      <h3>选择这次提交的精确路径</h3>
                      <p>文章路径为本次必选；仓库中的其他修改默认不带入。</p>
                    </header>
                    <label className="studio2-field">
                      <span>提交说明</span>
                      <input
                        maxLength={200}
                        value={message}
                        onChange={(event) => setMessage(event.target.value)}
                      />
                    </label>
                    <div className="studio2-path-picker">
                      {mandatoryPaths.map((path) => (
                        <label key={path}>
                          <input checked disabled type="checkbox" />
                          <span>
                            <b>{path}</b>
                            <small>本次文章 · 必选</small>
                          </span>
                        </label>
                      ))}
                      {commitCandidates.map((change) => (
                        <label key={change.path}>
                          <input
                            checked={selectedPaths.includes(change.path)}
                            type="checkbox"
                            onChange={() => togglePath(change.path)}
                          />
                          <span>
                            <b>{change.path}</b>
                            <small>{changeLabels[change.state]} · 可选</small>
                          </span>
                        </label>
                      ))}
                    </div>
                    <button
                      className="studio2-action-primary"
                      disabled={
                        busy ||
                        message.trim().length === 0 ||
                        selectedPaths.length === 0
                      }
                      type="button"
                      onClick={() =>
                        void run(() =>
                          onCommit(review, {
                            message: message.trim(),
                            paths: selectedPaths,
                          }),
                        )
                      }
                    >
                      {busy ? '正在创建提交…' : '创建本地提交'}
                    </button>
                  </section>
                ) : null}

                {review.status === 'committed' ? (
                  <>
                    <section className="studio2-commit-result">
                      <span className="studio2-inline-status" />
                      <div>
                        <b>本地提交已创建</b>
                        <code>{review.commitId}</code>
                      </div>
                    </section>

                    {release ? (
                      <ReleaseProgress
                        busy={busy}
                        details={release}
                        onCancel={() =>
                          void run(() => onCancelRelease(release))
                        }
                        onRollback={() =>
                          void run(() => onRollbackRelease(release))
                        }
                      />
                    ) : site?.capabilities.publishConfigured ? (
                      <section className="studio2-release-boundary">
                        <header>
                          <span>远端操作 · 单独确认</span>
                          <h3>发布这份已审阅提交</h3>
                          <p>
                            将通过 {site.capabilities.publishProvider} 更新
                            {site.canonicalUrl
                              ? ` ${site.canonicalUrl}`
                              : '站点远端'}
                            。 发布只读取上方提交，不读取此刻工作区的其他变化。
                          </p>
                        </header>
                        <label className="studio2-field">
                          <span>输入以下确认语句</span>
                          <code>{RELEASE_CONFIRMATION}</code>
                          <input
                            autoComplete="off"
                            spellCheck={false}
                            value={releaseConfirmation}
                            onChange={(event) =>
                              setReleaseConfirmation(event.target.value)
                            }
                          />
                        </label>
                        <button
                          disabled={
                            busy || releaseConfirmation !== RELEASE_CONFIRMATION
                          }
                          type="button"
                          onClick={() =>
                            void run(() =>
                              onRelease(review, releaseConfirmation),
                            )
                          }
                        >
                          {busy ? '正在启动…' : '开始远端发布'}
                        </button>
                      </section>
                    ) : (
                      <section className="studio2-action-card is-muted">
                        <header>
                          <span>远端发布尚未配置</span>
                          <h3>本地提交已经安全完成</h3>
                          <p>
                            配置发布 Provider 后，才会在这里出现独立发布确认。
                          </p>
                        </header>
                      </section>
                    )}
                  </>
                ) : null}

                {actionError ? (
                  <div className="studio2-action-recovery" role="alert">
                    <p>{actionError}</p>
                    {review.status === 'prepared' &&
                    /changed|conflict|变化|冲突/i.test(actionError) ? (
                      <button
                        disabled={busy}
                        type="button"
                        onClick={() => void run(onReprepare)}
                      >
                        {busy ? '正在重新整理…' : '按最新状态重新准备'}
                      </button>
                    ) : null}
                  </div>
                ) : null}

                <footer>
                  <div>
                    <span className="studio2-inline-status" />
                    {review.status === 'prepared'
                      ? '冻结记录未写入文件'
                      : review.status === 'applied'
                        ? '已写入本地，尚未提交'
                        : '本地提交已固定'}
                  </div>
                  <button type="button" onClick={onClose}>
                    完成
                  </button>
                </footer>
              </>
            ) : null}
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
