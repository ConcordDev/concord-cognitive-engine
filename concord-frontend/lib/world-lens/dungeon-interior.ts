/**
 * Dungeon Interior — Wave F follow-up. Renders full 3D procedural
 * dungeon rooms at an underground offset (Y = -100) below each
 * dungeon's overworld anchor. Player teleports in by walking into
 * the entrance marker + pressing G (or "Enter Dungeon" in the
 * DungeonPanel). Walking the avatar around explores rooms normally;
 * the floor + walls are built from the dungeon's persisted room
 * graph (connections drive corridor placement).
 *
 * Per-room geometry:
 *   - Floor:  20×20 slab at the room's (x, z) — width/depth-scaled
 *   - Walls:  four box meshes per room, gapped where a connection
 *             reaches an adjacent room
 *   - Ceiling: low-opacity to keep the interior readable
 *   - Theme:  material color + emissive picked from TEMPLATE_THEME
 *   - Hazard: small marker mesh per hazard kind (trap pad, ICE pulse,
 *             refusal glyph, etc.)
 *   - Boss:   larger room with a glowing throne plinth
 *   - Creatures: procedural meshes via the existing buildCreatureMesh
 *                helper, themed by template archetype mix
 *
 * Connection-aware wall gaps: for each pair of connected rooms, the
 * shared edge has a 4m gap so the player can walk through.
 *
 * Cleanup runs on dispose.
 */

import * as THREE from 'three';

const UNDERGROUND_Y = -100;

interface Room {
  dungeon_id: string;
  room_idx: number;
  kind: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  is_boss: 0 | 1;
  cleared: 0 | 1;
  creature_count: number;
  connections: number[];
  hazards: string[];
}

interface Dungeon {
  id: string;
  world_id: string;
  template_kind: string;
  name: string;
  anchor_x: number;
  anchor_z: number;
  depth_level: number;
  rooms: Room[];
}

interface SceneLike {
  add: (obj: unknown) => void;
  remove: (obj: unknown) => void;
}

const TEMPLATE_THEME: Record<string, { floor: number; wall: number; ceil: number; accent: number; ambient: number }> = {
  crypts_of_the_old_order: { floor: 0x3c2f2f, wall: 0x5c4a3a, ceil: 0x1a1410, accent: 0xf59e0b, ambient: 0x4a3520 },
  data_vault:              { floor: 0x0f172a, wall: 0x1e293b, ceil: 0x020617, accent: 0x22d3ee, ambient: 0x0e1726 },
  kingpin_compound:        { floor: 0x44403c, wall: 0x57534e, ceil: 0x1c1917, accent: 0xef4444, ambient: 0x3a2a2a },
  villain_lair:            { floor: 0x312e81, wall: 0x4c1d95, ceil: 0x1e1b4b, accent: 0xa78bfa, ambient: 0x2a1f5c },
  buried_throne:           { floor: 0x292524, wall: 0x44403c, ceil: 0x0c0a09, accent: 0xfacc15, ambient: 0x3a3020 },
  crucible_core:           { floor: 0x1e293b, wall: 0x334155, ceil: 0x0f172a, accent: 0x67e8f9, ambient: 0x153040 },
  outpost_complex:         { floor: 0x44403c, wall: 0x6b6258, ceil: 0x1c1917, accent: 0xfbbf24, ambient: 0x3a3528 },
  ancestor_grove:          { floor: 0x44403c, wall: 0x52524a, ceil: 0x1c1917, accent: 0x86efac, ambient: 0x2a3528 },
  council_undercity:       { floor: 0x44403c, wall: 0x57534e, ceil: 0x1c1917, accent: 0xfde047, ambient: 0x3a3520 },
  generic_ruin:            { floor: 0x57534e, wall: 0x78716c, ceil: 0x292524, accent: 0xa3a3a3, ambient: 0x3a3530 },
};

