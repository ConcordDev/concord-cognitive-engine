'use client';

/**
 * NemesisGlyphLayer — floating glyphs above NPCs within VISIBLE_RADIUS_M
 * that have nemesis state with the player. Polls nemesis.nearby every 8s
 * and shows:
 *
 *   ✦  active scheme against player        (red)
 *   ⚡  high stress (level ≥ 7)             (amber)
 *   ⚔  persistent grudge                   (red dim)
 *   ❀  desire offered to player            (emerald)
 *
 * Same projector pattern as NPCActivityTag. Strictly informational —
 * the player gets to read what's happening underneath without any
 * action affordance attached.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { useHUDContext } from './concordia-hud/HUDContextProvider';
import { useClientConfig } from '@/hooks/useClientConfig';

const VISIBLE_RADIUS_M = 12;
const POLL_INTERVAL_MS = 8000;

interface NemesisRow {
  npcId: string;
  name: string;
  x: number | null;
  z: number | null;
  grudge: string | null;
  preoccupation: string | null;
  desire: string | null;
  opinion: string | null;
  stress: { level: number } | null;
  scheme: { kind: string; stage: string } | null;
  isNemesis: boolean;
}

type Projection = { x: number; y: number; visible: boolean };
type Projector = (world: { x: number; y: number; z: number }) => Projection | null;

interface Props {
  worldId: string;
  playerPosition?: { x: number; z: number };
  enabled?: boolean;
}

export function NemesisGlyphLayer({ worldId, playerPosition, enabled = true }: Props) {
  const FRAME_THROTTLE_MS = useClientConfig().throttle.nemesisFrameMs; // E0 — server-tunable
  const mode = useHUDContext((s) => s.inputMode);
  const projectorRef = useRef<Projector | null>(null);
  const [rows, setRows] = useState<NemesisRow[]>([]);
  const [screenPositions, setScreenPositions] = useState<Map<string, Projection>>(new Map());

  useEffect(() => {
    function onProjector(e: Event) {
      const detail = (e as CustomEvent).detail as { project: Projector };
      if (typeof detail?.project === 'function') projectorRef.current = detail.project;
    }
    window.addEventListener('concordia:projector-ready', onProjector);
    return () => window.removeEventListener('concordia:projector-ready', onProjector);
  }, []);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const r = await fetch('/api/lens/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: 'nemesis',
          name: 'nearby',
          input: { worldId, x: playerPosition?.x, z: playerPosition?.z, radius: 40 },
        }),
      });
      const j = await r.json();
      if (j?.ok && Array.isArray(j.npcs)) {
        setRows((j.npcs as NemesisRow[]).filter((n) => n.isNemesis || n.scheme || n.grudge || n.desire));
      }
    } catch { /* best-effort */ }
  }, [enabled, worldId, playerPosition?.x, playerPosition?.z]);
  // Push: NPC nemesis/scheme/grudge changes on socket events; slow backstop poll.
  useRealtimeRefresh(['nemesis:nearby'], refresh, { backstopMs: POLL_INTERVAL_MS * 2, enabled });

  useEffect(() => {
    if (!enabled || rows.length === 0) {
      setScreenPositions(new Map());
      return;
    }
    let raf = 0;
    let last = 0;
    function loop(t: number) {
      raf = requestAnimationFrame(loop);
      if (t - last < FRAME_THROTTLE_MS) return;
      last = t;
      const proj = projectorRef.current;
      if (!proj) return;
      const next = new Map<string, Projection>();
      for (const r of rows) {
        if (r.x == null || r.z == null) continue;
        if (playerPosition) {
          const dx = r.x - playerPosition.x;
          const dz = r.z - playerPosition.z;
          if (Math.hypot(dx, dz) > VISIBLE_RADIUS_M) continue;
        }
        const p = proj({ x: r.x, y: 2.4, z: r.z });
        if (p) next.set(r.npcId, p);
      }
      setScreenPositions(next);
    }
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [enabled, rows, playerPosition, FRAME_THROTTLE_MS]);

  if (mode === 'combat' || mode === 'dialogue' || mode === 'photo') return null;
  if (!enabled || screenPositions.size === 0) return null;

  return (
    <div
      className="fixed inset-0 pointer-events-none z-[34]"
      data-testid="nemesis-glyph-layer"
      aria-hidden="true"
    >
      {rows.map((r) => {
        const pos = screenPositions.get(r.npcId);
        if (!pos?.visible) return null;
        const glyphs: Array<{ ch: string; cls: string; title: string }> = [];
        if (r.scheme)                              glyphs.push({ ch: '✦', cls: 'text-red-400',     title: `scheme: ${r.scheme.kind}` });
        if (r.stress && r.stress.level >= 7)       glyphs.push({ ch: '⚡', cls: 'text-amber-300',   title: `stress ${r.stress.level}/10` });
        if (r.grudge)                              glyphs.push({ ch: '⚔', cls: 'text-red-300/80',  title: r.grudge });
        if (r.desire)                              glyphs.push({ ch: '❀', cls: 'text-emerald-300', title: r.desire });
        if (glyphs.length === 0) return null;
        const tooltip = [r.grudge, r.preoccupation, r.desire, r.scheme && `scheme:${r.scheme.kind}@${r.scheme.stage}`].filter(Boolean).join(' · ');
        return (
          <div
            key={r.npcId}
            className="absolute -translate-x-1/2 -translate-y-full select-none"
            style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
            data-npc-id={r.npcId}
            data-nemesis={r.isNemesis ? 'true' : 'false'}
            title={tooltip}
          >
            <div className="flex items-center gap-0.5 px-1.5 py-0.5 bg-black/60 border border-white/10 rounded-full backdrop-blur-sm shadow-md">
              {glyphs.map((g) => (
                <span key={g.ch} aria-hidden className={`text-xs leading-none ${g.cls}`}>{g.ch}</span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
