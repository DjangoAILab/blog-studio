import { useEffect, useState } from 'react';

import type { DevelopmentDetails } from '../../app/api.js';

interface LocalDevelopmentProps {
  readonly siteId: string;
  readonly configured: boolean;
  readonly profilesAvailable: boolean;
  readonly onConfigure: () => void;
  readonly onLoad: (siteId: string) => Promise<DevelopmentDetails>;
  readonly onControl: (
    siteId: string,
    action: 'start' | 'restart' | 'stop',
  ) => Promise<DevelopmentDetails>;
}

const statusLabel: Record<DevelopmentDetails['status'], string> = {
  stopped: '未启动',
  starting: '启动中',
  ready: '已就绪',
  failed: '启动失败',
};

export function LocalDevelopment({
  siteId,
  configured,
  profilesAvailable,
  onConfigure,
  onLoad,
  onControl,
}: LocalDevelopmentProps) {
  const [details, setDetails] = useState<DevelopmentDetails>({
    workspaceId: '',
    status: 'stopped',
    logs: [],
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!configured) return;
    void onLoad(siteId)
      .then(setDetails)
      .catch(() => undefined);
  }, [configured, onLoad, siteId]);

  if (!configured)
    return (
      <section className="studio2-local-development">
        <p>
          {profilesAvailable
            ? '本地调试尚未启用。选择主机预设的调试档后，即可在隔离副本中启动。'
            : '此站点尚未提供本地调试档。请由部署主机管理员配置。'}
        </p>
        {profilesAvailable ? (
          <button type="button" onClick={onConfigure}>
            配置本地调试
          </button>
        ) : null}
      </section>
    );

  async function control(action: 'start' | 'restart' | 'stop'): Promise<void> {
    setBusy(true);
    try {
      setDetails(await onControl(siteId, action));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="studio2-local-development" aria-label="本地调试">
      <header>
        <div>
          <p>LOCAL DEVELOPMENT</p>
          <h2>本地调试站点</h2>
        </div>
        <span className={`is-${details.status}`}>
          {statusLabel[details.status]}
        </span>
      </header>
      <p>
        运行命令只会在隔离的站点副本中执行；磁盘上的当前稿会在下一次启动或重启时同步。
      </p>
      {details.message ? <p role="alert">{details.message}</p> : null}
      <div>
        {details.status === 'ready' ? (
          <>
            {details.previewUrl ? (
              <a href={details.previewUrl} rel="noreferrer" target="_blank">
                打开本地站点
              </a>
            ) : (
              <p role="alert">
                浏览器预览地址尚未配置。请由部署主机管理员在调试档中设置
                previewUrl 和对应入口。
              </p>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => void control('restart')}
            >
              重启
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void control('stop')}
            >
              停止
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => void control('start')}
          >
            启动本地站点
          </button>
        )}
      </div>
      {details.logs.length > 0 ? (
        <pre aria-label="本地调试日志">{details.logs.join('\n')}</pre>
      ) : null}
    </section>
  );
}
