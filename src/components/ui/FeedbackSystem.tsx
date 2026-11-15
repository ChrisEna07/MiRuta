import React, { createContext, useContext, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Info,
  Loader2,
  X,
  Trash2,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';

function triggerHaptic(kind: 'success' | 'error' | 'light') {
  try {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      if (kind === 'success') navigator.vibrate([35, 30, 50]);
      else if (kind === 'error') navigator.vibrate([70, 40, 70]);
      else navigator.vibrate(25);
    }
  } catch {
    // Ignore on unsupported devices
  }
}

export type ToastType = 'success' | 'error' | 'warning' | 'info' | 'loading';

export interface ToastItem {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
  duration?: number;
}

export interface ConfirmStep {
  label: string;
  status: 'pending' | 'running' | 'done' | 'error';
}

export interface ConfirmOptions {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'info' | 'success';
  details?: string[];
  requireStepProgress?: boolean;
  steps?: string[];
  onExecuteWithSteps?: (updateStep: (stepIndex: number, status: ConfirmStep['status']) => void) => Promise<void>;
}

interface ToastContextValue {
  success: (title: string, description?: string, duration?: number) => string;
  error: (title: string, description?: string, duration?: number) => string;
  warning: (title: string, description?: string, duration?: number) => string;
  info: (title: string, description?: string, duration?: number) => string;
  loading: (title: string, description?: string) => string;
  updateToast: (id: string, updates: Partial<Omit<ToastItem, 'id'>>) => void;
  dismiss: (id: string) => void;
}

interface ConfirmContextValue {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const ToastContext = createContext<ToastContextValue | null>(null);
const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export const useToast = (): ToastContextValue => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast debe usarse dentro de FeedbackProvider');
  return ctx;
};

export const useConfirm = (): ConfirmContextValue => {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm debe usarse dentro de FeedbackProvider');
  return ctx;
};

