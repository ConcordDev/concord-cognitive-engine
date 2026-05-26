/**
 * Hybrid Creature Renderer — builds procedural Three.js meshes from
 * the CreatureBlueprint JSON the backend emits via the
 * crossbreed-spawn-cycle heartbeat.
 *
 * Wiring: ConcordiaScene calls attachHybridCreatures(scene, worldId) once
 * per scene lifetime. The helper:
 *   1. Fetches existing alive hybrids via GET /api/worlds/:id/hybrids
 *   2. Subscribes to `world:hybrid-spawned` socket events
 *   3. Per blueprint, builds a Three.js Group from primitives sized
 *      and tinted by the blueprint's topology + mass + world flavor
 *   4. Adds idle bob animation per creature
 *   5. Returns cleanup fn — unsubscribes + disposes geometry
 *
 * The mesh is *procedural*, not a fetched GLTF — same idea as the
 * dome-barrier sphere or the building primitives. Skyrim ships static
 * models for every creature; we generate them per-hybrid because every
 * crossbreed is unique.
 */

import * as THREE from 'three';
import { subscribe } from '@/lib/realtime/socket';

export interface CreatureBlueprint {
  id: string;
  topology: string;            // winged_quadruped | quadruped | humanoid | serpentine | …
  massKg: number;
  heightM: number;
  worldId?: string;
  parts?: Array<{ kind: string; lengthM?: number; widthM?: number } | string> | Record<string, unknown>;
  abilityFlavors?: string[];
}

interface HybridRow {
  id: string;
  worldId: string;
  position: { x: number; y: number; z: number };
  parents: [string | null, string | null];
  generation: number;
  stability: number;
  crossWorld: boolean;
  createdAt: number;
  blueprint: CreatureBlueprint | null;
}

interface SpawnedPayload {
  hybridId: string;
  worldId: string;
  parents: [string, string];
  position: { x: number; y: number; z: number };
  stability: number;
  generation: number;
  crossWorld: boolean;
  topology: string;
  blueprint: CreatureBlueprint;
}

interface SceneLike {
  add: (obj: unknown) => void;
  remove: (obj: unknown) => void;
}

// Topology → body color base (overridden by world flavor below)
const TOPOLOGY_COLOR: Record<string, number> = {
  winged_quadruped: 0xc97a4a,  // dragon-ish russet
  winged_biped:     0xa3c2ff,  // hawk pale-blue
  quadruped:        0x8b6b3a,  // wolf tan
  humanoid:         0xd4b896,  // skin
  serpentine:       0x6a8843,  // snake olive
  amorphous:        0x9d4edd,  // slime purple
  polyped:          0x4a6b8a,  // arthropod blue-grey
};

// World flavor tint multiplier (blend toward this color by 30%)
const WORLD_FLAVOR_COLOR: Record<string, number> = {
  fantasy:   0x86efac,  // verdant
  cyber:     0x22d3ee,  // neon cyan
  superhero: 0xfb7185,  // saturated rose
  crime:     0x94a3b8,  // gritty grey
  concordia: 0xfacc15,  // hub gold
};

/** Pick a body colour blending topology default with world tint. */
function pickBodyColor(blueprint: CreatureBlueprint): number {
  const base = TOPOLOGY_COLOR[blueprint.topology] ?? 0x9ca3af;
  const flavor = (blueprint.worldId && WORLD_FLAVOR_COLOR[blueprint.worldId]) || null;
  if (!flavor) return base;
  // Mix 70% base + 30% flavor.
  const br = (base >> 16) & 0xff, bg = (base >> 8) & 0xff, bb = base & 0xff;
  const fr = (flavor >> 16) & 0xff, fg = (flavor >> 8) & 0xff, fb = flavor & 0xff;
  const r = Math.round(br * 0.7 + fr * 0.3);
  const g = Math.round(bg * 0.7 + fg * 0.3);
  const b = Math.round(bb * 0.7 + fb * 0.3);
  return (r << 16) | (g << 8) | b;
}

