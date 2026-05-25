'use client';

import { useEffect, useState } from 'react';
import { X, CheckCircle, AlertTriangle, AlertCircle, Info } from 'lucide-react';
import { useUIStore } from '@/store/ui';

const TOAST_DURATION = 5000;

export function Toasts() {
  const toasts = useUIStore((state) => state.toasts);
  const removeToast = useUIStore((state) => state.removeToast);

  // Collision-avoid with FirstWinWizard (bottom-4 right-4 w-80, z-40).
  // Both components live in the same corner; without an offset, toasts
  // cover the wizard whenever they fire. When the wizard is dismissed
  // (or already done), toasts return to their normal bottom-4 anchor.
  // Polled every 2s — cheaper than wiring a global pub-sub for one flag.
  const [wizardVisible, setWizardVisible] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const check = () => {
      const dismissed = window.localStorage.getItem('concord_first_win_dismissed') === 'true';
      setWizardVisible(!dismissed);
    };
    check();
    const id = setInterval(check, 2000);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      role="region"
      aria-live="polite"
      aria-label="Notifications"
      className="fixed right-4 z-50 flex flex-col gap-2"
      // FirstWinWizard occupies ~280-360px tall at bottom-4 right-4.
      // Bumping the toasts' bottom by 24rem (384px) clears the wizard
      // with a small gap. When wizard is dismissed, anchor returns to
      // the usual bottom-4.
      style={{ bottom: wizardVisible ? '24rem' : '1rem' }}
    >
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          id={toast.id}
          type={toast.type}
          message={toast.message}
          duration={toast.duration}
          onClose={() => removeToast(toast.id)}
        />
      ))}
    </div>
  );
}

interface ToastProps {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
  duration?: number;
  onClose: () => void;
}

function Toast({ type, message, duration = TOAST_DURATION, onClose }: ToastProps) {
  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(onClose, duration);
      return () => clearTimeout(timer);
    }
  }, [duration, onClose]);

  const config = {
    success: {
      icon: CheckCircle,
      bg: 'bg-neon-green/10',
      border: 'border-neon-green/30',
      text: 'text-neon-green',
    },
    error: {
      icon: AlertCircle,
      bg: 'bg-red-500/10',
      border: 'border-red-500/30',
      text: 'text-red-500',
    },
    warning: {
      icon: AlertTriangle,
      bg: 'bg-amber-500/10',
      border: 'border-amber-500/30',
      text: 'text-amber-400',
    },
    info: {
      icon: Info,
      bg: 'bg-neon-blue/10',
      border: 'border-neon-blue/30',
      text: 'text-neon-blue',
    },
  };

  const { icon: Icon, bg, border, text } = config[type];

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-lg border ${bg} ${border} min-w-[300px] max-w-md animate-slide-in shadow-lg`}
    >
      <Icon className={`w-5 h-5 ${text} flex-shrink-0`} />
      <p className="flex-1 text-sm text-white">{message}</p>
      <button
        onClick={onClose}
        className="p-1 rounded hover:bg-white/10 transition-colors flex-shrink-0"
        aria-label="Dismiss notification"
      >
        <X className="w-4 h-4 text-gray-400" />
      </button>
    </div>
  );
}

// Helper function to show toasts from anywhere
export function showToast(
  type: 'success' | 'error' | 'warning' | 'info',
  message: string,
  duration?: number
) {
  useUIStore.getState().addToast({ type, message, duration });
}
