'use client';

// Phase CA6 — Soulslike corpse-recovery marker.
//
// player_corpses (mig 151) shipped the Dark Souls shadow-corpse:
// 25% of wallet capped at 1000 dropped on death, 4m recovery radius,
// 7-day TTL. The substrate's been live; what was missing is the
// soul-glow waypoint that tells the player "your stuff is at (x, z)".
//
// Polls /api/players/me/corpses every 5s; floats a translucent marker
// near the player's current world UI showing distance + lost-coin
// amount.

import { useCallback, useState } from 'react';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { Skull } from 'lucide-react';

interface ActiveCorpse {
  id: string;
  world_id: string;
  x: number; y: number; z: number;
  coins_lost: number;
  dropped_at: number;
}

interface CorpseMarkerProps {
  worldId: string;
  playerX: number;
  playerZ: number;
}


export function CorpseMarker({ worldId, playerX, playerZ }: CorpseMarkerProps) {
  const [corpses, setCorpses] = useState<ActiveCorpse[]>([]);

  const refresh = useCallback(() => {
    if (!worldId) return;
    fetch('/api/players/me/corpses', { credentials: 'include' })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (d?.ok) {
          const inWorld = (d.corpses || []).filter((c: ActiveCorpse) => c.world_id === worldId);
          setCorpses(inWorld);
        }
      })
      .catch(() => {});
  }, [worldId]);

  // Push: a death or corpse-drop refreshes nearby corpses instantly; slow
  // backstop poll covers anything missed.
  useRealtimeRefresh(['entity:death', 'player:corpse-dropped'], refresh, { backstopMs: 30000 });

  if (corpses.length === 0) return null;

  // Surface the closest corpse (Dark Souls shows only one shadow at a time).
  const closest = corpses
    .map((c) => ({ ...c, distance: Math.hypot(c.x - playerX, c.z - playerZ) }))
    .sort((a, b) => a.distance - b.distance)[0];

  return (
    <div className="pointer-events-none fixed top-1/2 right-6 z-30 -translate-y-1/2">
      <div className="flex flex-col items-center gap-1 rounded border border-violet-500/40 bg-violet-500/10 px-2 py-1.5 text-violet-200 shadow-lg backdrop-blur">
        <Skull size={14} className="animate-pulse" />
        <div className="text-[10px] font-mono">{closest.distance.toFixed(1)} m</div>
        <div className="text-[9px] text-violet-300/70">{closest.coins_lost} CC at corpse</div>
      </div>
    </div>
  );
}
