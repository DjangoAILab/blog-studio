import { useState } from 'react';

import type { DocumentPayload } from '../../app/api.js';

interface WorkingCopyConflictProps {
  readonly document: DocumentPayload;
  readonly onKeepWorkingCopy: () => Promise<void>;
  readonly onUseFileVersion: () => Promise<void>;
}

export function WorkingCopyConflict({
  document,
  onKeepWorkingCopy,
  onUseFileVersion,
}: WorkingCopyConflictProps) {
  const [busy, setBusy] = useState<'keep' | 'discard'>();
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [error, setError] = useState('');
  const draft = document.draft;
  if (!draft) return null;

  async function run(
    action: 'keep' | 'discard',
    callback: () => Promise<void>,
  ): Promise<void> {
    setBusy(action);
    setError('');
    try {
      await callback();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '冲突恢复失败');
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <section
      className="studio2-working-conflict"
      aria-labelledby="conflict-title"
    >
      <header>
        <span aria-hidden="true">!</span>
        <div>
          <p>VERSION CONFLICT</p>
          <h2 id="conflict-title">文件版本在编辑期间发生了变化</h2>
          <small>
            Studio
            保留了你的工作副本，也没有覆盖磁盘上的新版。先比较两边，再明确选择下一步。
          </small>
        </div>
      </header>

      <div className="studio2-working-conflict-diff">
        <section>
          <header>
            <b>磁盘上的新版</b>
            <small>当前事实源</small>
          </header>
          <pre>{document.source.body || '（空）'}</pre>
        </section>
        <section>
          <header>
            <b>我的工作副本</b>
            <small>SQLite 草稿 v{draft.version}</small>
          </header>
          <pre>{draft.body || '（空）'}</pre>
        </section>
      </div>

      <div className="studio2-working-conflict-actions">
        <button
          className="is-primary"
          disabled={Boolean(busy)}
          type="button"
          onClick={() => void run('keep', onKeepWorkingCopy)}
        >
          {busy === 'keep' ? '正在保留…' : '以新版为基准保留我的编辑'}
        </button>
        {!confirmDiscard ? (
          <button
            disabled={Boolean(busy)}
            type="button"
            onClick={() => setConfirmDiscard(true)}
          >
            改用磁盘上的新版…
          </button>
        ) : (
          <div className="studio2-working-discard-confirm">
            <span>
              这会删除 SQLite 中的工作副本，但不会删除 Markdown 文件。
            </span>
            <button type="button" onClick={() => setConfirmDiscard(false)}>
              返回
            </button>
            <button
              className="is-danger"
              disabled={Boolean(busy)}
              type="button"
              onClick={() => void run('discard', onUseFileVersion)}
            >
              {busy === 'discard' ? '正在恢复…' : '确认采用文件版本'}
            </button>
          </div>
        )}
      </div>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
