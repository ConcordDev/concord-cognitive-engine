'use client';

// Phase DC12 — Tracking footprint overlay.
// Renders recent creature tracks as 3D-projected footprint marks. Gated
// to tracking_skill_xp.level >= 5 via /api/tracking/recent.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { useClientConfig } from '@/hooks/useClientConfig';

type Projection = { x: number; y: number; visible: boolean };
type Projector = (world: { x: number; y: number; z: number }) => Projection | null;

interface Track {
  id: string;
  target_id?: string;
  x: number;
  z: number;
  occurred_at: number;
}

interface Props { enabled?: boolean; }

export function FootprintLayer({ enabled = true }: Props) {
  const _cfg = useClientConfig(); // E0 — server-tunable cadence
  const POLL_MS = _cfg.poll.footprintMs;
  const FRAME_THROTTLE_MS = _cfg.throttle.footprintFrameMs;
  const projectorRef = useRef<Projector | null>(null);
  const [worldId, setWorldId] = useState<string | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [gated, setGated] = useState(true);
  const [positions, setPositions] = useState<Map<string, Projection>>(new Map());

  useEffect(() => {
    const w = typeof window !== 'undefined' ? localStorage.getItem('concordia:activeWorldId') : null;
    setWorldId(w);
  }, []);

  useEffect(() => {
    const onProjector = (e: Event) => {
      const detail = (e as CustomEvent).detail as { project: Projector };
      if (typeof detail?.project === 'function') projectorRef.current = detail.project;
    };
    window.addEventListener('concordia:projector-ready', onProjector);
    return () => window.removeEventListener('concordia:projector-ready', onProjector);
  }, []);

  const refresh = useCallback(async () => {
    if (!worldId) return;
    try {
      const j = await fetch(`/api/tracking/recent/${worldId}?minutes=10`, { credentials: 'include' }).then(r => r.json());
      if (j?.ok) {
        setGated(!!j.gated);
        setTracks(j.tracks || []);
      }
    } catch { /* swallow */ }
  }, [worldId]);

  useRealtimeRefresh(['tracking:footprints-updated'], refresh, { backstopMs: POLL_MS, enabled: enabled && !!worldId });

  useEffect(() => {
    if (!enabled || gated || tracks.length === 0) { setPositions(new Map()); return; }
    let raf = 0; let last = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - last < FRAME_THROTTLE_MS) return;
      last = t;
      const proj = projectorRef.current;
      if (!proj) return;
      const next = new Map<string, Projection>();
      for (const tr of tracks) {
        const p = proj({ x: tr.x, y: 0.05, z: tr.z });
        if (p?.visible) next.set(tr.id, p);
      }
      setPositions(next);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [enabled, gated, tracks, FRAME_THROTTLE_MS]);

  if (!enabled || gated || positions.size === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[32]" aria-hidden>
      {tracks.map((tr) => {
        const p = positions.get(tr.id);
        if (!p?.visible) return null;
        const ageMin = (Date.now() / 1000 - tr.occurred_at) / 60;
        const opacity = Math.max(0.2, 1 - ageMin / 10);
        return (
          <div
            key={tr.id}
            className="absolute -translate-x-1/2 -translate-y-1/2 select-none"
            style={{ left: p.x, top: p.y, opacity }}
          >
            <span className="text-base text-amber-300">𓃭</span>
          </div>
        );
      })}
    </div>
  );
}
