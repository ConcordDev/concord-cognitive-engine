'use client';

/**
 * CompassStrip — Skyrim-style top-center horizontal compass.
 *
 * Renders NSEW cardinals + degree ticks + markers for:
 *   - Nearby lens portals (yellow ▲ — points of interest)
 *   - Nearby NPCs within ~30m (cyan dot)
 *   - Active quest waypoints (gold ★)  — listens for
 *     `concordia:quest-waypoint` CustomEvent { target: {x,z}, label }
 *
 * Computes each marker's bearing relative to the player's heading and
 * positions it horizontally along the strip. Markers off the visible
 * ±90° arc are clipped.
 *
 * Pure presentation — no API calls. The parent feeds player position +
 * yaw + the marker source arrays.
 */

import { useEffect, useMemo, useState } from 'react';

export interface CompassMarker {
  id: string;
  x: number;        // world position
  z: number;        // world position (we map y→z when y is top-down)
  kind: 'portal' | 'npc' | 'quest' | 'objective';
  label?: string;
}

interface Props {
  playerX: number;
  playerZ: number;
  /** Yaw in radians. 0 = facing +Z (north). Positive = right (east). */
  playerYaw: number;
  markers: CompassMarker[];
  /** Visible angular arc, ±halfFov degrees. Default 90 (i.e. 180° total). */
  halfFovDeg?: number;
}

const KIND_COLOR: Record<CompassMarker['kind'], string> = {
  portal:    '#facc15',  // yellow-400
  npc:       '#22d3ee',  // cyan-400
  quest:     '#f59e0b',  // amber-500
  objective: '#a855f7',  // violet-500
};

const KIND_GLYPH: Record<CompassMarker['kind'], string> = {
  portal:    '▲',
  npc:       '●',
  quest:     '★',
  objective: '◆',
};

/** Convert world bearing → screen-relative angle in degrees, normalised to [-180, 180]. */
function bearingToScreenAngle(
  playerX: number,
  playerZ: number,
  playerYaw: number,
  markerX: number,
  markerZ: number,
): number {
  const dx = markerX - playerX;
  const dz = markerZ - playerZ;
  // World bearing: 0 = +Z. Use atan2(dx, dz) so 0 is north.
  const worldAngle = Math.atan2(dx, dz);
  let rel = worldAngle - playerYaw;
  // Wrap into [-PI, PI]
  while (rel >  Math.PI) rel -= 2 * Math.PI;
  while (rel < -Math.PI) rel += 2 * Math.PI;
  return (rel * 180) / Math.PI;
}

export default function CompassStrip({
  playerX,
  playerZ,
  playerYaw,
  markers,
  halfFovDeg = 90,
}: Props) {
  // Quest waypoints from event bus — components like QuestTracker can dispatch
  // `concordia:quest-waypoint` to drop a marker on the compass.
  const [questWaypoints, setQuestWaypoints] = useState<CompassMarker[]>([]);
  useEffect(() => {
    const onWp = (e: Event) => {
      const ce = e as CustomEvent<{ target: { x: number; z: number }; label?: string; id?: string }>;
      if (!ce.detail?.target) return;
      const wp: CompassMarker = {
        id: ce.detail.id || `wp_${Date.now()}`,
        x: ce.detail.target.x,
        z: ce.detail.target.z,
        kind: 'quest',
        label: ce.detail.label,
      };
      setQuestWaypoints((prev) => {
        const next = prev.filter((p) => p.id !== wp.id);
        next.push(wp);
        return next;
      });
    };
    const onClear = () => setQuestWaypoints([]);
    window.addEventListener('concordia:quest-waypoint', onWp);
    window.addEventListener('concordia:quest-waypoint-clear', onClear);
    return () => {
      window.removeEventListener('concordia:quest-waypoint', onWp);
      window.removeEventListener('concordia:quest-waypoint-clear', onClear);
    };
  }, []);

  const allMarkers = useMemo(() => [...markers, ...questWaypoints], [markers, questWaypoints]);

  const visible = useMemo(() => {
    return allMarkers
      .map((m) => {
        const ang = bearingToScreenAngle(playerX, playerZ, playerYaw, m.x, m.z);
        return { ...m, ang };
      })
      .filter((m) => Math.abs(m.ang) <= halfFovDeg);
  }, [allMarkers, playerX, playerZ, playerYaw, halfFovDeg]);

  // Cardinal tick positions — N, NE, E, SE, S, SW, W, NW relative to player.
  // World cardinal bearings (0=N, 90=E, …) → relative screen angle.
  const cardinals = useMemo(() => {
    const yawDeg = (playerYaw * 180) / Math.PI;
    const items = [
      { label: 'N', world: 0 },
      { label: 'NE', world: 45 },
      { label: 'E', world: 90 },
      { label: 'SE', world: 135 },
      { label: 'S', world: 180 },
      { label: 'SW', world: 225 },
      { label: 'W', world: 270 },
      { label: 'NW', world: 315 },
    ];
    return items
      .map((c) => {
        let rel = c.world - yawDeg;
        while (rel >  180) rel -= 360;
        while (rel < -180) rel += 360;
        return { ...c, ang: rel };
      })
      .filter((c) => Math.abs(c.ang) <= halfFovDeg);
  }, [playerYaw, halfFovDeg]);

  const angToPct = (ang: number) => 50 + (ang / halfFovDeg) * 50;

  return (
    <div className="pointer-events-none fixed top-3 left-1/2 -translate-x-1/2 z-40 w-[480px] h-9">
      {/* Backplate */}
      <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm border border-white/10 rounded-md" />
      {/* Center reticle */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-0.5 h-full bg-cyan-400/80" />
      <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-x-[5px] border-x-transparent border-t-[5px] border-t-cyan-400/80" />
      {/* Cardinal labels */}
      {cardinals.map((c) => {
        const isCardinal = c.label.length === 1;
        return (
          <div
            key={c.label}
            className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 font-mono uppercase tracking-wider ${
              isCardinal
                ? 'text-[11px] font-bold text-white'
                : 'text-[9px] text-slate-400'
            }`}
            style={{ left: `${angToPct(c.ang)}%` }}
          >
            {c.label}
          </div>
        );
      })}
      {/* Markers */}
      {visible.map((m) => (
        <div
          key={m.id}
          className="absolute top-1 -translate-x-1/2"
          style={{ left: `${angToPct(m.ang)}%` }}
          title={m.label || m.id}
        >
          <div
            className="text-[14px] leading-none drop-shadow"
            style={{ color: KIND_COLOR[m.kind], textShadow: '0 0 4px rgba(0,0,0,0.8)' }}
          >
            {KIND_GLYPH[m.kind]}
          </div>
        </div>
      ))}
    </div>
  );
}
