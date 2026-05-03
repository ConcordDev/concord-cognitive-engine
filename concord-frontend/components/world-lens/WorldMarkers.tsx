'use client';

/**
 * World-space markers — diegetic UI floating in 3D over NPCs, items,
 * objectives, and ping locations. Particle effects + damage numbers are
 * already wired (ParticleEffects, emitHitNumber); this is the OTHER
 * world-space layer the audit flagged: quest markers, interaction
 * prompts, ally indicators, social pings rendered in-world.
 *
 * Markers are projected from world to screen each frame. The renderer
 * supplies (worldX, worldY, worldZ); WorldMarkers does the projection.
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
 *
 * Visibility: markers fade when the camera moves > VISIBILITY_RADIUS
 * away. Off-screen markers are clamped to screen edges with arrows
 * so the player still knows which direction they're in.
 */

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';

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
  visible: boolean;     // in front of camera + within radius
  offScreenAngle: number; // for edge-clamped arrows
  edgeClamped: boolean;
  distance: number;
}

interface WorldMarkersProps {
  /** Camera position (player camera). */
  cameraPos: { x: number; y: number; z: number };
  /** Camera forward direction (unit vector in world space). */
  cameraForward: { x: number; y: number; z: number };
  /** Camera up direction. */
  cameraUp?: { x: number; y: number; z: number };
  /** Field of view (radians, vertical). */
  fov?: number;
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

function normalize(v: { x: number; y: number; z: number }) {
  const m = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / m, y: v.y / m, z: v.z / m };
}

function dot(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function WorldMarkers({
  cameraPos,
  cameraForward,
  cameraUp = { x: 0, y: 1, z: 0 },
  fov = Math.PI / 3,
  visibilityRadius = 600,
}: WorldMarkersProps) {
  const [markers, setMarkers] = useState<Map<string, WorldMarker>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);

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

  // Project markers from world → screen each render.
  const projected = useMemo<ProjectedMarker[]>(() => {
    const fwd = normalize(cameraForward);
    const up  = normalize(cameraUp);
    const right = normalize(cross(fwd, up));
    const trueUp = normalize(cross(right, fwd));

    const w = typeof window !== 'undefined' ? window.innerWidth  : 1920;
    const h = typeof window !== 'undefined' ? window.innerHeight : 1080;
    const aspect = w / h;
    const halfH = Math.tan(fov / 2);
    const halfW = halfH * aspect;

    const out: ProjectedMarker[] = [];
    for (const m of markers.values()) {
      const dx = m.position.x - cameraPos.x;
      const dy = m.position.y - cameraPos.y;
      const dz = m.position.z - cameraPos.z;
      const distance = Math.hypot(dx, dy, dz);

      const camRel = { x: dot({ x: dx, y: dy, z: dz }, right), y: dot({ x: dx, y: dy, z: dz }, trueUp), z: dot({ x: dx, y: dy, z: dz }, fwd) };

      const visible = camRel.z > 0.5 && distance < visibilityRadius;
      let screenX = w / 2;
      let screenY = h / 2;
      let edgeClamped = false;
      let offScreenAngle = 0;

      if (camRel.z > 0.05) {
        const ndcX = camRel.x / (camRel.z * halfW);
        const ndcY = camRel.y / (camRel.z * halfH);
        screenX = (ndcX * 0.5 + 0.5) * w;
        screenY = (1 - (ndcY * 0.5 + 0.5)) * h;

        // Edge-clamp off-screen markers
        if (screenX < 32 || screenX > w - 32 || screenY < 32 || screenY > h - 32) {
          edgeClamped = true;
          screenX = Math.max(32, Math.min(w - 32, screenX));
          screenY = Math.max(32, Math.min(h - 32, screenY));
          offScreenAngle = Math.atan2(camRel.y, camRel.x);
        }
      } else {
        // Behind camera — pin to bottom edge with arrow.
        edgeClamped = true;
        offScreenAngle = Math.atan2(camRel.y, camRel.x) + Math.PI;
        screenX = w / 2 + Math.cos(offScreenAngle) * (w / 2 - 32);
        screenY = h - 64;
      }

      out.push({ ...m, screenX, screenY, visible, edgeClamped, offScreenAngle, distance });
    }
    return out;
  }, [markers, cameraPos, cameraForward, cameraUp, fov, visibilityRadius]);

  return (
    <div ref={containerRef} className="pointer-events-none fixed inset-0 z-[40]" aria-hidden>
      {projected.map((m) => {
        if (!m.visible && !m.edgeClamped) return null;
        const def = KIND_DEFAULTS[m.kind];
        const color = m.color ?? def.color;
        const icon  = m.icon  ?? def.icon;
        const opacity = m.distance < visibilityRadius
          ? Math.max(0.3, 1 - (m.distance / visibilityRadius) * 0.7)
          : 0.3;
        const scale = Math.max(0.6, 1.0 - (m.distance / visibilityRadius) * 0.4);

        return (
          <div
            key={m.id}
            className="absolute -translate-x-1/2 -translate-y-1/2 transition-transform"
            style={{
              left: m.screenX,
              top:  m.screenY,
              opacity,
              transform: `translate(-50%, -50%) scale(${scale})${m.pulse ? ' translateY(0)' : ''}`,
            }}
          >
            <div
              className={`flex items-center gap-1 rounded-full border px-2 py-1 backdrop-blur-md ${m.pulse ? 'animate-pulse' : ''}`}
              style={{ borderColor: color, color, background: `${color}22` }}
            >
              <span className="font-bold text-sm leading-none">{icon}</span>
              {m.label && <span className="text-[10px] uppercase tracking-wider">{m.label}</span>}
              {m.edgeClamped && (
                <span
                  className="text-xs"
                  style={{ transform: `rotate(${m.offScreenAngle}rad)` }}
                >
                  ➤
                </span>
              )}
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
