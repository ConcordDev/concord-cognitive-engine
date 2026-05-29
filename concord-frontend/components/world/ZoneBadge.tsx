'use client';

/**
 * ZoneBadge — T3.3 world-zone HUD.
 *
 * Surfaces the governing world-zone at the player's current position (top-center
 * pill) and flashes a hazard vignette when a `zone:hazard-tick` socket event
 * lands for the local player. Reads `zones.at` (public-read) using the player
 * position AvatarSystem3D publishes on `window.__CONCORD_PLAYER_POS__`.
 *
 * Renders nothing in the open world (no governing zone) — only appears when the
 * player is inside a named safe / sanctuary / pvp / lawless / hazard zone, so
 * it reads as "you've entered somewhere with rules".
 */

import { useEffect, useRef, useState } from 'react';
import { subscribe } from '@/lib/realtime/socket';

interface ZoneInfo {
  name: string;
  kind: 'safe' | 'sanctuary' | 'pvp' | 'lawless' | 'hazard';
}

const KIND_STYLE: Record<ZoneInfo['kind'], { label: string; cls: string }> = {
  safe:      { label: 'Safe Zone',  cls: 'border-sky-600/60 bg-sky-950/70 text-sky-200' },
  sanctuary: { label: 'Sanctuary',  cls: 'border-emerald-600/60 bg-emerald-950/70 text-emerald-200' },
  pvp:       { label: 'PvP Zone',   cls: 'border-rose-600/60 bg-rose-950/70 text-rose-200' },
  lawless:   { label: 'Lawless',    cls: 'border-amber-600/60 bg-amber-950/70 text-amber-200' },
  hazard:    { label: 'Hazard',     cls: 'border-orange-600/60 bg-orange-950/70 text-orange-200' },
};

export default function ZoneBadge({ worldId, pollMs = 4000 }: { worldId: string; pollMs?: number }) {
  const [zone, setZone] = useState<ZoneInfo | null>(null);
  const [hazardFlash, setHazardFlash] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!worldId) return;
    let cancelled = false;
    const poll = async () => {
      const pos = (window as unknown as { __CONCORD_PLAYER_POS__?: { x: number; z: number } }).__CONCORD_PLAYER_POS__;
      if (!pos || typeof pos.x !== 'number') return;
      try {
        const r = await fetch('/api/lens/run', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domain: 'zones', name: 'at', input: { worldId, x: pos.x, z: pos.z } }),
        });
        if (!r.ok) return;
        const data = await r.json();
        if (cancelled) return;
        setZone(data?.zone ? { name: data.zone.name, kind: data.zone.kind } : null);
      } catch { /* anonymous / network blips: silent */ }
    };
    void poll();
    const t = setInterval(poll, pollMs);
    return () => { cancelled = true; clearInterval(t); };
  }, [worldId, pollMs]);

  // Hazard vignette flash on the local player's hazard tick.
  useEffect(() => {
    const off = subscribe('zone:hazard-tick' as Parameters<typeof subscribe>[0], () => {
      setHazardFlash(true);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setHazardFlash(false), 600);
    });
    return () => { off?.(); if (flashTimer.current) clearTimeout(flashTimer.current); };
  }, []);

  return (
    <>
      {zone && (
        <div
          className={`pointer-events-none absolute left-1/2 top-3 z-30 -translate-x-1/2 rounded-full border px-3 py-1 text-xs font-medium backdrop-blur ${KIND_STYLE[zone.kind].cls}`}
        >
          {KIND_STYLE[zone.kind].label} · {zone.name}
        </div>
      )}
      {hazardFlash && (
        <div
          className="pointer-events-none absolute inset-0 z-20"
          style={{ boxShadow: 'inset 0 0 140px 40px rgba(220,60,20,0.45)', transition: 'opacity 200ms' }}
          aria-hidden="true"
        />
      )}
    </>
  );
}
