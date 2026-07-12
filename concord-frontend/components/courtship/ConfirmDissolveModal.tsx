'use client';

/**
 * ConfirmDissolveModal — a real confirm step for ending a marriage.
 *
 * Dissolving a marriage (`courtship.dissolve` → romance-engine#dissolveMarriage)
 * is irreversible: the active-marriage unique index only exempts dissolved
 * rows, so ending one means the player would need to court/propose/wed again
 * from scratch. That makes this a significant, irreversible action — not a
 * bare destructive button — so it gets a real two-step confirm, styled after
 * the sibling HeartEventModal in this same directory (same overlay/dialog/
 * focus-management idiom, red/danger palette instead of pink).
 */

import { AlertTriangle, X } from 'lucide-react';
import { useEffect, useRef } from 'react';

interface Props {
  partnerLabel: string;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDissolveModal({ partnerLabel, pending, onConfirm, onCancel }: Props) {
  // Focus the safe (Cancel) action by default so an accidental Enter never
  // triggers the destructive one.
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !pending) onCancel();
    }
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onCancel, pending]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={() => { if (!pending) onCancel(); }}
        aria-hidden="true"
        role="button"
        tabIndex={-1}
        onKeyDown={() => {}}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="dissolve-marriage-title"
        data-testid="dissolve-confirm-modal"
        className="relative w-full max-w-sm rounded-xl border border-red-500/40 bg-zinc-950 shadow-2xl shadow-red-900/30 overflow-hidden animate-scale-in"
      >
        <div className="flex items-center justify-between gap-2 border-b border-red-500/30 bg-gradient-to-r from-red-950/60 to-zinc-950 px-5 py-3">
          <div className="flex items-center gap-2 text-red-200">
            <AlertTriangle size={16} aria-hidden="true" />
            <span id="dissolve-marriage-title" className="text-sm font-semibold">End marriage?</span>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            aria-label="Cancel"
            className="rounded p-1 text-red-300/70 hover:bg-red-500/10 hover:text-red-100 disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <p className="text-sm leading-relaxed text-red-50">
            This will permanently end your marriage to{' '}
            <span className="font-mono text-red-200">{partnerLabel}</span>. This cannot be undone
            — you would need to court, propose, and wed again from scratch.
          </p>
          <div className="flex gap-2">
            <button
              ref={cancelRef}
              type="button"
              onClick={onCancel}
              disabled={pending}
              className="flex-1 rounded bg-zinc-800 px-3 py-2 text-xs text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={pending}
              aria-label={`Confirm end marriage to ${partnerLabel}`}
              className="flex-1 rounded bg-red-600/80 px-3 py-2 text-xs font-semibold text-red-50 hover:bg-red-600 disabled:opacity-50"
            >
              {pending ? 'Ending…' : 'End Marriage'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