/** Build a procedural mesh group for one blueprint. */
export function buildCreatureMesh(blueprint: CreatureBlueprint): THREE.Group {
  const g = new THREE.Group();
  g.name = `hybrid:${blueprint.id}`;

  const color = pickBodyColor(blueprint);
  const bodyMat = new THREE.MeshLambertMaterial({ color });
  const accentMat = new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.85 });

  // Size scales by sqrt(mass) — bounded so tiny / huge stay visible.
  const sizeScale = Math.min(2.5, Math.max(0.5, Math.cbrt(blueprint.massKg / 30)));
  const torsoLen = 1.2 * sizeScale;
  const torsoR   = 0.45 * sizeScale;
  const legLen   = 0.7 * sizeScale;
  const legR     = 0.09 * sizeScale;

  // ── Torso (capsule, approximated as cylinder + two spheres) ──────
  const torso = new THREE.Mesh(
    new THREE.CapsuleGeometry(torsoR, torsoLen, 4, 8),
    bodyMat,
  );
  torso.position.y = legLen + torsoR;
  torso.rotation.z = Math.PI / 2;
  g.add(torso);

  // ── Head (sphere, forward of torso) ──────────────────────────────
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(torsoR * 0.85, 12, 10),
    bodyMat,
  );
  head.position.set(torsoLen / 2 + torsoR * 0.6, legLen + torsoR + torsoR * 0.2, 0);
  g.add(head);

  // ── Legs by topology ─────────────────────────────────────────────
  const legCount =
    blueprint.topology === 'humanoid'      ? 2
    : blueprint.topology === 'winged_biped' ? 2
    : blueprint.topology === 'polyped'      ? 6
    : blueprint.topology === 'serpentine'   ? 0
    : blueprint.topology === 'amorphous'    ? 0
    : 4;
  for (let i = 0; i < legCount; i++) {
    const leg = new THREE.Mesh(
      new THREE.CylinderGeometry(legR, legR, legLen, 6),
      bodyMat,
    );
    // Two rows along the torso length, alternating left/right.
    const rowFrac = legCount > 2 ? (i < legCount / 2 ? -1 : 1) : 0;
    const idxInRow = i % Math.max(1, legCount / 2);
    const offX = (rowFrac * torsoLen) / 2.4;
    const offZ = (idxInRow - (legCount / 2 - 1) / 2) * (torsoR * 1.3);
    leg.position.set(offX, legLen / 2, offZ);
    g.add(leg);
  }

  // ── Wings if topology says so ────────────────────────────────────
  if (blueprint.topology.startsWith('winged_')) {
    const wingSpan = sizeScale * 2.2;
    const wingChord = sizeScale * 0.8;
    const wingGeo = new THREE.PlaneGeometry(wingSpan, wingChord, 1, 1);
    for (const side of [-1, 1]) {
      const wing = new THREE.Mesh(wingGeo, accentMat);
      wing.position.set(0, legLen + torsoR + 0.05, side * (wingSpan / 2 + torsoR));
      wing.rotation.set(Math.PI / 2, 0, 0);
      wing.userData.isWing = side;
      g.add(wing);
    }
  }

  // ── Tail if quadruped / serpentine ───────────────────────────────
  if (blueprint.topology === 'quadruped' || blueprint.topology === 'winged_quadruped'
      || blueprint.topology === 'serpentine') {
    const tailLen = blueprint.topology === 'serpentine' ? sizeScale * 3 : sizeScale * 1.4;
    const tail = new THREE.Mesh(
      new THREE.CylinderGeometry(torsoR * 0.35, torsoR * 0.1, tailLen, 6),
      bodyMat,
    );
    tail.position.set(-torsoLen / 2 - tailLen / 2, legLen + torsoR * 0.9, 0);
    tail.rotation.z = Math.PI / 2;
    g.add(tail);
  }

  // ── Amorphous shimmer (semi-translucent sphere only) ─────────────
  if (blueprint.topology === 'amorphous') {
    const blob = new THREE.Mesh(
      new THREE.SphereGeometry(torsoR * 1.5, 16, 12),
      new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.7 }),
    );
    blob.position.y = torsoR;
    g.clear();
    g.add(blob);
  }

  return g;
}

