'use client';

/**
 * BazaarLayer
 *
 * Renders the Exchange district's vendor stalls as 3D-positioned overlay
 * markers tied to live marketplace listings. Each stall maps 1:1 to a DTU
 * marketplace listing — clicking the marker opens the inspect panel for
 * the underlying DTU. Dream-promoted listings get a glow tint.
 *
 * The layer is screen-projected (HTML overlays anchored by world coords),
 * not in-scene THREE meshes — keeps the bazaar zero-cost when the player
 * isn't in the Exchange. ConcordiaScene exposes a worldToScreen helper via
 * the same custom-event path as QuestMarker3D + WorldMarkers.
 */

import { useEffect, useState, useRef, useCallback } from 'react';

interface BazaarStall {
  id: string;
  listingId: string;
  sourceDtuId: string;
  title: string;
  domain: string;
  description: string;
  price: number;
  currency: string;
  sellerId: string;
  promotionSource: string | null;
  promotionScore: number | null;
  position: { x: number; y: number; z: number };
  district: string;
}

interface BazaarLayerProps {
  worldId?: string;
  enabled?: boolean;
  pollIntervalMs?: number;
  onStallClick?: (stall: BazaarStall) => void;
}

const PANEL =
  'absolute -translate-x-1/2 -translate-y-full pointer-events-auto cursor-pointer ' +
  'rounded-md border px-2 py-1 text-[10px] font-mono backdrop-blur-sm ' +
  'transition-all hover:scale-110 hover:z-[55] hover:shadow-[0_0_20px_rgba(56,189,248,0.6)] ' +
  'shadow-[0_2px_6px_rgba(0,0,0,0.5)]';

export default function BazaarLayer({
  worldId = 'concordia',
  enabled = true,
  pollIntervalMs = 60_000,
  onStallClick,
}: BazaarLayerProps) {
  const [stalls, setStalls] = useState<BazaarStall[]>([]);
  const [screenPositions, setScreenPositions] = useState<Map<string, { x: number; y: number; visible: boolean }>>(new Map());
  const projectorRef = useRef<((world: { x: number; y: number; z: number }) => { x: number; y: number; visible: boolean } | null) | null>(null);

  // Fetch stalls.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch(`/api/world/bazaar?worldId=${encodeURIComponent(worldId)}&limit=24`, {
          credentials: 'include',
        });
        if (!r.ok) return;
        const data = await r.json();
        if (!cancelled && Array.isArray(data?.stalls)) {
          setStalls(data.stalls);
        }
      } catch { /* network silent */ }
    }
    load();
    const id = window.setInterval(load, pollIntervalMs);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [worldId, enabled, pollIntervalMs]);

  // Listen for the scene-side projector. ConcordiaScene dispatches this when
  // it's ready; we cache the function reference and call per-frame.
  useEffect(() => {
    function onProjector(e: Event) {
      const detail = (e as CustomEvent).detail as { project: typeof projectorRef.current };
      if (typeof detail?.project === 'function') projectorRef.current = detail.project;
    }
    window.addEventListener('concordia:projector-ready', onProjector);
    return () => window.removeEventListener('concordia:projector-ready', onProjector);
  }, []);

  // Per-frame project stall positions. Throttled to ~12hz to keep cost low.
  useEffect(() => {
    if (!enabled || !stalls.length) return;
    let raf = 0;
    let last = 0;
    function loop(t: number) {
      raf = requestAnimationFrame(loop);
      if (t - last < 80) return;
      last = t;
      const proj = projectorRef.current;
      if (!proj) return;
      const next = new Map<string, { x: number; y: number; visible: boolean }>();
      for (const s of stalls) {
        const p = proj(s.position);
        if (p) next.set(s.id, p);
      }
      setScreenPositions(next);
    }
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [enabled, stalls]);

  const handleClick = useCallback((stall: BazaarStall) => {
    if (onStallClick) {
      onStallClick(stall);
      return;
    }
    // Default: dispatch a marketplace open event with the listing id so the
    // marketplace lens panel can pop up.
    window.dispatchEvent(new CustomEvent('concordia:open-listing', {
      detail: { listingId: stall.listingId, dtuId: stall.sourceDtuId },
    }));
  }, [onStallClick]);

  if (!enabled || !stalls.length) return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-[40]" aria-label="Bazaar stalls">
      {stalls.map((s) => {
        const pos = screenPositions.get(s.id);
        if (!pos?.visible) return null;
        const isDream = s.promotionSource === 'dream_cycle';
        const tint = isDream
          ? 'bg-violet-900/80 border-violet-400/60 text-violet-100'
          : 'bg-amber-900/80 border-amber-400/60 text-amber-100';
        return (
          <button
            key={s.id}
            type="button"
            className={`${PANEL} ${tint}`}
            style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
            onClick={() => handleClick(s)}
            title={s.description}
          >
            <div className="font-semibold truncate max-w-[120px]">{s.title}</div>
            <div className="opacity-70">
              {s.price > 0 ? `${s.price} ${s.currency.replace('concord_', '')}` : 'Free'}
              {isDream && ' · dream'}
            </div>
          </button>
        );
      })}
    </div>
  );
}
