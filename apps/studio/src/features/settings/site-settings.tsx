import { Dialog } from '@base-ui/react/dialog';
import type { Site, SiteAuditEvent } from '@blog-studio/core';
import { useState } from 'react';

import { StudioApiError } from '../../app/api.js';
import type {
  SiteConfigurationDetails,
  SiteConfigurationRevision,
} from '../../app/api.js';
import { SiteConfigurationEditor } from './site-configuration-editor.js';

interface SiteSettingsProps {
  readonly site: Site;
  readonly onLoadEvents: (siteId: string) => Promise<readonly SiteAuditEvent[]>;
  readonly onReload: (siteId: string) => Promise<Site>;
  readonly onSave: (input: {
    readonly siteId: string;
    readonly expectedUpdatedAt: string;
    readonly displayName: string;
    readonly canonicalUrl?: string;
  }) => Promise<Site>;
  readonly onUpdateLifecycle: (input: {
    readonly siteId: string;
    readonly expectedUpdatedAt: string;
    readonly lifecycleState: 'active' | 'paused' | 'unregistered';
  }) => Promise<Site>;
  readonly onLoadConfiguration: (
    siteId: string,
  ) => Promise<SiteConfigurationDetails>;
  readonly onValidateConfiguration: (
    siteId: string,
    yaml: string,
  ) => Promise<void>;
  readonly onLoadConfigurationHistory: (
    siteId: string,
  ) => Promise<readonly SiteConfigurationRevision[]>;
  readonly onActivateConfiguration: (input: {
    readonly siteId: string;
    readonly expectedRevision: number;
    readonly yaml: string;
  }) => Promise<SiteConfigurationDetails>;
  readonly onRevertConfiguration: (input: {
    readonly siteId: string;
    readonly expectedRevision: number;
    readonly revision: number;
  }) => Promise<SiteConfigurationDetails>;
}

interface ConflictState {
  readonly latest: Site;
  readonly displayName: string;
  readonly canonicalUrl: string;
}

function formatEventTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function SiteSettings({
  site,
  onLoadEvents,
  onReload,
  onSave,
  onUpdateLifecycle,
  onLoadConfiguration,
  onValidateConfiguration,
  onLoadConfigurationHistory,
  onActivateConfiguration,
  onRevertConfiguration,
}: SiteSettingsProps) {
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState(site.displayName);
  const [canonicalUrl, setCanonicalUrl] = useState(site.canonicalUrl ?? '');
  const [revision, setRevision] = useState(site.updatedAt);
  const [events, setEvents] = useState<readonly SiteAuditEvent[]>([]);
  const [historyState, setHistoryState] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>(
    'idle',
  );
  const [message, setMessage] = useState('');
  const [conflict, setConflict] = useState<ConflictState>();

  function changeOpen(nextOpen: boolean): void {
    setOpen(nextOpen);
    if (!nextOpen) return;
    setDisplayName(site.displayName);
    setCanonicalUrl(site.canonicalUrl ?? '');
    setRevision(site.updatedAt);
    setConflict(undefined);
    setState('idle');
    setMessage('');
    setHistoryState('loading');
    void onLoadEvents(site.id)
      .then((nextEvents) => {
        setEvents(nextEvents);
        setHistoryState('ready');
      })
      .catch(() => {
        setEvents([]);
        setHistoryState('error');
      });
  }

  async function save(input: {
    readonly expectedUpdatedAt: string;
    readonly nextDisplayName: string;
    readonly nextCanonicalUrl: string;
  }): Promise<void> {
    setState('saving');
    setMessage('');
    try {
      const updated = await onSave({
        siteId: site.id,
        expectedUpdatedAt: input.expectedUpdatedAt,
        displayName: input.nextDisplayName.trim(),
        ...(input.nextCanonicalUrl.trim()
          ? { canonicalUrl: input.nextCanonicalUrl.trim() }
          : {}),
      });
      setDisplayName(updated.displayName);
      setCanonicalUrl(updated.canonicalUrl ?? '');
      setRevision(updated.updatedAt);
      setConflict(undefined);
      setState('saved');
      setMessage('站点资料已保存；Markdown、配置文件和发布目标均未修改。');
      const nextEvents = await onLoadEvents(site.id);
      setEvents(nextEvents);
      setHistoryState('ready');
    } catch (reason: unknown) {
      if (
        reason instanceof StudioApiError &&
        reason.code === 'SITE_REVISION_CONFLICT'
      ) {
        try {
          const latest = await onReload(site.id);
          setConflict({
            latest,
            displayName: input.nextDisplayName,
            canonicalUrl: input.nextCanonicalUrl,
          });
          setState('error');
          setMessage('保存前站点资料已在另一处更新。请选择保留哪一版。');
          return;
        } catch {
          setState('error');
          setMessage('站点资料已变化，但暂时无法读取最新版本。请稍后重试。');
          return;
        }
      }
      setState('error');
      setMessage(reason instanceof Error ? reason.message : '站点资料保存失败');
    }
  }

  async function updateLifecycle(
    lifecycleState: 'active' | 'paused' | 'unregistered',
  ): Promise<void> {
    setState('saving');
    setMessage('');
    try {
      const updated = await onUpdateLifecycle({
        siteId: site.id,
        expectedUpdatedAt: revision,
        lifecycleState,
      });
      setRevision(updated.updatedAt);
      setState('saved');
      setMessage(
        lifecycleState === 'active'
          ? '站点已恢复运行。'
          : lifecycleState === 'paused'
            ? '站点已暂停；内容、构建与发布均已锁定。'
            : '站点已解除注册；保留配置与历史以便日后恢复。',
      );
      await onReload(site.id);
    } catch (reason: unknown) {
      setState('error');
      setMessage(reason instanceof Error ? reason.message : '站点状态更新失败');
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={changeOpen}>
      <Dialog.Trigger className="studio2-site-settings-trigger">
        站点资料
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="studio2-dialog-backdrop" />
        <Dialog.Viewport className="studio2-dialog-viewport">
          <Dialog.Popup className="studio2-site-settings-sheet">
            <header>
              <div>
                <p>SITE SETTINGS</p>
                <Dialog.Title>站点资料</Dialog.Title>
                <Dialog.Description>
                  这里只管理 Studio 中的站点身份，不改写 Hexo 配置或公开内容。
                </Dialog.Description>
              </div>
              <Dialog.Close className="studio2-sheet-close" aria-label="关闭">
                ×
              </Dialog.Close>
            </header>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                void save({
                  expectedUpdatedAt: revision,
                  nextDisplayName: displayName,
                  nextCanonicalUrl: canonicalUrl,
                });
              }}
            >
              <label className="studio2-field">
                <span>站点名称</span>
                <input
                  autoFocus
                  maxLength={120}
                  required
                  value={displayName}
                  onChange={(event) => {
                    setDisplayName(event.target.value);
                    setState('idle');
                  }}
                />
              </label>
              <label className="studio2-field">
                <span>公开网址</span>
                <input
                  inputMode="url"
                  type="url"
                  value={canonicalUrl}
                  onChange={(event) => {
                    setCanonicalUrl(event.target.value);
                    setState('idle');
                  }}
                />
              </label>

              {conflict ? (
                <section className="studio2-settings-conflict" role="alert">
                  <header>
                    <b>发现并发修改</b>
                    <span>最新保存版本与你正在编辑的版本不同。</span>
                  </header>
                  <dl>
                    <div>
                      <dt>最新保存</dt>
                      <dd>{conflict.latest.displayName}</dd>
                      <small>
                        {conflict.latest.canonicalUrl ?? '未设置网址'}
                      </small>
                    </div>
                    <div>
                      <dt>我的输入</dt>
                      <dd>{conflict.displayName}</dd>
                      <small>{conflict.canonicalUrl || '未设置网址'}</small>
                    </div>
                  </dl>
                  <div>
                    <button
                      type="button"
                      onClick={() => {
                        setDisplayName(conflict.latest.displayName);
                        setCanonicalUrl(conflict.latest.canonicalUrl ?? '');
                        setRevision(conflict.latest.updatedAt);
                        setConflict(undefined);
                        setState('idle');
                        setMessage('已载入最新保存版本。');
                      }}
                    >
                      载入最新资料
                    </button>
                    <button
                      className="is-primary"
                      disabled={state === 'saving'}
                      type="button"
                      onClick={() =>
                        void save({
                          expectedUpdatedAt: conflict.latest.updatedAt,
                          nextDisplayName: conflict.displayName,
                          nextCanonicalUrl: conflict.canonicalUrl,
                        })
                      }
                    >
                      以我的输入重试
                    </button>
                  </div>
                </section>
              ) : null}

              {message ? (
                <p
                  className={`studio2-form-message is-${state}`}
                  role={state === 'error' ? 'alert' : 'status'}
                >
                  {message}
                </p>
              ) : null}

              <button
                className="studio2-prepare-button"
                disabled={
                  state === 'saving' ||
                  displayName.trim().length === 0 ||
                  Boolean(conflict)
                }
                type="submit"
              >
                {state === 'saving' ? '正在保存…' : '保存站点资料'}
              </button>
            </form>

            <section className="studio2-site-capabilities">
              <h3>当前能力</h3>
              <dl>
                <div>
                  <dt>生成器</dt>
                  <dd>{site.capabilities.generator}</dd>
                </div>
                <div>
                  <dt>资源</dt>
                  <dd>{site.capabilities.assetProvider}</dd>
                </div>
                <div>
                  <dt>发布</dt>
                  <dd>{site.capabilities.publishProvider}</dd>
                </div>
              </dl>
            </section>

            <section className="studio2-site-lifecycle">
              <h3>站点生命周期</h3>
              <p>
                当前：
                {site.lifecycleState === 'active'
                  ? '运行中'
                  : site.lifecycleState === 'paused'
                    ? '已暂停'
                    : '已解除注册'}
              </p>
              <div>
                {site.lifecycleState !== 'active' ? (
                  <button
                    className="is-primary"
                    disabled={state === 'saving'}
                    type="button"
                    onClick={() => void updateLifecycle('active')}
                  >
                    恢复站点
                  </button>
                ) : (
                  <button
                    disabled={state === 'saving'}
                    type="button"
                    onClick={() => void updateLifecycle('paused')}
                  >
                    暂停站点
                  </button>
                )}
                {site.lifecycleState !== 'unregistered' ? (
                  <button
                    disabled={state === 'saving'}
                    type="button"
                    onClick={() => void updateLifecycle('unregistered')}
                  >
                    解除注册
                  </button>
                ) : null}
              </div>
            </section>

            <SiteConfigurationEditor
              siteId={site.id}
              onLoad={onLoadConfiguration}
              onValidate={onValidateConfiguration}
              onLoadHistory={onLoadConfigurationHistory}
              onActivate={onActivateConfiguration}
              onRevert={onRevertConfiguration}
              onActivated={async () => {
                await onReload(site.id);
              }}
            />

            <section className="studio2-site-history">
              <h3>资料修改记录</h3>
              {historyState === 'loading' ? (
                <p role="status">正在读取记录…</p>
              ) : historyState === 'error' ? (
                <p role="alert">暂时无法读取修改记录。</p>
              ) : (
                <ol>
                  {[...events].reverse().map((event) => (
                    <li key={event.sequence}>
                      <i />
                      <div>
                        <b>
                          {event.type === 'registered'
                            ? '注册站点'
                            : '更新站点资料'}
                        </b>
                        <small>
                          {formatEventTime(event.at)} ·{' '}
                          {event.actor === 'owner' ? 'Owner' : '迁移'}
                        </small>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
