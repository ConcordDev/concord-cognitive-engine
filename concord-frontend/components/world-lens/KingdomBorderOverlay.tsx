'use client';

/**
 * KingdomBorderOverlay — banner that appears when the player crosses a
 * kingdom border. Shows kingdom name + active enforced decrees so the
 * visitor knows what mechanics they're now subject to.
 *
 * Polls `/api/kingdoms/at/lookup` whenever player position changes
 * (debounced 500ms). When the answer changes (different kingdom or null),
 * shows the banner for 4s.
 */

import { useEffect, useState, useRef } from 'react';
import { Crown, Hammer } from 'lucide-react';

interface Props {
  worldId: string;
  playerPosition: { x: number; y: number; z?: number };
}

interface KingdomAt {
  id: string;
  name: string;
}

interface DecreeRow {
  decree_kind: string;
  activation_state: string;
}

export function KingdomBorderOverlay({ worldId, playerPosition }: Props) {
  const [currentKingdom, setCurrentKingdom] = useState<KingdomAt | null>(null);
  const [showBanner, setShowBanner] = useState<{ kingdom: KingdomAt | null; decrees: DecreeRow[] } | null>(null);
  const lastQueryRef = useRef<{ x: number; y: number; t: number }>({ x: 0, y: 0, t: 0 });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!worldId) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // Debounce 500ms
    debounceRef.current = setTimeout(async () => {
      const last = lastQueryRef.current;
      const dist = Math.hypot(playerPosition.x - last.x, playerPosition.y - last.y);
      if (dist < 5 && Date.now() - last.t < 5000) return; // didn't move much
      lastQueryRef.current = { x: playerPosition.x, y: playerPosition.y, t: Date.now() };

      try {
        const r = await fetch(
          `/api/kingdoms/at/lookup?worldId=${encodeURIComponent(worldId)}&x=${playerPosition.x}&z=${playerPosition.y}`,
          { credentials: 'same-origin' },
        );
        const j = r.ok ? await r.json() : null;
        const k: KingdomAt | null = j?.kingdom || null;

        // Detect transition
        const prevId = currentKingdom?.id;
        const newId = k?.id;
        if (prevId !== newId) {
          if (k) {
            // Fetch active decrees so banner shows them
            const dr = await fetch(`/api/kingdoms/${k.id}`, { credentials: 'same-origin' });
            const dj = dr.ok ? await dr.json() : null;
            const enforced = (dj?.decrees || []).filter((d: DecreeRow) =>
              d.activation_state === 'enforced' || d.activation_state === 'tension',
            );
            setShowBanner({ kingdom: k, decrees: enforced });
          } else {
            setShowBanner({ kingdom: null, decrees: [] });
          }
          setCurrentKingdom(k);
          // Auto-hide after 4s
          setTimeout(() => setShowBanner(null), 4000);
        }
      } catch { /* ok */ }
    }, 500);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [playerPosition.x, playerPosition.y, worldId, currentKingdom]);

  if (!showBanner) return null;

  return (
    <div className="pointer-events-none fixed left-1/2 top-12 z-[37] -translate-x-1/2">
      <div className="rounded-lg border border-amber-500/40 bg-black/70 px-4 py-3 backdrop-blur-md">
        <div className="flex items-center gap-2 text-sm">
          <Crown className="h-4 w-4 text-amber-300" />
          <span className="font-semibold text-amber-100">
            {showBanner.kingdom ? `Entering ${showBanner.kingdom.name}` : 'Leaving kingdom borders'}
          </span>
        </div>
        {showBanner.kingdom && showBanner.decrees.length > 0 && (
          <div className="mt-1.5 flex items-center gap-1 text-[10px] text-amber-200/80">
            <Hammer className="h-3 w-3" />
            <span>Active: {showBanner.decrees.map((d) => d.decree_kind).join(', ')}</span>
          </div>
        )}
      </div>
    </div>
  );
}
