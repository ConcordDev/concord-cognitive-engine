'use client';

import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { deleteOwnPost } from './deleteOwnPost';

/** Confirm, then delete. The parent drops the row only from onDeleted, after the server succeeds. */
export function OwnPostDelete({ postId, onDeleted }: { postId: string; onDeleted?: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  return confirming ? (
    <button
      type="button"
      aria-label="Confirm delete"
      disabled={busy}
      onClick={() => {
        void (async () => {
          setBusy(true);
          const result = await deleteOwnPost(postId);
          setBusy(false);
          // Reset the two-step confirm either way: on failure so the user
          // can retry, on success so a row that is still on screen for the
          // refetch round-trip never sits in a sticky "Confirm delete"
          // state (clicking it again would 404 against the deleted post).
          setConfirming(false);
          if (!result.ok) {
            return;
          }
          onDeleted?.();
        })();
      }}
      className="inline-flex items-center gap-1 text-[11px] text-rose-300 disabled:opacity-50"
    >
      <Trash2 className="h-3 w-3" /> {busy ? 'Deleting…' : 'Confirm delete'}
    </button>
  ) : (
    <button
      type="button"
      aria-label="Delete post"
      onClick={() => setConfirming(true)}
      className="inline-flex items-center gap-1 text-[11px] text-rose-300"
    >
      <Trash2 className="h-3 w-3" /> Delete
    </button>
  );
}