interface AttachOptions {
  worldId?: string;
}

/** Cleanup fn type. */
type Cleanup = () => void;

interface ActiveHybrid {
  id: string;
  group: THREE.Group;
  spawnedAt: number;
  wingPhase: number;
}

/**
 * Attach the hybrid-creature renderer to a Three.js scene. Returns a
 * cleanup function that removes every attached mesh and unsubscribes
 * from the socket.
 */
export function attachHybridCreatures(scene: SceneLike, opts: AttachOptions = {}): Cleanup {
  const worldId = opts.worldId || 'concordia-hub';
  const active = new Map<string, ActiveHybrid>();
  let animFrame: number | null = null;
  let disposed = false;

  function add(row: HybridRow | SpawnedPayload) {
    if (disposed) return;
    if (!row.blueprint) return;
    const id = ('hybridId' in row) ? row.hybridId : row.id;
    if (active.has(id)) return;
    try {
      const mesh = buildCreatureMesh({ ...row.blueprint, id });
      mesh.position.set(row.position.x, row.position.y, row.position.z);
      scene.add(mesh);
      active.set(id, { id, group: mesh, spawnedAt: performance.now(), wingPhase: Math.random() * Math.PI * 2 });
      // Wave 2 / T1.2 — log a bestiary sighting on first render. The
      // backend debounces re-sightings of the same hybrid within 60s
      // so this is safe to call on every mesh-add.
      try {
        fetch('/api/lens/run', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            domain: 'bestiary',
            name: 'sight',
            input: {
              worldId,
              kind: 'hybrid',
              speciesRef: id,
              meta: { topology: row.blueprint.topology, mass: row.blueprint.massKg },
            },
          }),
        }).catch(() => { /* sighting is best-effort */ });
      } catch { /* never block renderer */ }
    } catch (_err) { /* renderer never crashes the scene */ }
  }

  // ── 1. Hydrate from REST ─────────────────────────────────────────
  fetch(`/api/worlds/${encodeURIComponent(worldId)}/hybrids`, { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      if (disposed || !j?.ok || !Array.isArray(j.hybrids)) return;
      for (const h of j.hybrids as HybridRow[]) add(h);
    })
    .catch(() => { /* best-effort */ });

  // ── 2. Subscribe to live spawns ─────────────────────────────────
  const unsub = subscribe<SpawnedPayload>('world:hybrid-spawned', (payload) => {
    if (!payload || payload.worldId !== worldId) return;
    add(payload);
  });

  // ── 3. Idle animation loop ──────────────────────────────────────
  const tick = () => {
    if (disposed) return;
    const now = performance.now();
    for (const [, h] of active) {
      const t = (now - h.spawnedAt) / 1000;
      // Subtle vertical bob
      h.group.position.y = (h.group.userData.baseY ?? 0) + Math.sin(t * 1.3 + h.wingPhase) * 0.08;
      // Wing flap (if any wing children)
      h.group.traverse((c) => {
        const w = (c as THREE.Object3D & { userData?: { isWing?: number } }).userData?.isWing;
        if (typeof w === 'number') {
          (c as THREE.Mesh).rotation.x = Math.PI / 2 + Math.sin(t * 4 + h.wingPhase) * 0.3 * w;
        }
      });
    }
    animFrame = requestAnimationFrame(tick);
  };
  animFrame = requestAnimationFrame(tick);

  // ── 4. Cleanup ──────────────────────────────────────────────────
  return () => {
    disposed = true;
    if (animFrame != null) cancelAnimationFrame(animFrame);
    try { unsub(); } catch { /* ok */ }
    for (const [, h] of active) {
      try { scene.remove(h.group); } catch { /* ok */ }
      h.group.traverse((c) => {
        const m = c as THREE.Mesh;
        if (m.geometry?.dispose) try { m.geometry.dispose(); } catch { /* ok */ }
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((mm) => { try { mm.dispose(); } catch { /* ok */ } });
        else if (mat?.dispose) try { mat.dispose(); } catch { /* ok */ }
      });
    }
    active.clear();
  };
}