export const FeedbackProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [activeConfirm, setActiveConfirm] = useState<{
    options: ConfirmOptions;
    resolve: (val: boolean) => void;
  } | null>(null);
  const [confirmRunning, setConfirmRunning] = useState(false);
  const [confirmSteps, setConfirmSteps] = useState<ConfirmStep[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    (type: ToastType, title: string, description?: string, duration = 3500): string => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      if (type === 'success') triggerHaptic('success');
      else if (type === 'error' || type === 'warning') triggerHaptic('error');
      else triggerHaptic('light');

      setToasts((prev) => [...prev.slice(-3), { id, type, title, description, duration }]);

      if (type !== 'loading' && duration > 0) {
        setTimeout(() => {
          dismiss(id);
        }, duration);
      }
      return id;
    },
    [dismiss]
  );

  const updateToast = useCallback(
    (id: string, updates: Partial<Omit<ToastItem, 'id'>>) => {
      setToasts((prev) =>
        prev.map((t) => {
          if (t.id !== id) return t;
          const updated = { ...t, ...updates };
          if (updates.type && updates.type !== 'loading') {
            const dur = updates.duration ?? 3500;
            setTimeout(() => dismiss(id), dur);
          }
          return updated;
        })
      );
    },
    [dismiss]
  );

  const toastApi: ToastContextValue = {
    success: (title, description, duration) => addToast('success', title, description, duration),
    error: (title, description, duration) => addToast('error', title, description, duration),
    warning: (title, description, duration) => addToast('warning', title, description, duration),
    info: (title, description, duration) => addToast('info', title, description, duration),
    loading: (title, description) => addToast('loading', title, description, 0),
    updateToast,
    dismiss,
  };

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    triggerHaptic('light');
    if (options.steps && options.steps.length > 0) {
      setConfirmSteps(options.steps.map((label) => ({ label, status: 'pending' })));
    } else {
      setConfirmSteps([]);
    }
    setConfirmRunning(false);
    return new Promise<boolean>((resolve) => {
      setActiveConfirm({ options, resolve });
    });
  }, []);

  const handleConfirmCancel = () => {
    if (confirmRunning) return;
    if (activeConfirm) {
      activeConfirm.resolve(false);
      setActiveConfirm(null);
    }
  };

  const handleConfirmAccept = async () => {
    if (!activeConfirm || confirmRunning) return;

    if (activeConfirm.options.onExecuteWithSteps) {
      setConfirmRunning(true);
      const updateStep = (idx: number, status: ConfirmStep['status']) => {
        setConfirmSteps((prev) =>
          prev.map((s, i) => (i === idx ? { ...s, status } : s))
        );
      };
      try {
        await activeConfirm.options.onExecuteWithSteps(updateStep);
        triggerHaptic('success');
        setTimeout(() => {
          activeConfirm.resolve(true);
          setActiveConfirm(null);
          setConfirmRunning(false);
        }, 450);
      } catch {
        setConfirmRunning(false);
      }
    } else {
      triggerHaptic('success');
      activeConfirm.resolve(true);
      setActiveConfirm(null);
    }
  };

  return (
    <ToastContext.Provider value={toastApi}>
      <ConfirmContext.Provider value={{ confirm }}>
        {children}

        {/* Floating Toasts Stack */}
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[120] w-full max-w-md px-3 pointer-events-none flex flex-col gap-2">
          <AnimatePresence>
            {toasts.map((t) => {
              const styles = {
                success: {
                  bg: 'bg-slate-900/95 border-emerald-500/50 text-emerald-100 shadow-emerald-950/50',
                  bar: 'bg-emerald-500',
                  icon: <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />,
                },
                error: {
                  bg: 'bg-slate-900/95 border-rose-500/60 text-rose-100 shadow-rose-950/50',
                  bar: 'bg-rose-500',
                  icon: <XCircle className="w-5 h-5 text-rose-400 shrink-0" />,
                },
                warning: {
                  bg: 'bg-slate-900/95 border-amber-500/60 text-amber-100 shadow-amber-950/50',
                  bar: 'bg-amber-400',
                  icon: <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />,
                },
                info: {
                  bg: 'bg-slate-900/95 border-indigo-500/50 text-indigo-100 shadow-indigo-950/50',
                  bar: 'bg-indigo-500',
                  icon: <Info className="w-5 h-5 text-indigo-400 shrink-0" />,
                },
                loading: {
                  bg: 'bg-slate-900/95 border-sky-500/50 text-sky-100 shadow-sky-950/50',
                  bar: 'bg-sky-400',
                  icon: <Loader2 className="w-5 h-5 text-sky-400 shrink-0 animate-spin" />,
                },
              }[t.type];

              return (
                <motion.div
                  key={t.id}
                  initial={{ opacity: 0, y: -24, scale: 0.94 }}
                  animate={
                    t.type === 'error'
                      ? { opacity: 1, y: 0, scale: 1, x: [0, -6, 6, -4, 4, 0] }
                      : { opacity: 1, y: 0, scale: 1 }
                  }
                  exit={{ opacity: 0, y: -16, scale: 0.94 }}
                  transition={{ duration: 0.25 }}
                  className={`pointer-events-auto relative overflow-hidden rounded-2xl border backdrop-blur-xl p-3.5 shadow-2xl ${styles.bg}`}
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5">{styles.icon}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-black tracking-wide leading-snug text-white">
                        {t.title}
                      </p>
                      {t.description && (
                        <p className="text-[11px] text-slate-300 mt-0.5 leading-relaxed">
                          {t.description}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => dismiss(t.id)}
                      className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/70 transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {t.type !== 'loading' && (t.duration ?? 3500) > 0 && (
                    <motion.div
                      initial={{ width: '100%' }}
                      animate={{ width: '0%' }}
                      transition={{ duration: (t.duration ?? 3500) / 1000, ease: 'linear' }}
                      className={`absolute bottom-0 left-0 h-0.5 ${styles.bar}`}
                    />
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>

        {/* Interactive ConfirmDialogModal */}
        <AnimatePresence>
          {activeConfirm && (
            <div className="fixed inset-0 z-[130] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.92, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.92, y: 12 }}
                transition={{ duration: 0.2 }}
                className="w-full max-w-md rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden p-5 space-y-4"
              >
                <div className="flex items-start gap-3.5">
                  <div
                    className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 border ${
                      activeConfirm.options.variant === 'danger'
                        ? 'bg-rose-500/15 border-rose-500/40 text-rose-400'
                        : activeConfirm.options.variant === 'warning'
                        ? 'bg-amber-500/15 border-amber-500/40 text-amber-400'
                        : activeConfirm.options.variant === 'success'
                        ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
                        : 'bg-indigo-500/15 border-indigo-500/40 text-indigo-400'
                    }`}
                  >
                    {activeConfirm.options.variant === 'danger' ? (
                      <Trash2 className="w-6 h-6" />
                    ) : activeConfirm.options.variant === 'warning' ? (
                      <ShieldAlert className="w-6 h-6" />
                    ) : (
                      <Sparkles className="w-6 h-6" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base font-black text-white leading-tight">
                      {activeConfirm.options.title}
                    </h3>
                    <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                      {activeConfirm.options.description}
                    </p>
                  </div>
                </div>

                {activeConfirm.options.details && activeConfirm.options.details.length > 0 && (
                  <div className="rounded-2xl bg-slate-950/90 border border-slate-800 p-3 space-y-1.5">
                    {activeConfirm.options.details.map((item, idx) => (
                      <div key={idx} className="flex items-start gap-2 text-[11px] text-slate-300">
                        <span className="text-emerald-400 font-bold">•</span>
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                )}

                {confirmSteps.length > 0 && (
                  <div className="rounded-2xl bg-slate-950/90 border border-slate-800 p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      <span>Progreso de Seguridad</span>
                      <span>
                        {confirmSteps.filter((s) => s.status === 'done').length}/{confirmSteps.length}
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-indigo-500 to-emerald-400 transition-all duration-300"
                        style={{
                          width: `${
                            (confirmSteps.filter((s) => s.status === 'done').length /
                              confirmSteps.length) *
                            100
                          }%`,
                        }}
                      />
                    </div>
                    <div className="space-y-1.5 pt-1">
                      {confirmSteps.map((step, idx) => (
                        <div
                          key={idx}
                          className={`flex items-center justify-between text-xs px-2.5 py-1.5 rounded-xl border ${
                            step.status === 'done'
                              ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300 font-bold'
                              : step.status === 'running'
                              ? 'bg-indigo-950/40 border-indigo-500/40 text-indigo-200 font-bold'
                              : 'bg-slate-900/50 border-slate-800/70 text-slate-400'
                          }`}
                        >
                          <span>{step.label}</span>
                          <span>
                            {step.status === 'done' ? (
                              '✅'
                            ) : step.status === 'running' ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                            ) : (
                              '⏳'
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2.5 pt-1">
                  <button
                    type="button"
                    disabled={confirmRunning}
                    onClick={handleConfirmCancel}
                    className="py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 font-bold text-xs transition-all active:scale-95"
                  >
                    {activeConfirm.options.cancelLabel || 'Cancelar'}
                  </button>
                  <button
                    type="button"
                    disabled={confirmRunning}
                    onClick={handleConfirmAccept}
                    className={`py-3 px-4 rounded-xl font-black text-xs text-white flex items-center justify-center gap-2 transition-all active:scale-95 shadow-lg disabled:opacity-60 ${
                      activeConfirm.options.variant === 'danger'
                        ? 'bg-gradient-to-r from-rose-600 to-amber-600 hover:from-rose-500 hover:to-amber-500 shadow-rose-950/50'
                        : activeConfirm.options.variant === 'warning'
                        ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-amber-950/40'
                        : 'bg-gradient-to-r from-indigo-600 to-emerald-600 hover:from-indigo-500 hover:to-emerald-500 shadow-indigo-950/50'
                    }`}
                  >
                    {confirmRunning ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Procesando...
                      </>
                    ) : (
                      activeConfirm.options.confirmLabel || 'Confirmar'
                    )}
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </ConfirmContext.Provider>
    </ToastContext.Provider>
  );
};
