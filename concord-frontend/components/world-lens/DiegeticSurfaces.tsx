'use client';

/**
 * DiegeticSurfaces
 *
 * Renders the player's map / character sheet / inventory as in-world objects
 * the avatar can approach. Each surface is a 3D-positioned overlay (using the
 * concordia:projector-ready function) that opens a 2D UI panel when the
 * player is within proximity range.
 *
 * Three surfaces:
 *   • map_pedestal      — at Concordia's central plaza (x=600, z=600)
 *   • character_mirror  — at the player's home district hub
 *   • inventory_chest   — at the player's home district hub
 *
 * "Diegetic" here means in-fiction: the player walks to a stone map pedestal
 * to see the world map, not pulls up a phone HUD. The 2D panel still works
 * — this just changes how it's invoked.
 */

import { useEffect, useRef, useState, useCallback } from 'react';

interface PlayerPos { x: number; y: number; z: number }
interface DiegeticSurfacesProps {
  playerPosition: PlayerPos;
  proximityRadius?: number; // m; default 5
  onOpenMap?: () => void;
  onOpenSheet?: () => void;
  onOpenInventory?: () => void;
}

interface Surface {
  id: 'map' | 'sheet' | 'inventory';
  label: string;
  hint: string;
  pos: { x: number; y: number; z: number };
  open: () => void;
}

const PANEL =
  'absolute -translate-x-1/2 -translate-y-full pointer-events-auto cursor-pointer ' +
  'rounded-md border px-3 py-2 text-[11px] font-mono backdrop-blur-sm transition-all ' +
  'hover:scale-105 shadow-[0_2px_6px_rgba(0,0,0,0.5)]';

export default function DiegeticSurfaces({
  playerPosition,
  proximityRadius = 5,
  onOpenMap,
  onOpenSheet,
  onOpenInventory,
}: DiegeticSurfacesProps) {
  const projectorRef = useRef<((world: PlayerPos) => { x: number; y: number; visible: boolean } | null) | null>(null);
  const [screenPositions, setScreenPositions] = useState<Map<string, { x: number; y: number; visible: boolean }>>(new Map());
  const [withinRange, setWithinRange] = useState<Set<string>>(new Set());

  const surfaces: Surface[] = [
    { id: 'map',       label: 'Map Pedestal',     hint: 'E to read',     pos: { x: 600, y: 30, z: 600 }, open: () => onOpenMap?.() },
    { id: 'sheet',     label: 'Character Mirror', hint: 'E to inspect',  pos: { x: 580, y: 30, z: 620 }, open: () => onOpenSheet?.() },
    { id: 'inventory', label: 'Storage Chest',    hint: 'E to open',     pos: { x: 620, y: 30, z: 620 }, open: () => onOpenInventory?.() },
  ];

  // Listen for projector readiness.
  useEffect(() => {
    function onProjector(e: Event) {
      const detail = (e as CustomEvent).detail as { project?: typeof projectorRef.current };
      if (typeof detail?.project === 'function') projectorRef.current = detail.project;
    }
    window.addEventListener('concordia:projector-ready', onProjector);
    return () => window.removeEventListener('concordia:projector-ready', onProjector);
  }, []);

  // Per-frame project + proximity. ~12hz throttle.
  useEffect(() => {
    let raf = 0;
    let last = 0;
    function loop(t: number) {
      raf = requestAnimationFrame(loop);
      if (t - last < 80) return;
      last = t;
      const proj = projectorRef.current;
      if (!proj) return;

      const nextScreen = new Map<string, { x: number; y: number; visible: boolean }>();
      const nextWithin = new Set<string>();
      for (const s of surfaces) {
        const p = proj(s.pos);
        if (p) nextScreen.set(s.id, p);
        const dx = playerPosition.x - s.pos.x;
        const dz = playerPosition.z - s.pos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < proximityRadius) nextWithin.add(s.id);
      }
      setScreenPositions(nextScreen);
      setWithinRange(nextWithin);
    }
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playerPosition, proximityRadius]);

  // E key → open the closest in-range surface.
  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.key.toLowerCase() !== 'e') return;
    if (withinRange.size === 0) return;
    // Pick closest surface among in-range.
    let best: Surface | null = null;
    let bestDist = Infinity;
    for (const s of surfaces) {
      if (!withinRange.has(s.id)) continue;
      const dx = playerPosition.x - s.pos.x;
      const dz = playerPosition.z - s.pos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < bestDist) { bestDist = dist; best = s; }
    }
    best?.open();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [withinRange, playerPosition.x, playerPosition.z]);

  useEffect(() => {
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleKey]);

  return (
    <div className="fixed inset-0 pointer-events-none z-[40]" aria-label="Diegetic interactables">
      {surfaces.map((s) => {
        const pos = screenPositions.get(s.id);
        if (!pos?.visible) return null;
        const inRange = withinRange.has(s.id);
        const tint = inRange
          ? 'bg-emerald-900/85 border-emerald-400/70 text-emerald-100'
          : 'bg-stone-900/70 border-stone-500/40 text-stone-300';
        return (
          <button
            key={s.id}
            type="button"
            className={`${PANEL} ${tint}`}
            style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
            onClick={() => s.open()}
            title={s.hint}
          >
            <div className="font-semibold">{s.label}</div>
            {inRange && <div className="opacity-70 mt-0.5">{s.hint}</div>}
          </button>
        );
      })}
    </div>
  );
}
