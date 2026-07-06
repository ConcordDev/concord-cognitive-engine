'use client';

/**
 * World-space markers — diegetic UI floating in 3D over NPCs, items,
 * objectives, and ping locations. Particle effects + damage numbers are
 * already wired (ParticleEffects, emitHitNumber); this is the OTHER
 * world-space layer the audit flagged: quest markers, interaction
 * prompts, ally indicators, social pings rendered in-world.
 *
 * Dead-event-listener fix (verification-audit campaign, 2026-07-06): this
 * component was fully built (real projection math, real marker categories,
 * a real emitWorldMarker() helper other components could call) but was
 * NEVER MOUNTED anywhere — so 'concordia:social-ping' had a listener with
 * zero effect even after the server->window bridge for social:ping was
 * fixed separately, because nothing ever rendered this component to
 * receive it. Its original prop interface also predated the
 * 'concordia:projector-ready' convention every sibling world-space overlay
 * (DamageBillboard, NPCActivityTag, BazaarLayer) now uses — rewritten to
 * match: no camera props, cache the world-to-screen projector the scene
 * broadcasts, and mounted in app/lenses/world/page.tsx next to
 * DamageBillboard.
 *
 * Marker categories:
 *   quest        — yellow exclamation/question mark above quest givers
 *   ally         — green dot above party members
 *   enemy        — red bracket around hostiles
 *   ping         — colored pulse from social-pings (wave, danger, etc.)
 *   loot         — gold sparkle above pickups
 *   interaction  — soft prompt ("Press E") above interactive objects
 *
 * The component subscribes to:
 *   - 'concordia:world-marker:add'   (new marker)
 *   - 'concordia:world-marker:remove' (id)
 *   - 'concordia:social-ping'        (auto-creates ping markers from
 *                                     server social:ping broadcasts)
 *   - 'concordia:projector-ready'    (world-to-screen projector, same as
 *                                     DamageBillboard/NPCActivityTag/BazaarLayer)
 *
 * Visibility: a marker only renders while the real projector reports it
 * in-frustum; opacity/scale fade with 2D ground distance from the player
 * (window.__concordiaPlayerPos) as a proxy for camera distance.
 */

import { useEffect, useRef, useState, useCallback } from 'react';

type Projection = { x: number; y: number; visible: boolean };
type Projector = (world: { x: number; y: number; z: number }) => Projection | null;

export type MarkerKind = 'quest' | 'ally' | 'enemy' | 'ping' | 'loot' | 'interaction';

export interface WorldMarker {
  id: string;
  kind: MarkerKind;
  position: { x: number; y: number; z: number };
  label?: string;
  icon?: string;     // emoji or class
  color?: string;
  ttlMs?: number;    // auto-remove after this duration
  pulse?: boolean;   // animated ping
}

interface ProjectedMarker extends WorldMarker {
  screenX: number;
  screenY: number;
  visible: boolean;
  distance: number;
}

interface WorldMarkersProps {
  /** Max distance at which markers stay readable. */
  visibilityRadius?: number;
}

const KIND_DEFAULTS: Record<MarkerKind, { color: string; icon: string }> = {
  quest:       { color: '#fbbf24', icon: '!' },
  ally:        { color: '#34d399', icon: '●' },
  enemy:       { color: '#ef4444', icon: '⚔' },
  ping:        { color: '#60a5fa', icon: '◉' },
  loot:        { color: '#facc15', icon: '★' },
  interaction: { color: '#e5e7eb', icon: 'E' },
};

