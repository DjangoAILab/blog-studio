import { Dialog } from '@base-ui/react/dialog';

interface ConfirmDialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly description: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly danger?: boolean;
  readonly busy?: boolean;
  readonly onConfirm: () => void;
  readonly onOpenChange: (open: boolean) => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = '确认',
  cancelLabel = '取消',
  danger = false,
  busy = false,
  onConfirm,
  onOpenChange,
}: ConfirmDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="studio2-dialog-backdrop" />
        <Dialog.Viewport className="studio2-dialog-viewport is-center">
          <Dialog.Popup className="studio2-dialog-card">
            <header>
              <div>
                <Dialog.Title>{title}</Dialog.Title>
                <Dialog.Description>{description}</Dialog.Description>
              </div>
              <Dialog.Close className="studio2-sheet-close" aria-label="关闭">
                ×
              </Dialog.Close>
            </header>
            <div className="studio2-dialog-actions">
              <button
                className="studio2-secondary-button"
                type="button"
                disabled={busy}
                onClick={() => onOpenChange(false)}
              >
                {cancelLabel}
              </button>
              <button
                className={
                  danger ? 'studio2-danger-button' : 'studio2-primary-button'
                }
                type="button"
                disabled={busy}
                onClick={onConfirm}
              >
                {busy ? '处理中…' : confirmLabel}
              </button>
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
