'use client';

// Lens-as-Station approach prompt — the diegetic "you're near a place" cue.
//
// The interaction plumbing already works (clicking a station building dispatches
// concordia:building-interact → the router opens the lens). What was missing is
// DISCOVERY: walking up to The Observatory with no sign it's enterable. This HUD
// watches the player position (window.__concordiaPlayerPos, set by
// AvatarSystem3D) against the world's lens-station buildings and, when you're
// near one, shows its lore name + verb + an [E] affordance. Pressing E (or
// clicking the prompt) fires the same building-interact event a click would —
// so the prompt is purely additive discovery, not a parallel code path.

import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveStationLens, type StationLens } from '@/lib/station-lens-registry';

const APPROACH_RADIUS_M = 6; // show the cue a touch beyond the router's 4m gate
const POLL_MS = 300;
const WORLD_TO_SCENE_OFFSET = 1000; // = TERRAIN_SIZE/2; server [0,2000] frame → origin-centred scene frame

export interface StationBuilding { id: string; building_type: string; x: number; z: number; name?: string }

/** Pure: nearest lens-station building within radius of the player, with its
 *  registry entry resolved. Returns null when none qualify. */
export function nearestStation(
  player: { x: number; z: number } | null,
  buildings: StationBuilding[],
  radius: number,
): { building: StationBuilding; station: StationLens; dist: number } | null {
  if (!player) return null;
  let best: { building: StationBuilding; station: StationLens; dist: number } | null = null;
  for (const b of buildings) {
    const station = resolveStationLens(b.building_type);
    if (!station) continue;
    const dist = Math.hypot(b.x - player.x, b.z - player.z);
    if (dist <= radius && (!best || dist < best.dist)) best = { building: b, station, dist };
  }
  return best;
}

function activeWorldId(): string {
  if (typeof window === 'undefined') return 'concordia-hub';
  return localStorage.getItem('concordia:activeWorldId') || 'concordia-hub';
}

export function LensStationPrompt() {
  const [worldId] = useState(activeWorldId);
  const [stations, setStations] = useState<StationBuilding[]>([]);
  const [near, setNear] = useState<{ building: StationBuilding; station: StationLens } | null>(null);
  const nearRef = useRef(near);
  nearRef.current = near;

  // Load the world's buildings once, keep only the lens-station ones.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/worlds/${encodeURIComponent(worldId)}/buildings`, { credentials: 'include' });
        if (!r.ok) return;
        const j = await r.json();
        // Buildings come from the server in the [0, 2000] world frame; the player
        // position (__concordiaPlayerPos) is in the origin-centred scene frame.
        // Shift to the scene frame (matching how the 3D buildings render) so the
        // proximity check compares like-for-like, otherwise the prompt never
        // fires (server ~800 vs player ~0).
        const list: StationBuilding[] = (j?.buildings || [])
          .filter((b: { building_type?: string }) => b.building_type && resolveStationLens(b.building_type))
          .map((b: StationBuilding) => ({ id: b.id, building_type: b.building_type, x: b.x - WORLD_TO_SCENE_OFFSET, z: b.z - WORLD_TO_SCENE_OFFSET, name: b.name }));
        if (!cancelled) setStations(list);
      } catch { /* offline / no buildings — prompt simply never shows */ }
    })();
    return () => { cancelled = true; };
  }, [worldId]);

  // Poll the player position; surface the nearest station within range.
  useEffect(() => {
    if (stations.length === 0) return;
    const tick = () => {
      const pos = (typeof window !== 'undefined'
        ? (window as { __concordiaPlayerPos?: { x: number; z: number } }).__concordiaPlayerPos
        : null) || null;
      const hit = nearestStation(pos, stations, APPROACH_RADIUS_M);
      const cur = nearRef.current;
      // Only update state when the nearest building changes (avoid churn).
      if ((hit?.building.id || null) !== (cur?.building.id || null)) {
        setNear(hit ? { building: hit.building, station: hit.station } : null);
      }
    };
    tick();
    const iv = setInterval(tick, POLL_MS);
    return () => clearInterval(iv);
  }, [stations]);

  // Enter the nearest station (same event a click dispatches). Reads the live
  // nearest via ref, so it stays stable across proximity changes.
  const enter = useCallback(() => {
    const cur = nearRef.current;
    if (!cur) return;
    window.dispatchEvent(new CustomEvent('concordia:building-interact', {
      detail: { worldId, buildingId: cur.building.id },
    }));
  }, [worldId]);

  // E enters the nearest station whenever one is in range.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'e' || e.key === 'E') enter();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enter]);

  if (!near) return null;

  return (
    <button
      type="button"
      onClick={enter}
      data-station-prompt={near.building.id}
      className="pointer-events-auto fixed bottom-28 left-1/2 z-40 -translate-x-1/2 rounded-lg border border-zinc-700 bg-zinc-950/90 px-4 py-2 text-center shadow-xl backdrop-blur transition hover:border-zinc-500"
    >
      <div className="text-sm font-semibold text-zinc-100">{near.station.placeLabel}</div>
      <div className="mt-0.5 text-xs text-zinc-400">
        {near.station.verb}
        <span className="ml-2 rounded border border-zinc-600 bg-zinc-800 px-1.5 py-0.5 text-[10px] font-mono text-zinc-200">E</span>
      </div>
    </button>
  );
}

export default LensStationPrompt;
