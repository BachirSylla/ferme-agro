import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';

type Tone = 'success' | 'error';
type Toast = { id: string; tone: Tone; message: string };

type ToastContextValue = {
  push: (tone: Tone, message: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);
const DURATION_MS = 3500;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (tone: Tone, message: string) => {
      const id = crypto.randomUUID();
      setToasts((prev) => [...prev, { id, tone, message }]);
      window.setTimeout(() => dismiss(id), DURATION_MS);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Conteneur fixé en haut, hors flow ; le contenu reste cliquable. */}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-50 flex flex-col items-center gap-2 safe-top">
        {toasts.map((t) => (
          <ToastView key={t.id} toast={t} onClose={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast doit être utilisé à l\u2019intérieur de <ToastProvider>.');
  return ctx;
}

function ToastView({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const palette =
    toast.tone === 'success'
      ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
      : 'bg-red-50 border-red-300 text-red-900';
  const Icon = toast.tone === 'success' ? CheckCircle2 : AlertCircle;
  return (
    <div
      role="status"
      className={
        'pointer-events-auto toast-in flex items-center gap-2 max-w-sm w-[min(92vw,28rem)] px-3 py-2 ' +
        `rounded-xl border shadow-sm ${palette}`
      }
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="text-sm flex-1">{toast.message}</span>
      <button
        type="button"
        onClick={onClose}
        className="opacity-60 hover:opacity-100"
        aria-label="Fermer"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
