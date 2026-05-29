'use client';

// WS6 — danger telegraphing HUD.
//
// The world is a radial danger gradient: safe near the hub, lethal at the
// frontier. This HUD reads the player's current danger band from
// /api/worlds/:worldId/danger and surfaces it two ways:
//   1. A persistent corner badge: band name + level window, colour-ramped by
//      how far out you are (green → red).
//   2. A transient center banner when you cross into a more dangerous band
//      ("Entering the Wilds — recommended level 18–33"), so danger is learnable,
//      never an invisible wall.
//
// Player position comes from the window-level pose hint AvatarSystem3D sets
// (window.__concordiaPlayerPos); world id from localStorage. Purely advisory.

import { useCallback, useEffect, useRef, useState } from 'react';
import { ShieldCheck, AlertTriangle, Skull } from 'lucide-react';

interface Pos { x: number; z: number; }
interface DangerResp {
  ok: boolean;
  band: number;
  bandName: string;
  minLevel: number;
  maxLevel: number;
  inHub: boolean;
  distance: number;
}

declare global {
  interface Window { __concordiaPlayerPos?: Pos; __concordiaPlayerLevel?: number; }
}

const POLL_MS = 2500;

// Band index → colour ramp (0 safe green → 5+ deadly red).
function bandColor(band: number): string {
  const ramp = ['#4ade80', '#a3e635', '#facc15', '#fb923c', '#f87171', '#ef4444', '#dc2626'];
  return ramp[Math.min(ramp.length - 1, Math.max(0, band))];
}

export function DangerBandHUD() {
  const [worldId, setWorldId] = useState<string | null>(null);
  const [danger, setDanger] = useState<DangerResp | null>(null);
  const [banner, setBanner] = useState<{ name: string; min: number; max: number; band: number } | null>(null);
  const lastBand = useRef<number | null>(null);
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const id = typeof window !== 'undefined' ? localStorage.getItem('concordia:activeWorldId') : null;
    setWorldId(id);
  }, []);

  const refresh = useCallback(async () => {
    if (!worldId) return;
    const pos = (typeof window !== 'undefined' && window.__concordiaPlayerPos) || { x: 0, z: 0 };
    const level = (typeof window !== 'undefined' && window.__concordiaPlayerLevel) || 1;
    try {
      const j: DangerResp = await fetch(
        `/api/worlds/${worldId}/danger?x=${Math.round(pos.x)}&z=${Math.round(pos.z)}&level=${level}`,
        { credentials: 'include' },
      ).then((r) => r.json());
      if (!j?.ok) return;
      setDanger(j);
      // Surface a banner when crossing INTO a more dangerous band.
      if (lastBand.current !== null && j.band > lastBand.current) {
        setBanner({ name: j.bandName, min: j.minLevel, max: j.maxLevel, band: j.band });
        if (bannerTimer.current) clearTimeout(bannerTimer.current);
        bannerTimer.current = setTimeout(() => setBanner(null), 4500);
      }
      lastBand.current = j.band;
    } catch { /* swallow — advisory only */ }
  }, [worldId]);

  useEffect(() => {
    refresh();
    const r = setInterval(refresh, POLL_MS);
    return () => { clearInterval(r); if (bannerTimer.current) clearTimeout(bannerTimer.current); };
  }, [refresh]);

  if (!danger) return null;

  const color = bandColor(danger.band);
  const Icon = danger.inHub ? ShieldCheck : danger.band >= 4 ? Skull : AlertTriangle;

  return (
    <>
      {/* Persistent corner badge */}
      <div
        className="pointer-events-none fixed left-4 top-20 z-40 flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium backdrop-blur-sm"
        style={{ borderColor: color, color, background: 'rgba(10,12,16,0.55)' }}
        data-testid="danger-band-badge"
      >
        <Icon size={14} style={{ color }} />
        <span>{danger.inHub ? 'Sanctuary' : danger.bandName}</span>
        {!danger.inHub && (
          <span className="opacity-70">· lvl {danger.minLevel}–{danger.maxLevel}</span>
        )}
      </div>

      {/* Transient "entering a deadlier band" banner */}
      {banner && (
        <div
          className="pointer-events-none fixed left-1/2 top-28 z-50 -translate-x-1/2 animate-[fadeIn_0.3s_ease-out] rounded-lg border px-5 py-2.5 text-center shadow-lg backdrop-blur"
          style={{ borderColor: bandColor(banner.band), background: 'rgba(10,12,16,0.7)' }}
          data-testid="danger-band-banner"
        >
          <div className="text-sm font-semibold" style={{ color: bandColor(banner.band) }}>
            Entering the {banner.name}
          </div>
          <div className="mt-0.5 text-xs text-slate-300">
            Recommended level {banner.min}–{banner.max} · the frontier does not forgive
          </div>
        </div>
      )}
    </>
  );
}

export default DangerBandHUD;
