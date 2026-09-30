'use client';

import { useEffect, useState } from 'react';
import { X, CheckCircle, AlertTriangle, AlertCircle, Info } from 'lucide-react';
import { useUIStore } from '@/store/ui';
import { Z_INDEX } from '@/lib/ui/z-index';
import { SYNC_INDICATOR_VISIBILITY_EVENT } from '@/lib/ui/overlay-events';

const TOAST_DURATION = 5000;

export function Toasts() {
  const toasts = useUIStore((state) => state.toasts);
  const removeToast = useUIStore((state) => state.removeToast);

  // SyncIndicator anchors this same bottom-right corner whenever the app is
  // offline or has a pending sync queue — a persistent connectivity state
  // that shouldn't be fully covered by transient toasts stacking on top of
  // it. Rather than fight it out with z-index (they were previously tied at
  // z-50), the toast stack steps up out of the way for as long as it's
  // showing. Listens for a lightweight custom event instead of importing the
  // IndexedDB-backed useSyncStatus hook directly here, keeping this
  // frequently-rendered notification surface free of that dependency.
  const [syncIndicatorVisible, setSyncIndicatorVisible] = useState(false);
  useEffect(() => {
    const onVisibility = (e: Event) => {
      setSyncIndicatorVisible(Boolean((e as CustomEvent<{ visible: boolean }>).detail?.visible));
    };
    window.addEventListener(SYNC_INDICATOR_VISIBILITY_EVENT, onVisibility);
    return () => window.removeEventListener(SYNC_INDICATOR_VISIBILITY_EVENT, onVisibility);
  }, []);

  return (
    <div
      role="region"
      aria-live="polite"
      aria-label="Notifications"
      style={{ zIndex: Z_INDEX.TOAST }}
      className={`fixed left-4 right-4 sm:left-auto sm:right-4 flex flex-col items-stretch sm:items-end gap-2 transition-[bottom] duration-300 ${
        // On mobile the MobileTabBar owns the bottom edge — clear it so toasts
        // don't stack on top of the nav / cover page content.
        syncIndicatorVisible ? 'bottom-24 sm:bottom-16' : 'bottom-20 sm:bottom-4'
      }`}
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
      className={`flex items-center gap-3 px-4 py-3 rounded-lg border ${bg} ${border} w-full sm:w-auto sm:min-w-[300px] max-w-md animate-slide-in shadow-lg`}
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
