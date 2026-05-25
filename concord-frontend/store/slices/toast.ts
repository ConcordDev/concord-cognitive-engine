import type { StateCreator } from 'zustand';

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
  duration?: number;
}

export interface ToastSlice {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
}

const toastTimers = new Map<string, ReturnType<typeof setTimeout>>();

export const createToastSlice: StateCreator<ToastSlice, [], [], ToastSlice> = (set, get) => ({
  toasts: [],

  addToast: (toast) => {
    // Dedup: if an identical toast (same type + message) is already on
    // screen, refresh its TTL rather than stacking a second copy.
    // Without this, rate-limited fetches produce a tower of "Too many
    // requests" toasts that visually reads as one squashed pill.
    const existing = get().toasts.find(t => t.type === toast.type && t.message === toast.message);
    if (existing) {
      const oldTimer = toastTimers.get(existing.id);
      if (oldTimer) clearTimeout(oldTimer);
      const duration = toast.duration ?? 5000;
      const refreshTimer = setTimeout(() => {
        toastTimers.delete(existing.id);
        get().removeToast(existing.id);
      }, duration);
      toastTimers.set(existing.id, refreshTimer);
      return;
    }
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    set((state) => ({
      toasts: [
        ...state.toasts,
        { ...toast, id },
      ],
    }));
    const duration = toast.duration ?? 5000;
    const timer = setTimeout(() => {
      toastTimers.delete(id);
      get().removeToast(id);
    }, duration);
    toastTimers.set(id, timer);
  },

  removeToast: (id) => {
    const timer = toastTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      toastTimers.delete(id);
    }
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },
});
