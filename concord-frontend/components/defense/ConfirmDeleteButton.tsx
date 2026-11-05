'use client';

/**
 * ConfirmDeleteButton — two-step delete for persisted lens records (C1).
 *
 * The first click arms an inline confirmation that names the record; only
 * the explicit Delete click runs the removal. No record in this lens is
 * destroyed by a single click, and every panel pairs this with a success
 * receipt naming what was deleted.
 */

import { useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';

interface ConfirmDeleteButtonProps {
  /** Accessible label for the idle trash button (e.g. "Delete asset"). */
  ariaLabel: string;
  /** The record phrase the confirmation names (e.g. `asset "Truck 1"`). */
  itemLabel: string;
  disabled?: boolean;
  onConfirm: () => Promise<void> | void;
}

export function ConfirmDeleteButton({ ariaLabel, itemLabel, disabled, onConfirm }: ConfirmDeleteButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        disabled={disabled}
        aria-label={ariaLabel}
        className="p-1 text-zinc-400 hover:text-red-400 disabled:opacity-50"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    );
  }

  return (
    <span className="flex shrink-0 items-center gap-1">
      <span className="text-[10px] text-red-300">Delete {itemLabel}?</span>
      <button
        onClick={async () => {
          setBusy(true);
          await onConfirm();
          setBusy(false);
          setConfirming(false);
        }}
        disabled={busy}
        className="rounded bg-red-600/80 px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-red-500 disabled:opacity-50"
      >
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Delete'}
      </button>
      <button
        onClick={() => setConfirming(false)}
        disabled={busy}
        className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-300 hover:border-zinc-500 disabled:opacity-50"
      >
        Cancel
      </button>
    </span>
  );
}
