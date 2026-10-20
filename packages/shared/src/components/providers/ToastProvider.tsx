'use client';
import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'warning' | 'info';
interface Toast {
  id: string;
  type: ToastType;
  message: string;
}

const ToastContext = createContext<{
  toast: (type: ToastType, message: string) => void;
  showToast: (message: string, type?: ToastType) => void;
}>({
  toast: () => {},
  showToast: () => {},
});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => () => {
    timers.current.forEach((timer) => clearTimeout(timer));
    timers.current.clear();
  }, []);

  const remove = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((type: ToastType, message: string) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, type, message }]);
    const timer = setTimeout(() => remove(id), 5000);
    timers.current.set(id, timer);
  }, [remove]);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    toast(type, message);
  }, [toast]);

  const icons = {
    success: <CheckCircle className="w-4 h-4 text-emerald-500" />,
    error: <XCircle className="w-4 h-4 text-red-500" />,
    warning: <AlertTriangle className="w-4 h-4 text-amber-500" />,
    info: <Info className="w-4 h-4 text-blue-500" />,
  };

  const colors = {
    success: 'border-emerald-500/30',
    error: 'border-red-500/30',
    warning: 'border-amber-500/30',
    info: 'border-blue-500/30',
  };

  return (
    <ToastContext.Provider value={{ toast, showToast }}>
      {children}
      <div
        className="fixed inset-x-3 bottom-3 z-[9999] flex flex-col items-end gap-2 sm:inset-x-auto sm:right-4 sm:bottom-4"
        aria-live="polite"
        aria-relevant="additions text"
        aria-atomic="false"
      >
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, x: 60, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 60, scale: 0.9 }}
              transition={{ type: 'spring', damping: 20, stiffness: 300 }}
              role={t.type === 'error' ? 'alert' : 'status'}
              className={`flex w-full items-center gap-3 rounded-lg border bg-[var(--bg-card)] px-4 py-3 text-[var(--text-primary)] shadow-lg sm:min-w-[260px] sm:max-w-sm ${colors[t.type]}`}
            >
              {icons[t.type]}
              <span className="min-w-0 flex-1 text-sm">{t.message}</span>
              <button
                type="button"
                onClick={() => remove(t.id)}
                aria-label="Dismiss notification"
                className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded text-[var(--text-muted)] transition hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)]"
              >
                <X className="h-4 w-4" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
