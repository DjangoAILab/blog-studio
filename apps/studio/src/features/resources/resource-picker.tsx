import type { RefObject } from 'react';

export interface ResourceUploadView {
  readonly id: string;
  readonly file: File;
  readonly previewUrl?: string | undefined;
  readonly state: 'uploading' | 'ready' | 'rejected' | 'error';
  readonly kind?: 'image' | 'attachment' | undefined;
  readonly storage?: 'local' | 'remote' | undefined;
  readonly error?: string | undefined;
}

interface ResourcePickerProps {
  readonly accept: readonly string[];
  readonly inputRef: RefObject<HTMLInputElement | null>;
  readonly uploads: readonly ResourceUploadView[];
  readonly orphanResources?:
    | {
        readonly count: number;
        readonly storage: 'local' | 'remote';
        readonly busy: boolean;
        readonly error?: string;
      }
    | undefined;
  readonly onPick: (file: File) => void;
  readonly onDismiss: (upload: ResourceUploadView) => void;
  readonly onDeleteOrphans: () => void;
  readonly onRetry: (upload: ResourceUploadView) => void;
}

function mediaLabel(file: File): string {
  if (file.type.startsWith('image/')) return '图片';
  if (file.type === 'application/pdf') return 'PDF';
  if (file.type.startsWith('text/')) return '文本';
  return '附件';
}

export function ResourcePicker({
  accept,
  inputRef,
  uploads,
  orphanResources,
  onPick,
  onDismiss,
  onDeleteOrphans,
  onRetry,
}: ResourcePickerProps) {
  return (
    <div className="studio3-resource-picker">
      <button
        className="studio3-resource-button"
        type="button"
        onClick={() => inputRef.current?.click()}
      >
        <span aria-hidden="true">⌁</span>
        插入资源
      </button>
      <input
        ref={inputRef}
        hidden
        aria-label="选择资源文件"
        type="file"
        accept={accept.join(',')}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onPick(file);
          event.target.value = '';
        }}
      />
      {uploads.length || orphanResources?.count ? (
        <div className="studio3-resource-toast-stack" aria-live="polite">
          {uploads.slice(-3).map((upload) => (
            <div
              className={`studio3-resource-toast is-${upload.state}`}
              key={upload.id}
            >
              {upload.previewUrl && upload.file.type.startsWith('image/') ? (
                <img alt="" src={upload.previewUrl} />
              ) : (
                <span className="studio3-file-glyph" aria-hidden="true">
                  {upload.file.type === 'application/pdf' ? 'PDF' : 'DOC'}
                </span>
              )}
              <span>
                <b>{upload.file.name}</b>
                <small>
                  {upload.state === 'uploading'
                    ? `${mediaLabel(upload.file)}正在安全检查…`
                    : upload.state === 'ready'
                      ? `${mediaLabel(upload.file)}已插入 · ${upload.storage === 'remote' ? '远端存储' : '本地存储'}`
                      : upload.state === 'rejected'
                        ? `已拒绝，未存储 · ${upload.error}`
                        : upload.error}
                </small>
              </span>
              {upload.state === 'error' ? (
                <button type="button" onClick={() => onRetry(upload)}>
                  重试
                </button>
              ) : upload.state === 'rejected' ? (
                <button type="button" onClick={() => onDismiss(upload)}>
                  移除
                </button>
              ) : (
                <i aria-hidden="true">{upload.state === 'ready' ? '✓' : ''}</i>
              )}
            </div>
          ))}
          {orphanResources?.count ? (
            <div className="studio3-orphan-resources" role="status">
              <span>
                <b>{orphanResources.count} 个未引用资源</b>
                <small>
                  位于
                  {orphanResources.storage === 'remote' ? '远端' : '本地'}，
                  删除前会再次核对文章引用与版本。
                </small>
                {orphanResources.error ? (
                  <em>{orphanResources.error}</em>
                ) : null}
              </span>
              <button
                disabled={orphanResources.busy}
                type="button"
                onClick={onDeleteOrphans}
              >
                {orphanResources.busy ? '正在核对…' : '审阅并清理'}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
