'use client';

/**
 * LandmarkSpires — Sprint C / Track B3
 *
 * Tsushima-style "follow the wind / look at the spire" diegetic UI. For
 * every authored anchor in the active world's `meta.json` we render a
 * tall thin emissive vertical bar projected to screen-space so the player
 * can navigate by silhouette instead of minimap.
 *
 * Quest waypoints rim-light the spire of the active quest's destination.
 *
 * Server contract: `/api/lens/run` domain=worlds name=anchors_for_world
 * → returns `{ anchors: [{ id, name, x, z, faction_id?, kind? }] }`.
 */

import React, { useEffect, useState } from 'react';

interface Anchor {
  id: string; name: string; x: number; z: number;
  faction_id?: string;
  kind?: string;
  is_goddess_glade?: boolean;
}

interface QuestWaypoint {
  questId: string;
  anchorId?: string;
  x?: number; z?: number;
}

interface CameraSnapshot {
  x: number; y: number; z: number;
  yaw: number; pitch: number;
  fov: number;
  width: number; height: number;
}

interface Props {
  worldId: string;
  /** Reads the imperative camera state — caller (world page) supplies a
   *  getCamera() function that returns the active camera snapshot. */
  getCamera: () => CameraSnapshot | null;
  activeQuestWaypoint?: QuestWaypoint | null;
}

const FACTION_COLOR_FALLBACK = '#bcd';
const FACTION_COLORS: Record<string, string> = {
  iron_wardens: '#dc8',
  shroud_guild: '#cad',
  couriers_guild: '#8dc',
  freenodes: '#cdc',
  witnesses: '#dcb',
};
const GODDESS_COLOR = '#fce8a8';

export default function LandmarkSpires({ worldId, getCamera, activeQuestWaypoint }: Props) {
  const [anchors, setAnchors] = useState<Anchor[]>([]);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!worldId) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/lens/run', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domain: 'worlds', name: 'anchors_for_world', input: { worldId } }),
        });
        if (!r.ok) return;
        const j = await r.json();
        if (!cancelled && Array.isArray(j?.anchors)) setAnchors(j.anchors);
      } catch { /* fine */ }
    })();
    return () => { cancelled = true; };
  }, [worldId]);

  // Drive re-render at 30Hz while camera is moving (cheap; camera read is O(1)).
  useEffect(() => {
    let raf: number;
    const loop = () => { setTick(t => t + 1); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const cam = getCamera();
  if (!cam) return null;

  return (
    <div aria-hidden style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 8 }}>
      {anchors.map((a) => {
        const screen = projectToScreen(a.x, 0, a.z, cam);
        if (!screen.visible) return null;
        const dist = distance(a.x, a.z, cam.x, cam.z);
        const fade = Math.max(0.15, Math.min(1.0, 1.0 - dist / 800));
        const color = a.is_goddess_glade ? GODDESS_COLOR
                    : (FACTION_COLORS[a.faction_id ?? ''] ?? FACTION_COLOR_FALLBACK);
        const isActive = activeQuestWaypoint?.anchorId === a.id;
        const height = Math.max(40, 200 - dist / 8);

        return (
          <div
            key={a.id}
            style={{
              position: 'absolute',
              left: screen.x, top: screen.y - height,
              width: 3, height,
              background: `linear-gradient(to top, transparent, ${color})`,
              opacity: fade,
              boxShadow: isActive ? `0 0 12px ${color}` : 'none',
              transform: 'translateX(-50%)',
            }}
          >
            {isActive && (
              <div style={{
                position: 'absolute', top: -22, left: '50%', transform: 'translateX(-50%)',
                fontSize: 10, color, textShadow: '0 0 4px black',
                whiteSpace: 'nowrap',
              }}>
                ★ {a.name}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function distance(x1: number, z1: number, x2: number, z2: number) {
  const dx = x1 - x2, dz = z1 - z2;
  return Math.sqrt(dx * dx + dz * dz);
}

function projectToScreen(
  wx: number, wy: number, wz: number,
  cam: CameraSnapshot,
): { x: number; y: number; visible: boolean } {
  // Subtract camera origin.
  const dx = wx - cam.x, dy = wy - cam.y, dz = wz - cam.z;
  // Rotate by yaw (around y), then pitch (around x).
  const cy = Math.cos(-cam.yaw), sy = Math.sin(-cam.yaw);
  let rx = dx * cy + dz * sy;
  let rz = -dx * sy + dz * cy;
  const cp = Math.cos(-cam.pitch), sp = Math.sin(-cam.pitch);
  const ry = dy * cp - rz * sp;
  rz = dy * sp + rz * cp;
  // Behind camera?
  if (rz <= 0.5) return { x: 0, y: 0, visible: false };
  const f = (cam.height / 2) / Math.tan(cam.fov / 2);
  const sxp = (rx / rz) * f + cam.width / 2;
  const syp = (-ry / rz) * f + cam.height / 2;
  if (sxp < 0 || sxp > cam.width || syp < 0 || syp > cam.height) {
    return { x: sxp, y: syp, visible: false };
  }
  return { x: sxp, y: syp, visible: true };
}
