import { Dialog } from '@base-ui/react/dialog';
import { useEffect, useState } from 'react';

import type { DevelopmentDetails } from '../../app/api.js';
import { LocalDevelopment } from './local-development.js';

interface LocalDebugControlProps {
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
  failed: '失败',
};

export function LocalDebugControl({
  siteId,
  configured,
  profilesAvailable,
  onConfigure,
  onLoad,
  onControl,
}: LocalDebugControlProps) {
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState<DevelopmentDetails>({
    workspaceId: '',
    status: 'stopped',
    logs: [],
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    const refresh = () =>
      void onLoad(siteId)
        .then((next) => {
          if (!cancelled) setDetails(next);
        })
        .catch(() => undefined);
    refresh();
    const timer =
      details.status === 'starting' || busy
        ? window.setInterval(refresh, 1500)
        : undefined;
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, [busy, configured, details.status, onLoad, siteId]);

  async function start(): Promise<void> {
    setBusy(true);
    try {
      setDetails(await onControl(siteId, 'start'));
    } finally {
      setBusy(false);
    }
  }

  const waiting = busy || details.status === 'starting';

  return (
    <div className="studio2-debug-control">
      {details.status === 'ready' && details.previewUrl ? (
        <a
          className="studio2-secondary-button"
          href={details.previewUrl}
          rel="noreferrer"
          target="_blank"
        >
          打开本地站点
        </a>
      ) : (
        <button
          className="studio2-secondary-button"
          type="button"
          disabled={!configured || waiting}
          onClick={() => void start()}
        >
          {waiting ? '启动中…' : '启动本地站点'}
        </button>
      )}
      <button
        className={`studio2-debug-status is-${waiting ? 'starting' : details.status}`}
        type="button"
        onClick={() => setOpen(true)}
      >
        {waiting ? (
          <>
            <span className="studio2-loading-orb" />
            启动中，可能需要一会儿
          </>
        ) : (
          statusLabel[details.status]
        )}
      </button>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="studio2-dialog-backdrop" />
          <Dialog.Viewport className="studio2-dialog-viewport is-center">
            <Dialog.Popup className="studio2-dialog-card is-wide">
              <header>
                <div>
                  <Dialog.Title>本地调试站点</Dialog.Title>
                  <Dialog.Description>
                    在隔离副本中启动站点预览，不会改动当前磁盘稿。
                  </Dialog.Description>
                </div>
                <Dialog.Close className="studio2-sheet-close" aria-label="关闭">
                  ×
                </Dialog.Close>
              </header>
              <LocalDevelopment
                configured={configured}
                profilesAvailable={profilesAvailable}
                siteId={siteId}
                onConfigure={onConfigure}
                onLoad={onLoad}
                onControl={onControl}
              />
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