export function WorldMarkers({
  visibilityRadius = 600,
}: WorldMarkersProps) {
  const [markers, setMarkers] = useState<Map<string, WorldMarker>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);
  const projectorRef = useRef<Projector | null>(null);

  // Cache the projector when ConcordiaScene dispatches it — same pattern as
  // DamageBillboard/NPCActivityTag/BazaarLayer.
  useEffect(() => {
    function onProjector(e: Event) {
      const detail = (e as CustomEvent).detail as { project: Projector };
      if (typeof detail?.project === 'function') projectorRef.current = detail.project;
    }
    window.addEventListener('concordia:projector-ready', onProjector);
    return () => window.removeEventListener('concordia:projector-ready', onProjector);
  }, []);

  const addMarker = useCallback((m: WorldMarker) => {
    setMarkers((prev) => {
      const next = new Map(prev);
      next.set(m.id, m);
      return next;
    });
    if (m.ttlMs) {
      setTimeout(() => {
        setMarkers((prev) => {
          const next = new Map(prev);
          next.delete(m.id);
          return next;
        });
      }, m.ttlMs);
    }
  }, []);

  const removeMarker = useCallback((id: string) => {
    setMarkers((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  // Subscribe to event channels.
  useEffect(() => {
    const onAdd = (e: Event) => {
      const m = (e as CustomEvent<WorldMarker>).detail;
      if (m?.id && m?.position) addMarker(m);
    };
    const onRemove = (e: Event) => {
      const id = (e as CustomEvent<{ id: string }>).detail?.id;
      if (id) removeMarker(id);
    };
    const onPing = (e: Event) => {
      const ping = (e as CustomEvent<{ from: string; type: string; position: { x: number; y: number; z: number } }>).detail;
      if (!ping?.position) return;
      addMarker({
        id:    `ping-${ping.from}-${Date.now()}`,
        kind:  'ping',
        position: ping.position,
        label: ping.type,
        ttlMs: 6000,
        pulse: true,
      });
    };
    window.addEventListener('concordia:world-marker:add',    onAdd);
    window.addEventListener('concordia:world-marker:remove', onRemove);
    window.addEventListener('concordia:social-ping',         onPing);
    return () => {
      window.removeEventListener('concordia:world-marker:add',    onAdd);
      window.removeEventListener('concordia:world-marker:remove', onRemove);
      window.removeEventListener('concordia:social-ping',         onPing);
    };
  }, [addMarker, removeMarker]);

  // Project markers from world → screen each frame, rAF-throttled — same
  // pattern as DamageBillboard. Distance falls back to the player position
  // global (set by AvatarSystem3D, the established proxy for "how far is
  // this from the camera" used by ExtractionRunHUD/DangerBandHUD/etc. when
  // a component doesn't otherwise have live camera vectors) so distance-
  // based fade still works without re-plumbing raw camera state.
  const [projected, setProjected] = useState<ProjectedMarker[]>([]);
  useEffect(() => {
    if (markers.size === 0) {
      setProjected([]);
      return;
    }
    let raf = 0;
    let last = 0;
    const THROTTLE_MS = 80;
    function loop(t: number) {
      raf = requestAnimationFrame(loop);
      if (t - last < THROTTLE_MS) return;
      last = t;
      const proj = projectorRef.current;
      if (!proj) return;
      const playerPos = (typeof window !== 'undefined'
        ? (window as { __concordiaPlayerPos?: { x: number; y?: number; z: number } }).__concordiaPlayerPos
        : null) ?? null;
      const out: ProjectedMarker[] = [];
      for (const m of markers.values()) {
        const p = proj(m.position);
        if (!p) continue;
        const distance = playerPos
          ? Math.hypot(m.position.x - playerPos.x, m.position.z - playerPos.z)
          : 0;
        out.push({ ...m, screenX: p.x, screenY: p.y, visible: p.visible, distance });
      }
      setProjected(out);
    }
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [markers]);

  return (
    <div ref={containerRef} className="pointer-events-none fixed inset-0 z-[40]" aria-hidden>
      {projected.map((m) => {
        if (!m.visible) return null;
        const def = KIND_DEFAULTS[m.kind];
        const color = m.color ?? def.color;
        const icon  = m.icon  ?? def.icon;
        const opacity = Math.max(0.3, 1 - Math.min(1, m.distance / visibilityRadius) * 0.7);
        const scale = Math.max(0.6, 1.0 - Math.min(1, m.distance / visibilityRadius) * 0.4);

        return (
          <div
            key={m.id}
            data-marker-id={m.id}
            data-marker-kind={m.kind}
            className="absolute -translate-x-1/2 -translate-y-1/2 transition-transform"
            style={{
              left: m.screenX,
              top:  m.screenY,
              opacity,
              transform: `translate(-50%, -50%) scale(${scale})`,
            }}
          >
            <div
              className={`flex items-center gap-1 rounded-full border px-2 py-1 backdrop-blur-md ${m.pulse ? 'animate-pulse' : ''}`}
              style={{ borderColor: color, color, background: `${color}22` }}
            >
              <span className="font-bold text-sm leading-none">{icon}</span>
              {m.label && <span className="text-[10px] uppercase tracking-wider">{m.label}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Ergonomic helpers — fire window events from any component ──────── */

export function emitWorldMarker(m: WorldMarker): void {
  try { window.dispatchEvent(new CustomEvent('concordia:world-marker:add', { detail: m })); } catch { /* SSR no-op */ }
}

export function clearWorldMarker(id: string): void {
  try { window.dispatchEvent(new CustomEvent('concordia:world-marker:remove', { detail: { id } })); } catch { /* SSR no-op */ }
}
