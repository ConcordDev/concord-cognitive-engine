'use client';

// Phase DC2 — Courtship affinity projection.
// Listens for NPC list updates (same shape NPCActivityTag uses) and for
// each NPC the player has a courtship row with, draws a small heart icon
// + affinity percentage above their head via the concordia:projector-ready
// 3D-to-screen pattern.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { useClientConfig } from '@/hooks/useClientConfig';

const VISIBLE_RADIUS_M = 16;

type Projection = { x: number; y: number; visible: boolean };
type Projector = (world: { x: number; y: number; z: number }) => Projection | null;

interface NpcLite { id: string; position: { x: number; y?: number; z: number }; }
interface CourtshipRow {
  partner_kind: string;
  partner_id: string;
  affinity: number;
  status: string;
}

interface Props {
  npcs?: NpcLite[];
  playerPosition?: { x: number; z: number };
  enabled?: boolean;
}

export function CourtshipProgressOverlay({ npcs = [], playerPosition, enabled = true }: Props) {
  const _cfg = useClientConfig(); // E0 — server-tunable cadence
  const POLL_MS = _cfg.poll.courtshipMs;
  const FRAME_THROTTLE_MS = _cfg.throttle.courtshipFrameMs;
  const projectorRef = useRef<Projector | null>(null);
  const [screenPositions, setScreenPositions] = useState<Map<string, Projection>>(new Map());
  const [byNpc, setByNpc] = useState<Map<string, CourtshipRow>>(new Map());

  useEffect(() => {
    function onProjector(e: Event) {
      const detail = (e as CustomEvent).detail as { project: Projector };
      if (typeof detail?.project === 'function') projectorRef.current = detail.project;
    }
    window.addEventListener('concordia:projector-ready', onProjector);
    return () => window.removeEventListener('concordia:projector-ready', onProjector);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const j = await fetch('/api/courtship/mine', { credentials: 'include' }).then(r => r.json());
      if (j?.ok) {
        const m = new Map<string, CourtshipRow>();
        for (const c of (j.courtships || []) as CourtshipRow[]) {
          if (c.partner_kind === 'npc') m.set(c.partner_id, c);
        }
        setByNpc(m);
      }
    } catch { /* swallow */ }
  }, []);

  useRealtimeRefresh(['courtship:affinity-update'], refresh, { backstopMs: POLL_MS, enabled });

  useEffect(() => {
    if (!enabled || !npcs.length || byNpc.size === 0) {
      setScreenPositions(new Map());
      return;
    }
    let raf = 0; let last = 0;
    function loop(t: number) {
      raf = requestAnimationFrame(loop);
      if (t - last < FRAME_THROTTLE_MS) return;
      last = t;
      const proj = projectorRef.current;
      if (!proj) return;
      const next = new Map<string, Projection>();
      for (const n of npcs) {
        if (!byNpc.has(n.id)) continue;
        if (playerPosition) {
          const dx = n.position.x - playerPosition.x;
          const dz = n.position.z - playerPosition.z;
          if (Math.hypot(dx, dz) > VISIBLE_RADIUS_M) continue;
        }
        const p = proj({ x: n.position.x, y: (n.position.y ?? 0) + 2.2, z: n.position.z });
        if (p) next.set(n.id, p);
      }
      setScreenPositions(next);
    }
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [enabled, npcs, playerPosition, byNpc, FRAME_THROTTLE_MS]);

  if (!enabled || screenPositions.size === 0) return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-[34]" aria-hidden>
      {npcs.map((n) => {
        const pos = screenPositions.get(n.id);
        const courtship = byNpc.get(n.id);
        if (!pos?.visible || !courtship) return null;
        const pct = Math.round((courtship.affinity || 0) * 100);
        const wed = courtship.status === 'married';
        return (
          <div
            key={n.id}
            className="absolute -translate-x-1/2 -translate-y-full select-none"
            style={{ left: pos.x, top: pos.y }}
          >
            <div className="flex flex-col items-center">
              <div className={['rounded-full border px-1.5 py-0.5 text-[11px] leading-none shadow-md', wed ? 'border-amber-300/40 bg-amber-900/50 text-amber-100' : 'border-pink-400/40 bg-pink-900/50 text-pink-100'].join(' ')}>
                <span aria-hidden>{wed ? '⚭' : '♥'}</span>
                <span className="ml-1 font-mono text-[9px]">{pct}%</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
