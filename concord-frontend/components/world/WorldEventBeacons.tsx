'use client';

/**
 * WorldEventBeacons — diegetic 3D markers for "what's happening now".
 *
 * Replaces (well, augments) the 2D DistrictActivityFeed list with in-world
 * beacons: each active world event raises a gold column of light you can SEE
 * across the district and walk toward — the RDR2/Elden-Ring "the world tells you
 * where things are" read, instead of reading a menu.
 *
 * Reuses the proven QuestWaypointBeacon pattern (attach a Three.js group to
 * `window.__concordiaScene`, animate via rAF). World events carry no position in
 * the backend today, so each event is anchored at a STABLE per-id position
 * (hashed into the district) — the beacon marks "an event is over there"; the
 * exact spot is deterministic per event so it doesn't jump between polls. When
 * the backend later geo-locates events, swap `positionForEvent` for the real
 * coords and nothing else changes.
 *
 * V1.2 Wave A: ALSO polls the top-N live spontaneous gatherings
 * (`world.gatherings` macro → `spontaneousGatherings()`,
 * server/lib/city-presence.js) and renders one beacon per gathering at its
 * REAL centroid (x/y/z of the actual clustered player positions that
 * triggered detection) — never a hashed/fabricated spot, unlike the
 * authored-event beacons above. Gathering beacons are a distinct violet
 * color so the two kinds read as different phenomena at a glance, tracked
 * in a separate map so an events poll never disposes a gathering beacon
 * (and vice versa).
 *
 * Render-less from React's view — it mutates the scene imperatively. Silent when
 * there are no active events/gatherings or no scene. Kill-switch: pass enabled={false}.
 */

