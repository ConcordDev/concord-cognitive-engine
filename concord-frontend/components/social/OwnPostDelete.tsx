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
          if (!result.ok) {
            setConfirming(false);
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
