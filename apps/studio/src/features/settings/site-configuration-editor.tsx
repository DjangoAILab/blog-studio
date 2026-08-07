import { useEffect, useState } from 'react';

import type {
  SiteConfigurationDetails,
  SiteConfigurationRevision,
} from '../../app/api.js';

interface SiteConfigurationEditorProps {
  readonly siteId: string;
  readonly onLoad: (siteId: string) => Promise<SiteConfigurationDetails>;
  readonly onValidate: (siteId: string, yaml: string) => Promise<void>;
  readonly onLoadHistory: (
    siteId: string,
  ) => Promise<readonly SiteConfigurationRevision[]>;
  readonly onActivate: (input: {
    readonly siteId: string;
    readonly expectedRevision: number;
    readonly yaml: string;
  }) => Promise<SiteConfigurationDetails>;
  readonly onRevert: (input: {
    readonly siteId: string;
    readonly expectedRevision: number;
    readonly revision: number;
  }) => Promise<SiteConfigurationDetails>;
  readonly onActivated: () => Promise<void>;
}

export function SiteConfigurationEditor({
  siteId,
  onLoad,
  onValidate,
  onLoadHistory,
  onActivate,
  onRevert,
  onActivated,
}: SiteConfigurationEditorProps) {
  const [configuration, setConfiguration] =
    useState<SiteConfigurationDetails>();
  const [yaml, setYaml] = useState('');
  const [history, setHistory] = useState<readonly SiteConfigurationRevision[]>(
    [],
  );
  const [state, setState] = useState<'loading' | 'idle' | 'saving' | 'error'>(
    'loading',
  );
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    void Promise.all([onLoad(siteId), onLoadHistory(siteId)])
      .then(([loaded, revisions]) => {
        if (cancelled) return;
        setConfiguration(loaded);
        setYaml(loaded.yaml);
        setHistory(revisions);
        setState('idle');
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setState('error');
        setMessage(
          reason instanceof Error ? reason.message : '无法读取站点配置',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [onLoad, onLoadHistory, siteId]);

  async function validate(): Promise<void> {
    setState('saving');
    setMessage('');
    try {
      await onValidate(siteId, yaml);
      setState('idle');
      setMessage('配置有效，尚未激活。');
    } catch (reason: unknown) {
      setState('error');
      setMessage(reason instanceof Error ? reason.message : '配置无效');
    }
  }

  async function activate(): Promise<void> {
    if (!configuration) return;
    setState('saving');
    setMessage('');
    try {
      const activated = await onActivate({
        siteId,
        expectedRevision: configuration.revision,
        yaml,
      });
      setConfiguration(activated);
      setYaml(activated.yaml);
      setHistory((revisions) => [activated, ...revisions]);
      await onActivated();
      setState('idle');
      setMessage(`已激活配置版本 ${activated.revision}。`);
    } catch (reason: unknown) {
      setState('error');
      setMessage(reason instanceof Error ? reason.message : '配置激活失败');
    }
  }

  async function revert(revision: SiteConfigurationRevision): Promise<void> {
    if (!configuration || revision.revision === configuration.revision) return;
    setState('saving');
    setMessage('');
    try {
      const activated = await onRevert({
        siteId,
        expectedRevision: configuration.revision,
        revision: revision.revision,
      });
      setConfiguration(activated);
      setYaml(activated.yaml);
      setHistory((revisions) => [activated, ...revisions]);
      await onActivated();
      setState('idle');
      setMessage(
        `已恢复版本 ${revision.revision}，当前为版本 ${activated.revision}。`,
      );
    } catch (reason: unknown) {
      setState('error');
      setMessage(reason instanceof Error ? reason.message : '配置恢复失败');
    }
  }

  return (
    <section className="studio2-site-configuration" aria-label="站点配置">
      <header>
        <div>
          <h3>站点配置</h3>
          <p>仅可编辑内容模型和本地调试；路径、凭据、发布目标仍由主机管理。</p>
        </div>
        {configuration ? <span>版本 {configuration.revision}</span> : null}
      </header>
      <textarea
        aria-label="站点配置 YAML"
        disabled={state === 'loading' || state === 'saving'}
        value={yaml}
        onChange={(event) => setYaml(event.target.value)}
      />
      {message ? (
        <p role={state === 'error' ? 'alert' : 'status'}>{message}</p>
      ) : null}
      <div>
        <button
          type="button"
          disabled={state === 'loading' || state === 'saving'}
          onClick={() => void validate()}
        >
          验证配置
        </button>
        <button
          className="is-primary"
          type="button"
          disabled={state === 'loading' || state === 'saving'}
          onClick={() => void activate()}
        >
          激活配置
        </button>
      </div>
      {history.length > 1 ? (
        <details className="studio2-site-configuration-history">
          <summary>配置历史（{history.length}）</summary>
          <ol>
            {history.map((revision) => (
              <li key={revision.revision}>
                <span>
                  版本 {revision.revision} · {revision.source}
                </span>
                {revision.revision === configuration?.revision ? (
                  <small>当前</small>
                ) : (
                  <button
                    type="button"
                    disabled={state === 'loading' || state === 'saving'}
                    onClick={() => void revert(revision)}
                  >
                    恢复此版
                  </button>
                )}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </section>
  );
}
