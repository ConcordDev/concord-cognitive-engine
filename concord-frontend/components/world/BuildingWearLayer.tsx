'use client';
/**
 * BuildingWearLayer — Track 3 (legibility): persistent diegetic building wear.
 *
 * BuildingCollapseVFX plays the one-shot crack-puff / collapse burst on a
 * `concordia:building-state` transition, then the building looks pristine again.
 * This layer keeps a PERSISTENT scar at each damaged/collapsed building (cracks
 * for damaged, char/rubble for collapsed) until a repair (toState='standing')
 * clears it — so a world that was fought over *stays* visibly scarred.
 *
 * Uses the proven `concordia:projector-ready` world→screen projector (the same
 * channel DamageBillboard / NPCActivityTag ride) rather than the dormant
 * getCamera snapshot path. Additive + kill-switched
 * (window.__CONCORD_BUILDING_WEAR__ === false disables).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { applyWearEvent, wearStyle, type WearMark, type BuildingStateEvent } from '@/lib/concordia/building-wear';

type Projection = { x: number; y: number; visible: boolean };
type Projector = (world: { x: number; y: number; z: number }) => Projection | null;

interface Props {
  worldId: string;
}

export default function BuildingWearLayer({ worldId }: Props) {
  const [marks, setMarks] = useState<Map<string, WearMark>>(new Map());
  const [screen, setScreen] = useState<Map<string, Projection>>(new Map());
  const projectorRef = useRef<Projector | null>(null);

  // Cache the projector the scene dispatches.
  useEffect(() => {
    function onProjector(e: Event) {
      const detail = (e as CustomEvent).detail as { project: Projector };
      if (typeof detail?.project === 'function') projectorRef.current = detail.project;
    }
    window.addEventListener('concordia:projector-ready', onProjector);
    return () => window.removeEventListener('concordia:projector-ready', onProjector);
  }, []);

  const handle = useCallback((e: Event) => {
    const ev = (e as CustomEvent<BuildingStateEvent>).detail;
    if (!ev || (ev.worldId && ev.worldId !== worldId)) return;
    setMarks((prev) => applyWearEvent(prev, ev));
  }, [worldId]);

  useEffect(() => {
    if (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).__CONCORD_BUILDING_WEAR__ === false) return;
    window.addEventListener('concordia:building-state', handle as EventListener);
    return () => window.removeEventListener('concordia:building-state', handle as EventListener);
  }, [handle]);

  // Re-project scars as the camera moves (~12 Hz; static marks need no more).
  useEffect(() => {
    if (marks.size === 0) { setScreen(new Map()); return; }
    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - last < 80) return;
      last = t;
      const proj = projectorRef.current;
      if (!proj) return;
      const next = new Map<string, Projection>();
      for (const m of marks.values()) {
        const p = proj({ x: m.x, y: m.y + 1.2, z: m.z });
        if (p) next.set(m.buildingId, p);
      }
      setScreen(next);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [marks]);

  if (marks.size === 0) return null;

  return (
    <div aria-hidden style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 6 }} data-testid="building-wear-layer">
      {Array.from(marks.values()).map((m) => {
        const pos = screen.get(m.buildingId);
        if (!pos?.visible) return null;
        const style = wearStyle(m.level);
        const r = style.radius;
        return (
          <React.Fragment key={m.buildingId}>
            {/* Base smudge */}
            <div style={{
              position: 'absolute',
              left: pos.x - r, top: pos.y - r,
              width: r * 2, height: r * 2,
              borderRadius: '40%',
              background: `radial-gradient(circle, ${style.color}, transparent 72%)`,
            }} />
            {/* Crack streaks radiating from the scar centre */}
            {Array.from({ length: style.streaks }).map((_, i) => {
              const angle = (i / style.streaks) * Math.PI * 2 + (m.buildingId.length % 7);
              const len = r * 1.1;
              return (
                <div key={i} style={{
                  position: 'absolute',
                  left: pos.x, top: pos.y,
                  width: len, height: Math.max(1, r * 0.06),
                  background: style.color,
                  transformOrigin: '0 50%',
                  transform: `rotate(${angle}rad)`,
                }} />
              );
            })}
          </React.Fragment>
        );
      })}
    </div>
  );
}
