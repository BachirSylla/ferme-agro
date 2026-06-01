import { useEffect, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';

type Props = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

// Modal de confirmation basé sur le <dialog> natif (centrage + backdrop gratuits,
// fermeture par Esc, focus trap). Pas de dépendance externe.
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirmer',
  cancelLabel = 'Annuler',
  busy = false,
  onConfirm,
  onCancel,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
      className="rounded-2xl p-0 max-w-sm w-[min(92vw,24rem)] border border-neutral-200 shadow-xl backdrop:bg-black/40"
    >
      <div className="p-5 flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-amber-100 text-amber-700 grid place-items-center shrink-0">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold leading-tight">{title}</h3>
            <p className="text-sm text-neutral-600 mt-1">{message}</p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-1.5 rounded-lg text-sm font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
          >
            {busy ? '…' : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
