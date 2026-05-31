'use client';
import { useEffect, useRef, useState } from 'react';
import { mergeDamage, dmgLabel, type DmgEntry } from '@/lib/concordia/damage-stack';

// Theme 5 (game-feel pass): world-anchored damage numbers.
//
// Replaces the legacy CSS-fixed float-up overlay (still in GameJuice for
// non-combat juice like royalties) with a 3D-anchored billboard that
// rises 1.6m from the impact point and fades over 1.2s. Stays put as
// the camera moves — much more legible than a screen-relative number.
//
// Same projector pattern as NPCActivityTag / BazaarLayer: cache the
// world-to-screen function from concordia:projector-ready, throttle
// updates to ~12 Hz.
//
// Subscribes to a single window event:
//   concordia:damage-billboard {
//     id?:        string,                 // optional, auto-generated if absent
//     position:   { x, y?, z },           // world-space impact point
//     value:      string | number,        // text rendered ("17", "−3", "PARRY")
//     kind?:      'hit'|'crit'|'block'|'dodge'|'kill',  // colour
//     ttlMs?:     number,                 // default 1200
//   }

interface BillboardEntry {
  id: string;
  position: { x: number; y: number; z: number };
  value: string;
  kind: 'hit' | 'crit' | 'block' | 'dodge' | 'kill';
  bornAt: number;
  ttlMs: number;
  count: number; // hits coalesced into this entry (Track 1 grouping)
}

// Group same-spot numeric hits within this window/radius into a running tally so
// a combo reads as one climbing "+42 ×5" instead of a flurry of overlapping glyphs.
const GROUP_MS = 1500;
const GROUP_RADIUS_M = 1.5;

type Projection = { x: number; y: number; visible: boolean };
type Projector = (world: { x: number; y: number; z: number }) => Projection | null;

const RISE_M = 1.6;          // total rise in metres over the lifetime
const THROTTLE_MS = 80;       // ~12 Hz, matches NPCActivityTag/BazaarLayer
const KIND_COLOR: Record<BillboardEntry['kind'], string> = {
  hit:   'text-amber-200',
  crit:  'text-red-300',
  block: 'text-sky-200',
  dodge: 'text-emerald-200',
  kill:  'text-fuchsia-200',
};

let counter = 0;

export function DamageBillboard() {
  const [entries, setEntries] = useState<BillboardEntry[]>([]);
  const [screenPositions, setScreenPositions] = useState<Map<string, Projection>>(new Map());
  const projectorRef = useRef<Projector | null>(null);

  // Cache the projector when ConcordiaScene dispatches it.
  useEffect(() => {
    function onProjector(e: Event) {
      const detail = (e as CustomEvent).detail as { project: Projector };
      if (typeof detail?.project === 'function') projectorRef.current = detail.project;
    }
    window.addEventListener('concordia:projector-ready', onProjector);
    return () => window.removeEventListener('concordia:projector-ready', onProjector);
  }, []);

  // Subscribe to spawn events.
  useEffect(() => {
    function onSpawn(e: Event) {
      const detail = (e as CustomEvent).detail as Partial<BillboardEntry> & {
        position?: { x?: number; y?: number; z?: number };
        value?: string | number;
      };
      if (!detail?.position || detail.value === undefined) return;
      const id = (detail.id as string) ?? `dmg_${++counter}`;
      const pos = {
        x: Number(detail.position.x ?? 0),
        y: Number(detail.position.y ?? 0),
        z: Number(detail.position.z ?? 0),
      };
      const entry: BillboardEntry = {
        id,
        position: pos,
        value: String(detail.value),
        kind: (detail.kind as BillboardEntry['kind']) ?? 'hit',
        bornAt: performance.now(),
        ttlMs: Number(detail.ttlMs ?? 1200),
        count: 1,
      };
      setEntries((prev) => {
        // Run the pure grouping core over a flat DmgEntry view, then reconcile
        // back to the billboard shape (preserving each entry's ttl/position).
        const flat: DmgEntry[] = prev.map((e) => ({
          id: e.id, x: e.position.x, y: e.position.y, z: e.position.z,
          value: e.value, kind: e.kind, bornAt: e.bornAt, count: e.count,
        }));
        const merged = mergeDamage(flat, {
          id: entry.id, x: pos.x, y: pos.y, z: pos.z,
          value: entry.value, kind: entry.kind, bornAt: entry.bornAt,
        }, { groupMs: GROUP_MS, radiusM: GROUP_RADIUS_M, max: 32 });
        const byId = new Map(prev.map((e) => [e.id, e]));
        return merged.map((d): BillboardEntry => {
          const existing = byId.get(d.id);
          return {
            id: d.id,
            position: { x: d.x, y: d.y, z: d.z },
            value: d.value,
            kind: d.kind,
            bornAt: d.bornAt,
            ttlMs: existing ? existing.ttlMs : entry.ttlMs,
            count: d.count,
          };
        });
      });
    }
    window.addEventListener('concordia:damage-billboard', onSpawn);
    return () => window.removeEventListener('concordia:damage-billboard', onSpawn);
  }, []);

  // Project + cull expired. rAF throttled.
  useEffect(() => {
    if (entries.length === 0) {
      setScreenPositions(new Map());
      return;
    }
    let raf = 0;
    let last = 0;
    function loop(t: number) {
      raf = requestAnimationFrame(loop);
      if (t - last < THROTTLE_MS) return;
      last = t;
      const now = performance.now();
      // Drop expired entries.
      setEntries((prev) => prev.filter((e) => now - e.bornAt < e.ttlMs));
      const proj = projectorRef.current;
      if (!proj) return;
      const next = new Map<string, Projection>();
      for (const e of entries) {
        const elapsed = now - e.bornAt;
        if (elapsed >= e.ttlMs) continue;
        const lifeFrac = elapsed / e.ttlMs;
        const yLift = e.position.y + 1.0 + lifeFrac * RISE_M;
        const p = proj({ x: e.position.x, y: yLift, z: e.position.z });
        if (p) next.set(e.id, p);
      }
      setScreenPositions(next);
    }
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [entries]);

  if (entries.length === 0) return null;

  return (
    <div
      className="fixed inset-0 pointer-events-none z-[42]"
      data-testid="damage-billboard-layer"
      aria-hidden="true"
    >
      {entries.map((e) => {
        const pos = screenPositions.get(e.id);
        if (!pos?.visible) return null;
        const elapsed = performance.now() - e.bornAt;
        const lifeFrac = Math.max(0, Math.min(1, elapsed / e.ttlMs));
        const opacity = 1 - lifeFrac * lifeFrac; // ease-out fade
        const scale = 1 + lifeFrac * 0.25;
        return (
          <div
            key={e.id}
            data-billboard-id={e.id}
            data-billboard-kind={e.kind}
            className={`absolute -translate-x-1/2 -translate-y-1/2 select-none font-bold ${KIND_COLOR[e.kind]}`}
            style={{
              left: `${pos.x}px`,
              top: `${pos.y}px`,
              opacity,
              transform: `translate(-50%, -50%) scale(${scale.toFixed(3)})`,
              textShadow: '0 1px 2px rgba(0,0,0,0.8), 0 0 8px rgba(0,0,0,0.6)',
              fontSize: e.kind === 'crit' || e.kind === 'kill' ? '1.5rem' : '1.1rem',
            }}
          >
            {dmgLabel({ id: e.id, x: e.position.x, y: e.position.y, z: e.position.z, value: e.value, kind: e.kind, bornAt: e.bornAt, count: e.count })}
          </div>
        );
      })}
    </div>
  );
}
