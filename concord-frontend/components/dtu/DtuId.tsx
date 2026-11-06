'use client';

/**
 * DtuId — the platform's receipt form for a DTU identifier (A9).
 *
 * A minted DTU's ID is the only handle a user has to find the item
 * again. Receipts that render a checkmark alone — or the ID truncated
 * to `dtu_3c1d…` as if the ellipsis were its name — strand the item.
 * This renders the FULL id, mono, click-to-copy, with the copied state
 * confirmed in place. Use it wherever a save/mint/publish receipt
 * names the DTU it made.
 */
import { useState } from 'react';

export function DtuId({ id, className = '' }: { id: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — the full text stays visible + selectable */
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      title={`DTU ${id} — click to copy the full ID`}
      className={`font-mono text-[10px] break-all text-left text-cyan-300/90 hover:text-cyan-200 underline decoration-dotted underline-offset-2 ${className}`}
    >
      {id}
      {copied ? ' ✓ copied' : ''}
    </button>
  );
}
