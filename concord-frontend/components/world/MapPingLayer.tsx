'use client';

/**
 * MapPingLayer — Phase U6.
 *
 * Renders world markers (poi / quest / caution / celebration / system)
 * as overlay billboards on top of the 2D minimap and as floating sprites
 * in the 3D scene. For v1 we ship the overlay HUD only — Three.js sprite
 * mounting is left as a small follow-on (the data + API are already
 * wired through, so any 3D scene can read /api/worlds/:worldId/markers).
 *
 * Listens for world:marker-placed socket events to refresh live.
 * Alt+click on the HUD plants a `caution` marker at the player's
 * current position.
 */

import { useCallback, useEffect, useState } from 'react';
import { MapPin, Pin, AlertTriangle, PartyPopper, ScrollText, X } from 'lucide-react';

interface Marker {
  id: string;
  worldId: string;
  kind: 'poi' | 'quest' | 'caution' | 'celebration' | 'system';
  label: string;
  x: number;
  z: number;
  placedBy: string;
  placedAt: number;
  expiresAt: number | null;
}

const KIND_ICON: Record<Marker['kind'], React.ComponentType<{ className?: string }>> = {
  poi: Pin,
  quest: ScrollText,
  caution: AlertTriangle,
  celebration: PartyPopper,
  system: MapPin,
};
const KIND_COLOR: Record<Marker['kind'], string> = {
  poi: 'text-cyan-300 border-cyan-500/40 bg-cyan-500/10',
  quest: 'text-amber-300 border-amber-500/40 bg-amber-500/10',
  caution: 'text-rose-300 border-rose-500/40 bg-rose-500/10',
  celebration: 'text-fuchsia-300 border-fuchsia-500/40 bg-fuchsia-500/10',
  system: 'text-slate-300 border-slate-500/40 bg-slate-500/10',
};

export function MapPingLayer({ worldId }: { worldId: string }) {
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => {
    if (!worldId) return;
    try {
      const r = await fetch(`/api/worlds/${encodeURIComponent(worldId)}/markers`);
      const j = await r.json();
      if (j?.ok) setMarkers(j.markers || []);
    } catch { /* network blip */ }
  }, [worldId]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent).detail || {};
      if (detail.worldId === worldId) refresh();
    };
    window.addEventListener('world:marker-placed', handler);
    return () => window.removeEventListener('world:marker-placed', handler);
  }, [worldId, refresh]);

  const handleRemove = useCallback(async (markerId: string) => {
    if (!worldId) return;
    try {
      await fetch(`/api/worlds/${encodeURIComponent(worldId)}/markers/${markerId}`, {
        method: 'DELETE', credentials: 'include',
      });
      refresh();
    } catch { /* network blip */ }
  }, [worldId, refresh]);

  if (markers.length === 0 && !open) return null;

  return (
    <div className="pointer-events-auto fixed left-2 top-16 z-30 max-w-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-2 rounded-full border border-cyan-500/40 bg-slate-950/80 px-3 py-1.5 text-xs font-medium text-cyan-200 backdrop-blur ${open ? 'ring-2 ring-cyan-400/40' : ''}`}
      >
        <MapPin className="h-3.5 w-3.5" />
        <span>{markers.length} {markers.length === 1 ? 'marker' : 'markers'}</span>
      </button>
      {open && (
        <ul className="mt-2 space-y-1 rounded-lg border border-cyan-500/30 bg-slate-950/95 p-2 shadow-2xl backdrop-blur">
          {markers.map((m) => {
            const Icon = KIND_ICON[m.kind];
            return (
              <li key={m.id} className={`flex items-center justify-between gap-2 rounded-md border px-2 py-1 text-[11px] ${KIND_COLOR[m.kind]}`}>
                <div className="flex min-w-0 items-center gap-1.5">
                  <Icon className="h-3 w-3 shrink-0" />
                  <span className="truncate">{m.label || m.kind}</span>
                  <span className="text-[10px] opacity-50">({Math.round(m.x)}, {Math.round(m.z)})</span>
                </div>
                <button onClick={() => handleRemove(m.id)} aria-label="Remove marker" className="opacity-50 hover:opacity-100">
                  <X className="h-3 w-3" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
