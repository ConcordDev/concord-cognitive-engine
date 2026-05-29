'use client';

// Phase F3.3 — slim top-of-screen ribbon shown when ≥1 faction war is
// active in the current world. Polls /api/factions/active-wars every
// 30s; also listens for the faction:war-declared socket event to
// refresh immediately.

import { useCallback, useEffect, useState } from 'react';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { Swords } from 'lucide-react';

interface WarRow {
  faction_id: string;
  stance: 'war' | string;
  target_id: string | null;
  momentum: number;
  updated_at: number;
  last_move_id: string;
}

const POLL_MS = 30_000;

export function StrategicWarBanner() {
  const [worldId, setWorldId] = useState<string | null>(null);
  const [wars, setWars] = useState<WarRow[]>([]);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setWorldId(localStorage.getItem('concordia:activeWorldId'));
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const params = worldId ? `?worldId=${encodeURIComponent(worldId)}` : '';
      const r = await fetch('/api/factions/active-wars' + params, { credentials: 'include' });
      const j = await r.json();
      if (j?.ok && Array.isArray(j.wars)) setWars(j.wars);
    } catch { /* swallow */ }
  }, [worldId]);

  // Push: faction-war events refresh the banner immediately; slow backstop poll.
  useRealtimeRefresh(
    ['faction-war:tick', 'faction-war:clash', 'faction-war:kill', 'faction-war:end'],
    refresh,
    { backstopMs: POLL_MS },
  );

  // Refresh immediately on a fresh war declaration.
  useEffect(() => {
    const onDeclared = () => refresh();
    window.addEventListener('concordia:faction-war-declared', onDeclared);
    return () => window.removeEventListener('concordia:faction-war-declared', onDeclared);
  }, [refresh]);

  if (wars.length === 0 || collapsed) {
    if (collapsed && wars.length > 0) {
      return (
        <button
          onClick={() => setCollapsed(false)}
          className="concordia-hud-slide-down pointer-events-auto fixed top-2 left-1/2 z-30 -translate-x-1/2 rounded-full border border-amber-500/50 bg-amber-950/80 px-3 py-1 text-[10px] text-amber-100 hover:bg-amber-950"
        >
          ⚔ {wars.length} war{wars.length > 1 ? 's' : ''} active
        </button>
      );
    }
    return null;
  }

  // For each war, format a one-line summary.
  const labels = wars.map((w) => {
    const target = w.target_id ? `→ ${w.target_id}` : '';
    return `${w.faction_id} ${target}`;
  });

  return (
    <div className="concordia-hud-slide-down pointer-events-auto fixed top-2 left-1/2 z-30 max-w-3xl -translate-x-1/2 rounded-md border border-amber-500/50 bg-amber-950/85 px-3 py-1 text-amber-50 shadow-md backdrop-blur">
      <div className="flex items-center gap-2 text-[11px]">
        <Swords size={12} className="text-amber-300" />
        <span className="font-semibold">War{wars.length > 1 ? 's' : ''} active:</span>
        <span className="truncate text-amber-100">{labels.slice(0, 3).join(' · ')}{wars.length > 3 && ` · +${wars.length - 3} more`}</span>
        <button onClick={() => setCollapsed(true)} className="ml-2 rounded px-1 text-[10px] text-amber-200 hover:bg-amber-900/50">×</button>
      </div>
    </div>
  );
}