interface ActiveDungeon {
  id: string;
  group: THREE.Group;
  pointLights: THREE.PointLight[];
  pulsePhase: number;
  spawnedAt: number;
}

type Cleanup = () => void;

/**
 * Build the full interior mesh group for one dungeon. Walls, floors,
 * ceilings, hazards, boss treatment, and corridor connectors are
 * generated from the persisted room graph.
 */
export function buildDungeonInterior(dungeon: Dungeon): { group: THREE.Group; lights: THREE.PointLight[] } {
  const g = new THREE.Group();
  g.name = `dungeon:${dungeon.id}`;
  const theme = TEMPLATE_THEME[dungeon.template_kind] || TEMPLATE_THEME.generic_ruin;
  const pointLights: THREE.PointLight[] = [];

  const floorMat = new THREE.MeshLambertMaterial({ color: theme.floor });
  const wallMat  = new THREE.MeshLambertMaterial({ color: theme.wall });
  const ceilMat  = new THREE.MeshLambertMaterial({ color: theme.ceil, transparent: true, opacity: 0.5 });
  const accentMat = new THREE.MeshLambertMaterial({
    color: theme.accent, emissive: theme.accent, emissiveIntensity: 0.8,
  });

  const ROOM_HEIGHT = 5;
  const WALL_THICKNESS = 0.4;
  const CONNECTION_GAP = 4;

  // Index rooms by idx for quick lookup.
  const byIdx: Record<number, Room> = {};
  for (const r of dungeon.rooms) byIdx[r.room_idx] = r;

  for (const room of dungeon.rooms) {
    const w = room.is_boss === 1 ? room.width * 1.8 : room.width;
    const d = room.is_boss === 1 ? room.depth * 1.8 : room.depth;
    const h = room.is_boss === 1 ? ROOM_HEIGHT * 1.3 : ROOM_HEIGHT;

    // Floor.
    const floor = new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, d), floorMat);
    floor.position.set(room.x, -0.15, room.z);
    g.add(floor);

    // Ceiling.
    const ceil = new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, d), ceilMat);
    ceil.position.set(room.x, h + 0.15, room.z);
    g.add(ceil);

    // Determine which walls have connection gaps (skipped to allow
    // walking through to neighbours).
    const gaps = { north: false, south: false, east: false, west: false };
    for (const ci of room.connections) {
      const other = byIdx[ci];
      if (!other) continue;
      const dx = other.x - room.x;
      const dz = other.z - room.z;
      if (Math.abs(dx) > Math.abs(dz)) {
        if (dx > 0) gaps.east = true;
        else        gaps.west = true;
      } else {
        if (dz > 0) gaps.north = true;
        else        gaps.south = true;
      }
    }

    // Helper to build a wall with an optional gap in the middle.
    const buildWall = (along: 'x' | 'z', length: number, offsetX: number, offsetZ: number, hasGap: boolean) => {
      if (!hasGap) {
        const geom = along === 'x'
          ? new THREE.BoxGeometry(length, h, WALL_THICKNESS)
          : new THREE.BoxGeometry(WALL_THICKNESS, h, length);
        const m = new THREE.Mesh(geom, wallMat);
        m.position.set(room.x + offsetX, h / 2, room.z + offsetZ);
        g.add(m);
      } else {
        const segLen = (length - CONNECTION_GAP) / 2;
        for (const sign of [-1, 1]) {
          const geom = along === 'x'
            ? new THREE.BoxGeometry(segLen, h, WALL_THICKNESS)
            : new THREE.BoxGeometry(WALL_THICKNESS, h, segLen);
          const m = new THREE.Mesh(geom, wallMat);
          const segCenter = sign * (CONNECTION_GAP / 2 + segLen / 2);
          if (along === 'x') {
            m.position.set(room.x + offsetX + segCenter, h / 2, room.z + offsetZ);
          } else {
            m.position.set(room.x + offsetX, h / 2, room.z + offsetZ + segCenter);
          }
          g.add(m);
        }
      }
    };

    buildWall('x', w, 0, -d / 2, gaps.south); // south wall
    buildWall('x', w, 0,  d / 2, gaps.north); // north wall
    buildWall('z', d,  w / 2, 0, gaps.east);  // east wall
    buildWall('z', d, -w / 2, 0, gaps.west);  // west wall

    // Lighting: every room gets one accent point-light. Boss rooms
    // get a brighter, lower light.
    const light = new THREE.PointLight(theme.accent, room.is_boss === 1 ? 2.5 : 1.0, room.is_boss === 1 ? 30 : 18);
    light.position.set(room.x, h * 0.7, room.z);
    g.add(light);
    pointLights.push(light);

    // Boss-room throne plinth.
    if (room.is_boss === 1) {
      const plinth = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 3.0, 1.2, 12), accentMat);
      plinth.position.set(room.x, 0.7, room.z);
      plinth.userData.isPulse = 1;
      g.add(plinth);
      const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, h - 1.4, 6), accentMat);
      beacon.position.set(room.x, h / 2, room.z);
      beacon.userData.isPulse = 1;
      g.add(beacon);
    }

    // Hazard markers — small floor decals for each hazard kind.
    room.hazards.forEach((haz, i) => {
      const hazMat = new THREE.MeshLambertMaterial({
        color: _hazardColor(haz),
        emissive: _hazardColor(haz),
        emissiveIntensity: 0.5,
      });
      const marker = new THREE.Mesh(new THREE.CircleGeometry(1.4, 16), hazMat);
      marker.rotation.x = -Math.PI / 2;
      marker.position.set(room.x + (i - 0.5) * 3, 0.05, room.z - d / 4);
      marker.userData.isPulse = 1;
      g.add(marker);
    });

    // Entrance marker on the floor of room 0.
    if (room.room_idx === 0) {
      const entrance = new THREE.Mesh(new THREE.RingGeometry(1.8, 2.4, 24), accentMat);
      entrance.rotation.x = -Math.PI / 2;
      entrance.position.set(room.x, 0.06, room.z);
      entrance.userData.isPulse = 1;
      g.add(entrance);
    }

    // Creatures — placeholder colored capsule per creature_count.
    // Real creature meshes via buildCreatureMesh would require
    // synthesising blueprints; the lit boxes give the player a sense
    // of "things here" until the combat-integration follow-up.
    for (let ci = 0; ci < room.creature_count; ci++) {
      const cMat = new THREE.MeshLambertMaterial({
        color: 0x991b1b, emissive: 0x7f1d1d, emissiveIntensity: 0.3,
      });
      const creature = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.45, 1.1, 4, 6),
        cMat,
      );
      const angle = (ci / Math.max(1, room.creature_count)) * Math.PI * 2;
      creature.position.set(
        room.x + Math.cos(angle) * (Math.min(w, d) / 4),
        1.1,
        room.z + Math.sin(angle) * (Math.min(w, d) / 4),
      );
      creature.userData.isCreature = 1;
      g.add(creature);
    }
  }

  // Corridor floor connectors between linked rooms (simple bridges).
  const seen = new Set<string>();
  for (const room of dungeon.rooms) {
    for (const ci of room.connections) {
      const other = byIdx[ci];
      if (!other) continue;
      const key = room.room_idx < ci ? `${room.room_idx}-${ci}` : `${ci}-${room.room_idx}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const midX = (room.x + other.x) / 2;
      const midZ = (room.z + other.z) / 2;
      const dx = other.x - room.x;
      const dz = other.z - room.z;
      const len = Math.hypot(dx, dz);
      const bridgeGeo = new THREE.BoxGeometry(len * 0.6, 0.2, 3);
      const bridge = new THREE.Mesh(bridgeGeo, floorMat);
      bridge.position.set(midX, -0.1, midZ);
      bridge.rotation.y = Math.atan2(dz, dx);
      g.add(bridge);
    }
  }

  // Ambient light so the player can see when between point-light radii.
  const ambient = new THREE.AmbientLight(theme.ambient, 0.35);
  g.add(ambient);

  // Position the whole dungeon at its anchor underground.
  g.position.set(dungeon.anchor_x, UNDERGROUND_Y, dungeon.anchor_z);

  return { group: g, lights: pointLights };
}

function _hazardColor(kind: string): number {
  if (/curse|glyph|refusal/.test(kind))  return 0xc026d3;
  if (/ice|frostbite|cryo/.test(kind))   return 0x67e8f9;
  if (/trap|spike|claymore/.test(kind))  return 0xef4444;
  if (/spirit|haze|ancestral/.test(kind))return 0xa78bfa;
  if (/laser|grid|ray/.test(kind))       return 0xfde047;
  if (/meltdown|core|reactor/.test(kind))return 0xfb923c;
  return 0xfacc15;
}

/**
 * Attach the dungeon interior renderer. Caller (world page) tells us
 * which dungeon to render via setActiveDungeonId; the renderer
 * fetches the dungeon, builds the mesh, and adds it under the
 * underground offset. When the player exits, the mesh is removed.
 *
 * Returns { setActive, dispose } so the caller can swap which dungeon
 * is mounted without re-attaching.
 */
export function attachDungeonInterior(scene: SceneLike): {
  setActive: (dungeonId: string | null) => Promise<void>;
  dispose: Cleanup;
} {
  const active: ActiveDungeon | null = null;
  let current: ActiveDungeon | null = active;
  let animFrame: number | null = null;
  let disposed = false;

  const detach = () => {
    if (!current) return;
    try { scene.remove(current.group); } catch { /* ok */ }
    current.group.traverse((c) => {
      const m = c as THREE.Mesh;
      if (m.geometry?.dispose) try { m.geometry.dispose(); } catch { /* ok */ }
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((mm) => { try { mm.dispose(); } catch { /* ok */ } });
      else if (mat?.dispose) try { mat.dispose(); } catch { /* ok */ }
    });
    current = null;
  };

  const setActive = async (dungeonId: string | null) => {
    if (disposed) return;
    if (current && current.id === dungeonId) return;
    detach();
    if (!dungeonId) return;
    try {
      const r = await fetch(`/api/dungeons/${encodeURIComponent(dungeonId)}`, { credentials: 'same-origin' });
      if (!r.ok) return;
      const j = await r.json();
      if (!j?.ok || !j.dungeon) return;
      const built = buildDungeonInterior(j.dungeon);
      scene.add(built.group);
      current = {
        id: dungeonId,
        group: built.group,
        pointLights: built.lights,
        pulsePhase: Math.random() * Math.PI * 2,
        spawnedAt: performance.now(),
      };
    } catch { /* best-effort */ }
  };

  // Pulse animation for accent / hazard / boss-beacon elements.
  const tick = () => {
    if (disposed) return;
    if (current) {
      const t = (performance.now() - current.spawnedAt) / 1000;
      current.group.traverse((c) => {
        if ((c as THREE.Object3D & { userData?: { isPulse?: number } }).userData?.isPulse) {
          const m = (c as THREE.Mesh).material as THREE.MeshLambertMaterial;
          m.emissiveIntensity = 0.5 + Math.sin(t * 2 + current!.pulsePhase) * 0.35;
        }
        if ((c as THREE.Object3D & { userData?: { isCreature?: number } }).userData?.isCreature) {
          (c as THREE.Mesh).rotation.y = (c as THREE.Mesh).rotation.y + 0.005;
        }
      });
    }
    animFrame = requestAnimationFrame(tick);
  };
  animFrame = requestAnimationFrame(tick);

  return {
    setActive,
    dispose: () => {
      disposed = true;
      if (animFrame != null) cancelAnimationFrame(animFrame);
      detach();
    },
  };
}

export const _internal = { UNDERGROUND_Y, TEMPLATE_THEME };
