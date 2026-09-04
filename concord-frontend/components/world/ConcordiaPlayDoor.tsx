'use client';

/**
 * Honest door on the world lens: this page is the OS world surface
 * (DTUs, presence, stations). AAA play is the in-repo Unity client.
 * Not a generic action strip — a designed status chip.
 */

import { useEffect, useState } from 'react';
import { ds } from '@/lib/design-system';

const STORAGE_KEY = 'concordia:play-door';

export default function ConcordiaPlayDoor() {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    try {
      setOpen(window.localStorage.getItem(STORAGE_KEY) !== '0');
    } catch {
      /* private mode — stay open */
    }
  }, []);

  if (!open) return null;

  const dismiss = () => {
    setOpen(false);
    try {
      window.localStorage.setItem(STORAGE_KEY, '0');
    } catch {
      /* ignore */
    }
  };

  return (
    <aside
      data-testid="concordia-play-door"
      className={`${ds.hudPanel} pointer-events-auto fixed bottom-24 left-4 z-30 max-w-sm border-amber-500/30 px-3 py-2 text-left`}
      aria-label="Where Concordia actually plays"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-amber-400/80">Play Concordia</div>
          <p className="mt-1 text-xs leading-relaxed text-zinc-200">
            This lens is the OS world surface — DTUs, presence, stations. When a
            Unity WebGL export exists, Concordia loads in-page at{' '}
            <code className="font-mono text-[10px] text-amber-200">/unity-client/</code>
            {' '}over <code className="font-mono text-[10px] text-zinc-400">/unity-ws</code>.
            Until then this canvas stays Three.js. The Editor at{' '}
            <code className="font-mono text-[10px] text-amber-200">
              apps/concordia-living-world/unity-client/
            </code>
            {' '}is the standalone AAA client. Godot remains the parity native
            path on <code className="font-mono text-[10px] text-zinc-400">/godot-ws</code>.
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 rounded border border-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400 hover:text-white"
        >
          Hide
        </button>
      </div>
    </aside>
  );
}
