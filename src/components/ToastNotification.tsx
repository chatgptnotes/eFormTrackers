import { createContext, useContext, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Bell, FileCheck, AlertTriangle, Clock, UserPlus } from 'lucide-react';

interface Toast {
  id: string;
  type?: string;
  title: string;
  message: string;
}

interface ToastContextValue {
  addToast: (toast: Omit<Toast, 'id'>) => void;
}

const ToastContext = createContext<ToastContextValue>({ addToast: () => {} });

export const useToast = () => useContext(ToastContext);

const TYPE_ICONS: Record<string, typeof Bell> = {
  submission: FileCheck,
  sla_breach: AlertTriangle,
  approval_needed: Clock,
  escalation: AlertTriangle,
  team_invite: UserPlus,
};

const TYPE_BG: Record<string, string> = {
  submission: 'border-blue-500/40',
  sla_breach: 'border-red-500/40',
  approval_needed: 'border-amber-500/40',
  escalation: 'border-red-500/40',
  team_invite: 'border-emerald-500/40',
};

const TYPE_ICON_COLOR: Record<string, string> = {
  submission: 'text-blue-400',
  sla_breach: 'text-red-400',
  approval_needed: 'text-amber-400',
  escalation: 'text-red-400',
  team_invite: 'text-emerald-400',
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const addToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts(prev => [...prev.slice(-2), { ...toast, id }]); // max 3
    const timer = setTimeout(() => removeToast(id), 5000);
    timers.current.set(id, timer);
  }, [removeToast]);

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-3 pointer-events-none">
        <AnimatePresence mode="popLayout">
          {toasts.map(toast => {
            const Icon = TYPE_ICONS[toast.type || ''] || Bell;
            const borderColor = TYPE_BG[toast.type || ''] || 'border-gray-500/40';
            const iconColor = TYPE_ICON_COLOR[toast.type || ''] || 'text-gray-400';

            return (
              <motion.div
                key={toast.id}
                layout
                initial={{ x: 400, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: 400, opacity: 0 }}
                transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                className={`pointer-events-auto w-80 bg-navy-dark/95 backdrop-blur-xl border-l-4 ${borderColor} rounded-lg shadow-2xl shadow-black/40 p-4`}
              >
                <div className="flex gap-3">
                  <Icon className={`w-5 h-5 mt-0.5 flex-shrink-0 ${iconColor}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-semibold text-white">{toast.title}</span>
                      <button
                        onClick={() => removeToast(toast.id)}
                        className="text-gray-500 hover:text-white transition-colors flex-shrink-0"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <p className="text-xs text-gray-400 mt-1 line-clamp-2">{toast.message}</p>
                  </div>
                </div>
                {/* Progress bar */}
                <motion.div
                  initial={{ scaleX: 1 }}
                  animate={{ scaleX: 0 }}
                  transition={{ duration: 5, ease: 'linear' }}
                  className={`absolute bottom-0 left-0 right-0 h-0.5 bg-gold/50 origin-left rounded-b-lg`}
                />
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
