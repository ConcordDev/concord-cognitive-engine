'use client';

/**
 * useMountedRide — Wave 4b. Tracks the player's currently-mounted
 * companion (player_companions.mounted = 1) and exposes its blueprint
 * + flight eligibility so the world page can:
 *   - lock the mount mesh to the player's position (so the mount
 *     visually follows the rider via concordia:mount-pose events)
 *   - allow Y-axis flight controls when the mount has winged topology
 *   - dispatch dismount when the player presses F again
 *
 * The hook is the single source of truth for the frontend's "am I
 * riding?" state. The backend's player_companions.mounted is the
 * canonical authority; this hook reads it via REST + refreshes on
 * world:player-mounted / world:player-dismounted realtime events.
 */

import { useCallback, useEffect, useState } from 'react';
import { subscribe } from '@/lib/realtime/socket';

interface Blueprint {
  topology?: string;
  massKg?: number;
  heightM?: number;
}

interface Companion {
  id: string;
  creature_id: string;
  name: string;
  world_id: string;
  blueprint: Blueprint | null;
  mounted: number;
  source_kind: string;
}

interface UseMountedRideReturn {
  mounted: boolean;
  companionId: string | null;
  creatureId: string | null;
  blueprint: Blueprint | null;
  isWinged: boolean;
  /** Heuristic eye-height of the rider above the mount's anchor. */
  riderOffsetY: number;
  dismount: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function useMountedRide(): UseMountedRideReturn {
  const [companion, setCompanion] = useState<Companion | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/companions/mine', { credentials: 'same-origin' });
      if (!r.ok) return;
      const j = await r.json();
      if (!j?.ok) return;
      const mounted = (j.companions ?? []).find((c: Companion) => c.mounted === 1);
      setCompanion(mounted ?? null);
    } catch { /* best-effort */ }
  }, []);

  useEffect(() => {
    void refresh();
    const onMount = () => { void refresh(); };
    const onDismount = () => setCompanion(null);
    const onChange = () => { void refresh(); };
    const unsubM = subscribe('world:player-mounted', onMount);
    const unsubD = subscribe('world:player-dismounted', onDismount);
    window.addEventListener('concordia:mount-changed', onChange);
    return () => {
      try { unsubM(); } catch { /* ok */ }
      try { unsubD(); } catch { /* ok */ }
      window.removeEventListener('concordia:mount-changed', onChange);
    };
  }, [refresh]);

  const dismount = useCallback(async () => {
    try {
      const r = await fetch('/api/companions/dismount', {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (r.ok) {
        setCompanion(null);
        window.dispatchEvent(new CustomEvent('concordia:mount-changed', { detail: { mounted: false } }));
      }
    } catch { /* best-effort */ }
  }, []);

  const isWinged = !!companion?.blueprint?.topology?.startsWith('winged_');
  const heightM = companion?.blueprint?.heightM ?? 1.2;

  return {
    mounted: !!companion,
    companionId: companion?.id ?? null,
    creatureId: companion?.creature_id ?? null,
    blueprint: companion?.blueprint ?? null,
    isWinged,
    // Place the rider roughly 60% up the mount's height. Tuned for the
    // procedural mesh's torso position.
    riderOffsetY: Math.max(0.8, heightM * 0.6),
    dismount,
    refresh,
  };
}
