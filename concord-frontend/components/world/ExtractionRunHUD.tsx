'use client';

// Phase DB16 — Extraction zone HUD.
// Bottom-center banner when player has an active extraction run. Shows
// time-until-timeout + stash size + nearest active extraction zone
// distance. Extract button if inside an active zone.

import { useCallback, useEffect, useState } from 'react';
import { Package, MapPin, Clock, ArrowRight, AlertTriangle } from 'lucide-react';

interface Run {
  id: string;
  user_id: string;
  world_id: string;
  started_at: number;
  expires_at: number;
  stash_size: number;
  ended_at: number | null;
}
interface Zone {
  id: string;
  x: number;
  z: number;
  radius_m: number;
  active_until: number;
}
interface Pos { x: number; z: number; }

const POLL_MS = 2000;

declare global {
  interface Window { __concordiaPlayerPos?: Pos; }
}

export function ExtractionRunHUD() {
  const [run, setRun] = useState<Run | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [worldId, setWorldId] = useState<string | null>(null);
  const [playerPos, setPlayerPos] = useState<Pos | null>(null);
  const [extracting, setExtracting] = useState(false);

  useEffect(() => {
    const id = typeof window !== 'undefined' ? localStorage.getItem('concordia:activeWorldId') : null;
    setWorldId(id);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const j = await fetch('/api/extraction/active', { credentials: 'include' }).then(r => r.json());
      setRun(j?.ok ? j.run : null);
    } catch { /* swallow */ }
    if (worldId) {
      try {
        const z = await fetch(`/api/extraction/zones/${worldId}`, { credentials: 'include' }).then(r => r.json());
        setZones(z?.ok ? z.zones : []);
      } catch { /* swallow */ }
    }
  }, [worldId]);

  useEffect(() => {
    refresh();
    const r = setInterval(refresh, POLL_MS);
    const t = setInterval(() => {
      setNow(Math.floor(Date.now() / 1000));
      // Player position is pulled from a window-level pose hint set by AvatarSystem3D.
      if (typeof window !== 'undefined' && window.__concordiaPlayerPos) {
        setPlayerPos({ ...window.__concordiaPlayerPos });
      }
    }, 500);
    return () => { clearInterval(r); clearInterval(t); };
  }, [refresh]);

  if (!run || run.ended_at) return null;

  const remaining = Math.max(0, run.expires_at - now);
  const critical = remaining < 60;

  // Nearest active zone + distance.
  let nearest: { zone: Zone; distance: number; insideZone: boolean } | null = null;
  if (playerPos && zones.length > 0) {
    for (const z of zones) {
      if (z.active_until <= now) continue;
      const dx = playerPos.x - z.x;
      const dz = playerPos.z - z.z;
      const d = Math.hypot(dx, dz);
      if (!nearest || d < nearest.distance) {
        nearest = { zone: z, distance: d, insideZone: d <= z.radius_m };
      }
    }
  }

  const extract = async () => {
    if (!nearest?.insideZone) return;
    setExtracting(true);
    try {
      await fetch(`/api/extraction/${run.id}/extract`, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ playerX: playerPos?.x, playerZ: playerPos?.z, zoneId: nearest.zone.id }),
      });
      refresh();
    } finally { setExtracting(false); }
  };

  return (
    <div className="concordia-hud-slide-bottom pointer-events-auto fixed bottom-32 left-1/2 z-25 w-96 -translate-x-1/2 rounded-lg border border-orange-500/40 bg-zinc-950/95 p-2 shadow-xl backdrop-blur">
      <header className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wider text-orange-300/70">
        <Package size={11} /> extraction run
      </header>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <Clock className={['mx-auto', critical ? 'text-red-300' : 'text-orange-300/70'].join(' ')} size={12} />
          <div className="text-[9px] uppercase text-orange-300/60">{critical ? 'critical' : 'remaining'}</div>
          <div className={['font-mono text-sm', critical ? 'text-red-300' : 'text-orange-100'].join(' ')}>
            {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}
          </div>
        </div>
        <div>
          <Package className="mx-auto text-orange-300/70" size={12} />
          <div className="text-[9px] uppercase text-orange-300/60">stash</div>
          <div className="font-mono text-sm text-orange-100">{run.stash_size}</div>
        </div>
        <div>
          <MapPin className="mx-auto text-orange-300/70" size={12} />
          <div className="text-[9px] uppercase text-orange-300/60">zone</div>
          <div className="font-mono text-sm text-orange-100">
            {nearest ? `${Math.round(nearest.distance)}m` : '—'}
          </div>
        </div>
      </div>
      {nearest?.insideZone && (
        <button
          onClick={extract}
          disabled={extracting}
          className="mt-2 flex w-full items-center justify-center gap-1 rounded bg-emerald-500/40 px-3 py-1.5 text-xs text-emerald-50 hover:bg-emerald-500/60 disabled:opacity-50"
        >
          <ArrowRight size={11} /> Extract here
        </button>
      )}
      {critical && (
        <div className="mt-1 flex items-center justify-center gap-1 text-[10px] text-red-300">
          <AlertTriangle size={10} /> stash lost on timeout
        </div>
      )}
    </div>
  );
}
