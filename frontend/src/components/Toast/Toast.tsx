import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { CheckCircle, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastMessage {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

interface ToastContextType {
  addToast: (message: string, type: ToastType, duration?: number) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

interface ToastProviderProps {
  children: React.ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((message: string, type: ToastType, duration = 4000) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type, duration }]);
  }, []);

  return (
    <ToastContext.Provider value={{ addToast, removeToast }}>
      {children}
      <div className="fixed bottom-5 right-5 z-[9999] flex flex-col gap-3 max-w-sm w-full pointer-events-none">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onClose={removeToast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

interface ToastItemProps {
  toast: ToastMessage;
  onClose: (id: string) => void;
}

function ToastItem({ toast, onClose }: ToastItemProps) {
  const { id, message, type, duration = 4000 } = toast;

  useEffect(() => {
    const timer = setTimeout(() => {
      onClose(id);
    }, duration);
    return () => clearTimeout(timer);
  }, [id, duration, onClose]);

  const getIcon = () => {
    switch (type) {
      case 'success':
        return <CheckCircle className="text-emerald-400 shrink-0" size={16} />;
      case 'error':
        return <AlertCircle className="text-rose-400 shrink-0" size={16} />;
      case 'warning':
        return <AlertTriangle className="text-amber-400 shrink-0" size={16} />;
      case 'info':
      default:
        return <Info className="text-sky-400 shrink-0" size={16} />;
    }
  };

  const getBorderColor = () => {
    switch (type) {
      case 'success':
        return 'border-emerald-500/20 shadow-emerald-950/20';
      case 'error':
        return 'border-rose-500/20 shadow-rose-950/20';
      case 'warning':
        return 'border-amber-500/20 shadow-amber-950/20';
      case 'info':
      default:
        return 'border-sky-500/20 shadow-sky-950/20';
    }
  };

  return (
    <div
      className={`pointer-events-auto flex items-start gap-3 rounded-xl border bg-[#0d0c14]/90 p-4 shadow-[0_8px_32px_rgba(0,0,0,0.4)] backdrop-blur-md transition-all duration-300 animate-slide-in ${getBorderColor()}`}
      role="alert"
    >
      <div className="mt-0.5">{getIcon()}</div>
      <div className="flex-1 text-[13px] font-medium leading-5 text-zinc-200">{message}</div>
      <button
        onClick={() => onClose(id)}
        className="text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer focus:outline-none"
      >
        <X size={14} />
      </button>
    </div>
  );
}
