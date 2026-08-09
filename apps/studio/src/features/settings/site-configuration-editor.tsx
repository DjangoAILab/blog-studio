import { useEffect, useState } from 'react';
import type { DevelopmentProfileOption } from '@blog-studio/core';
import { parse, stringify } from 'yaml';

import type {
  SiteConfigurationDetails,
  SiteConfigurationRevision,
} from '../../app/api.js';

interface SiteConfigurationEditorProps {
  readonly siteId: string;
  readonly developmentProfileId?: string;
  readonly developmentProfiles: readonly DevelopmentProfileOption[];
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

function selectedDevelopmentProfile(yaml: string): string | undefined {
  try {
    const parsed = parse(yaml) as unknown;
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      !('development' in parsed)
    )
      return undefined;
    const development = (parsed as { development?: unknown }).development;
    if (
      development === null ||
      typeof development !== 'object' ||
      Array.isArray(development) ||
      typeof (development as { profile?: unknown }).profile !== 'string'
    )
      return undefined;
    return (development as { profile: string }).profile;
  } catch {
    return undefined;
  }
}

export function SiteConfigurationEditor({
  siteId,
  developmentProfileId,
  developmentProfiles,
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
  const selectedProfile = selectedDevelopmentProfile(yaml);

  function changeDevelopmentProfile(profile: string): void {
    try {
      const parsed = parse(yaml) as unknown;
      if (
        parsed === null ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed)
      )
        throw new Error('站点配置必须是 YAML 对象');
      const next = { ...(parsed as Record<string, unknown>) };
      if (profile) next.development = { profile };
      else delete next.development;
      setYaml(stringify(next, { lineWidth: 0 }));
      setState('idle');
      setMessage(
        profile
          ? '已选择调试档；验证并激活后生效。'
          : '已停用本地调试；验证并激活后生效。',
      );
    } catch (reason: unknown) {
      setState('error');
      setMessage(
        reason instanceof Error ? reason.message : '无法更新本地调试配置',
      );
    }
  }

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
          <p>
            内容模型可编辑；本地调试只能选择主机预设档，路径、命令、凭据和发布目标仍由主机管理。
          </p>
        </div>
        {configuration ? <span>版本 {configuration.revision}</span> : null}
      </header>
      <section
        className="studio2-development-profile"
        aria-label="本地调试配置"
      >
        <div>
          <h4>本地调试</h4>
          <p>调试命令和环境变量由部署主机维护，不会写入站点配置。</p>
        </div>
        {developmentProfiles.length ? (
          <label>
            <span>调试档</span>
            <select
              aria-label="本地调试档"
              disabled={state === 'loading' || state === 'saving'}
              value={selectedProfile ?? ''}
              onChange={(event) => changeDevelopmentProfile(event.target.value)}
            >
              <option value="">不启用本地调试</option>
              {developmentProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.label}
                  {profile.previewUrl
                    ? ` · ${profile.previewUrl}`
                    : ' · 未配置浏览器预览地址'}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p>当前主机没有提供可选调试档。</p>
        )}
        {developmentProfileId && selectedProfile === developmentProfileId ? (
          <small>当前已启用：{developmentProfileId}</small>
        ) : null}
      </section>
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