import { useCallback, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { lensRun } from '@/lib/api/client';

interface WorldEvent {
  id: string;
  name?: string;
  type?: string;
  status?: string;
}

interface Gathering {
  id: string;
  location?: string;
  playerCount?: number;
  description?: string;
  x?: number;
  y?: number;
  z?: number;
}

interface Props {
  worldId: string;
  /** Poll interval; defaults to 15s (events change slowly). */
  pollMs?: number;
  enabled?: boolean;
}

// Gathering beacons are capped to the top-N most populous gatherings — a
// crowded world scanning dozens of tiny 2-person clusters would clutter the
// scene; the biggest gatherings are the ones worth walking toward.
const MAX_GATHERING_BEACONS = 5;
const GATHERING_COLOR = 0xb388ff; // violet — visually distinct from event ambers/reds/cyans

// Stable hash → a position within ±SPREAD of origin, per event id. Deterministic
// so a given event's beacon sits in the same spot across polls + restarts.
const SPREAD = 110;
function positionForEvent(id: string): { x: number; z: number } {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const a = ((h >>> 0) / 0xffffffff) * Math.PI * 2;
  const r = 25 + (((h >>> 8) & 0xffff) / 0xffff) * SPREAD;
  return { x: Math.cos(a) * r, z: Math.sin(a) * r };
}

function colorForType(type?: string): number {
  switch (String(type || '').toLowerCase()) {
    case 'festival':
    case 'celebration': return 0xffd24a; // warm gold
    case 'raid':
    case 'war':
    case 'crisis':     return 0xff5a4a; // alarm red
    case 'market':
    case 'bazaar':     return 0x4ad2ff; // trade cyan
    default:           return 0xffc04a; // generic amber
  }
}

export default function WorldEventBeacons({ worldId, pollMs = 15000, enabled = true }: Props) {
  // eventId -> beacon group
  const beaconsRef = useRef<Map<string, THREE.Group>>(new Map());
  // gatheringId -> beacon group (separate map so events/gatherings polls
  // never dispose each other's beacons).
  const gatheringBeaconsRef = useRef<Map<string, THREE.Group>>(new Map());
  const sceneRef = useRef<THREE.Scene | null>(null);

  const getScene = useCallback((): THREE.Scene | null => {
    if (sceneRef.current) return sceneRef.current;
    const w = window as unknown as { __concordiaScene?: THREE.Scene };
    sceneRef.current = w.__concordiaScene ?? null;
    return sceneRef.current;
  }, []);

  const disposeGroup = useCallback((scene: THREE.Scene, g: THREE.Group) => {
    scene.remove(g);
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else if (mat) mat.dispose();
    });
  }, []);

  const buildBeacon = useCallback((ev: WorldEvent): THREE.Group => {
    const group = new THREE.Group();
    group.name = `world-event-beacon:${ev.id}`;
    const color = new THREE.Color(colorForType(ev.type));
    const column = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.55, 44, 12, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }),
    );
    column.position.y = 22; column.name = 'beacon:column';
    group.add(column);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(2.0, 0.16, 8, 32),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending }),
    );
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.15; ring.name = 'beacon:ring';
    group.add(ring);
    const pos = positionForEvent(ev.id);
    group.position.set(pos.x, 0, pos.z);
    return group;
  }, []);

  const buildGatheringBeacon = useCallback((g: Gathering): THREE.Group => {
    const group = new THREE.Group();
    group.name = `world-gathering-beacon:${g.id}`;
    const color = new THREE.Color(GATHERING_COLOR);
    const column = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.55, 44, 12, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }),
    );
    column.position.y = 22; column.name = 'beacon:column';
    group.add(column);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(2.0, 0.16, 8, 32),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending }),
    );
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.15; ring.name = 'beacon:ring';
    group.add(ring);
    // Real centroid of the clustered players — never a hashed/fabricated spot.
    const x = typeof g.x === 'number' ? g.x : 0;
    const y = typeof g.y === 'number' ? g.y : 0;
    const z = typeof g.z === 'number' ? g.z : 0;
    group.position.set(x, y, z);
    return group;
  }, []);

  // ── Poll active events + reconcile beacons ──────────────────────
  const refresh = useCallback(async () => {
    if (!enabled) return;
    const scene = getScene();
    if (!scene) return;
    let events: WorldEvent[] = [];
    try {
      const r = await fetch(`/api/worlds/${worldId}/events?status=active&limit=12`, { credentials: 'include' });
      if (r.ok) {
        const d = await r.json();
        events = Array.isArray(d?.events) ? d.events : [];
      }
    } catch { /* offline — keep current beacons */ return; }

    const live = new Set(events.map((e) => e.id));
    // Remove beacons for events that ended.
    for (const [id, g] of beaconsRef.current) {
      if (!live.has(id)) { disposeGroup(scene, g); beaconsRef.current.delete(id); }
    }
    // Add beacons for new events.
    for (const ev of events) {
      if (beaconsRef.current.has(ev.id)) continue;
      const g = buildBeacon(ev);
      scene.add(g);
      beaconsRef.current.set(ev.id, g);
    }
  }, [worldId, enabled, getScene, disposeGroup, buildBeacon]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, Math.max(3000, pollMs));
    return () => clearInterval(id);
  }, [refresh, pollMs]);

  // ── Poll spontaneous gatherings + reconcile beacons ──────────────
  const refreshGatherings = useCallback(async () => {
    if (!enabled) return;
    const scene = getScene();
    if (!scene) return;
    let gatherings: Gathering[] = [];
    try {
      const r = await lensRun<{ gatherings?: Gathering[] }>('world', 'gatherings', { worldId });
      const rows = r.data?.ok ? r.data.result?.gatherings : null;
      gatherings = Array.isArray(rows) ? rows.filter((g) => typeof g.x === 'number' && typeof g.z === 'number') : [];
    } catch { /* offline — keep current beacons */ return; }

    // Top-N by playerCount — the macro already sorts descending, but sort
    // again defensively before slicing.
    gatherings = [...gatherings]
      .sort((a, b) => (b.playerCount || 0) - (a.playerCount || 0))
      .slice(0, MAX_GATHERING_BEACONS);

    const live = new Set(gatherings.map((g) => g.id));
    for (const [id, g] of gatheringBeaconsRef.current) {
      if (!live.has(id)) { disposeGroup(scene, g); gatheringBeaconsRef.current.delete(id); }
    }
    for (const gathering of gatherings) {
      if (gatheringBeaconsRef.current.has(gathering.id)) continue;
      const g = buildGatheringBeacon(gathering);
      scene.add(g);
      gatheringBeaconsRef.current.set(gathering.id, g);
    }
  }, [worldId, enabled, getScene, disposeGroup, buildGatheringBeacon]);

  useEffect(() => {
    refreshGatherings();
    const id = setInterval(refreshGatherings, Math.max(3000, pollMs));
    return () => clearInterval(id);
  }, [refreshGatherings, pollMs]);

  // Tear down all beacons on unmount / world change.
  useEffect(() => {
    const beacons = beaconsRef.current; // capture at effect-run time for the cleanup
    const gatheringBeacons = gatheringBeaconsRef.current;
    return () => {
      const scene = sceneRef.current;
      if (scene) {
        for (const g of beacons.values()) disposeGroup(scene, g);
        for (const g of gatheringBeacons.values()) disposeGroup(scene, g);
      }
      beacons.clear();
      gatheringBeacons.clear();
    };
  }, [worldId, disposeGroup]);

  // ── Pulse/bob animation ─────────────────────────────────────────
  useEffect(() => {
    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      const t = performance.now() / 1000;
      const pulse = 0.85 + 0.15 * Math.sin(t * 2.0);
      for (const g of beaconsRef.current.values()) {
        const col = g.getObjectByName('beacon:column') as THREE.Mesh | undefined;
        const ring = g.getObjectByName('beacon:ring') as THREE.Mesh | undefined;
        if (col) (col.material as THREE.MeshBasicMaterial).opacity = 0.28 * pulse;
        if (ring) { (ring.material as THREE.MeshBasicMaterial).opacity = 0.6 * pulse; ring.rotation.z += 0.004; }
      }
      for (const g of gatheringBeaconsRef.current.values()) {
        const col = g.getObjectByName('beacon:column') as THREE.Mesh | undefined;
        const ring = g.getObjectByName('beacon:ring') as THREE.Mesh | undefined;
        if (col) (col.material as THREE.MeshBasicMaterial).opacity = 0.28 * pulse;
        if (ring) { (ring.material as THREE.MeshBasicMaterial).opacity = 0.6 * pulse; ring.rotation.z += 0.004; }
      }
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, []);

  return null;
}
