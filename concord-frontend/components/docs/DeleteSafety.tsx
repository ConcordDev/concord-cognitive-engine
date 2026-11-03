'use client';

/**
 * Delete-safety UI for the Docs lens (S1 / F1): the inline two-step
 * confirmation and the receipt toast, over the undo-window registry
 * in delete-safety-store.ts.
 *
 * The confirmation follows the fleet's inline-confirm idiom
 * (components/social/OwnPostDelete.tsx): the delete control swaps IN
 * PLACE to a confirm step — here naming the item, per S1 — never
 * window.confirm (the native-dialog dead-control class) and never a
 * modal. Confirming registers the delete with the registry; the item
 * leaves the view immediately, the toast announces the pending
 * deletion with Undo, and the macro runs only when the window lapses.
 *
 * S1 follow-up (geometry): in the narrow list columns (page tree,
 * database list) the original non-wrapping inline cluster overflowed
 * the column and the editor panel covered Cancel — a one-way door
 * wearing a two-way door's shape. The confirm cluster now WRAPS
 * within its container (the label may break; both buttons stay
 * whole and inside the column), and the list rows let their title
 * shrink (min-w-0) so the cluster gets the room it needs.
 */

import { useState, useSyncExternalStore } from 'react';
import { Trash2 } from 'lucide-react';
import {
  getDeleteSafetySnapshot, subscribeDeleteSafety, undoDelete,
  type DeleteSafetySnapshot,
} from './delete-safety-store';

export function useDeleteSafety(): DeleteSafetySnapshot {
  return useSyncExternalStore(subscribeDeleteSafety, getDeleteSafetySnapshot, getDeleteSafetySnapshot);
}

export function ConfirmDeleteButton({ itemLabel, deleteTitle, onConfirm, className, iconClassName, onConfirmingChange }: {
  /** The item's name — the confirm step names it: Delete “<itemLabel>”? */
  itemLabel: string;
  /** Accessible name of the resting control, e.g. "Delete page". */
  deleteTitle: string;
  onConfirm: () => void;
  className?: string;
  iconClassName?: string;
  /** Notified when the confirm step opens/closes, so a hover-revealed
   *  host row can keep the open confirm step visible. */
  onConfirmingChange?: (confirming: boolean) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const setStep = (next: boolean) => { setConfirming(next); onConfirmingChange?.(next); };
  if (!confirming) {
    return (
      <button
        type="button"
        title={deleteTitle}
        aria-label={deleteTitle}
        onClick={(e) => { e.stopPropagation(); setStep(true); }}
        className={className}
      >
        <Trash2 className={iconClassName ?? 'w-3.5 h-3.5'} />
      </button>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1 max-w-full min-w-0" onClick={(e) => e.stopPropagation()}>
      <span className="text-[10px] text-rose-300 break-words min-w-0">Delete &ldquo;{itemLabel}&rdquo;?</span>
      <button
        type="button"
        aria-label={`Confirm delete ${itemLabel}`}
        onClick={() => { setStep(false); onConfirm(); }}
        className="px-1.5 py-0.5 text-[10px] rounded bg-rose-500/20 text-rose-200 hover:bg-rose-500/30 shrink-0 whitespace-nowrap"
      >
        Delete
      </button>
      <button
        type="button"
        aria-label="Cancel delete"
        onClick={() => setStep(false)}
        className="px-1.5 py-0.5 text-[10px] rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 shrink-0 whitespace-nowrap"
      >
        Cancel
      </button>
    </span>
  );
}

/**
 * The deletion receipt, rendered once by DocsWorkspace. Pending shows
 * the Undo affordance for the window's length; done announces the
 * deletion; error surfaces the commit's refusal verbatim.
 */
export function DeleteReceiptToast() {
  const { receipt } = useDeleteSafety();
  if (!receipt) return null;
  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 shadow-xl"
    >
      {receipt.phase === 'pending' && (
        <>
          <span className="text-xs text-zinc-200">Deleting &ldquo;{receipt.label}&rdquo;&hellip;</span>
          <button
            type="button"
            onClick={() => undoDelete(receipt.key)}
            className="text-xs font-semibold text-cyan-300 hover:underline"
          >
            Undo
          </button>
        </>
      )}
      {receipt.phase === 'done' && (
        <span className="text-xs text-zinc-200">&ldquo;{receipt.label}&rdquo; deleted.</span>
      )}
      {receipt.phase === 'error' && (
        <span className="text-xs text-rose-300">
          Couldn&rsquo;t delete &ldquo;{receipt.label}&rdquo;: {receipt.message}
        </span>
      )}
    </div>
  );
}
