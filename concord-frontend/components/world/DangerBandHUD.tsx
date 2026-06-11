'use client';

// WS6 — danger telegraphing HUD (now push/local-compute, no per-frame poll).
//
// Fetches the world's gradient config + hub anchor ONCE on entry, then computes
// the danger band LOCALLY from the live player pose each throttled frame. Crossing
// into a deadlier band fires a diegetic System window ("Entering the Wilds") via
// the System bus, and the persistent corner badge updates instantly. A slow
// backstop re-fetch keeps config fresh if the world's gradient is re-tuned live.

import { useEffect, useRef, useState } from 'react';
import { ShieldCheck, AlertTriangle, Skull } from 'lucide-react';
import { useClientConfig } from '@/hooks/useClientConfig';
import {
  type GradientConfig, type HubAnchor,
  dangerBandAt, bandLevelRange, bandName, distanceFromHub,
} from '@/lib/system/gradient-client';
import { pushSystem } from '@/components/world/SystemFeed';

declare global {
  // Must match the canonical {x,y,z} declaration (lib/world-lens/vehicle-renderer.ts).
  interface Window { __concordiaPlayerPos?: { x: number; y: number; z: number }; __concordiaPlayerLevel?: number }
}

const CONFIG_REFRESH_MS = 60_000;  // slow backstop: re-fetch config if re-tuned

function bandColor(band: number): string {
  const ramp = ['#4ade80', '#a3e635', '#facc15', '#fb923c', '#f87171', '#ef4444', '#dc2626'];
  return ramp[Math.min(ramp.length - 1, Math.max(0, band))];
}

export function DangerBandHUD() {
  const FRAME_THROTTLE_MS = useClientConfig().throttle.dangerBandFrameMs; // E0 — server-tunable
  const [worldId, setWorldId] = useState<string | null>(null);
  const [grad, setGrad] = useState<{ config: GradientConfig; anchor: HubAnchor } | null>(null);
  const [view, setView] = useState<{ band: number; name: string; min: number; max: number; inHub: boolean } | null>(null);
  const lastBand = useRef<number | null>(null);

  useEffect(() => {
    const id = typeof window !== 'undefined' ? localStorage.getItem('concordia:activeWorldId') : null;
    setWorldId(id);
  }, []);

  // Fetch gradient config + anchor once (and on a slow backstop in case it's re-tuned).
  useEffect(() => {
    if (!worldId) return;
    let alive = true;
    const fetchConfig = async () => {
      const pos = (typeof window !== 'undefined' && window.__concordiaPlayerPos) || { x: 0, z: 0 };
      try {
        const j = await fetch(
          `/api/worlds/${worldId}/danger?x=${Math.round(pos.x)}&z=${Math.round(pos.z)}`,
          { credentials: 'include' },
        ).then((r) => r.json());
        if (alive && j?.ok && j.config && j.anchor) setGrad({ config: j.config, anchor: j.anchor });
      } catch { /* advisory only */ }
    };
    fetchConfig();
    const t = setInterval(fetchConfig, CONFIG_REFRESH_MS);
    return () => { alive = false; clearInterval(t); };
  }, [worldId]);

  // Local band computation from the live pose — no server round-trip per frame.
  useEffect(() => {
    if (!grad) return;
    const tick = () => {
      const pos = (typeof window !== 'undefined' && window.__concordiaPlayerPos) || { x: 0, z: 0 };
      const band = dangerBandAt(grad.config, grad.anchor, pos.x, pos.z);
      const [min, max] = bandLevelRange(grad.config, band);
      const inHub = distanceFromHub(grad.anchor, pos.x, pos.z) <= grad.anchor.radiusM;
      const name = bandName(grad.config, band);
      setView({ band, name, min, max, inHub });
      // Crossing INTO a deadlier band → fire a System window via the existing feed.
      if (lastBand.current !== null && band > lastBand.current) {
        pushSystem(
          `Entering the ${name}`,
          `Recommended level ${min}–${max} · the frontier does not forgive`,
          'world',
        );
      }
      lastBand.current = band;
    };
    tick();
    const t = setInterval(tick, FRAME_THROTTLE_MS);
    return () => clearInterval(t);
  }, [grad, FRAME_THROTTLE_MS]);

  if (!view) return null;
  const color = bandColor(view.band);
  const Icon = view.inHub ? ShieldCheck : view.band >= 4 ? Skull : AlertTriangle;

  return (
    <div
      className="pointer-events-none fixed left-4 top-20 z-40 flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium backdrop-blur-sm"
      style={{ borderColor: color, color, background: 'rgba(10,12,16,0.55)' }}
      data-testid="danger-band-badge"
    >
      <Icon size={14} style={{ color }} />
      <span>{view.inHub ? 'Sanctuary' : view.name}</span>
      {!view.inHub && <span className="opacity-70">· lvl {view.min}–{view.max}</span>}
    </div>
  );
}

export default DangerBandHUD;
