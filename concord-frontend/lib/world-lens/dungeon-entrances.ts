/**
 * Dungeon Entrance Markers — Wave F frontend / overworld layer.
 *
 * Subscribes to `world:dungeon-spawned` socket events + hydrates
 * existing active dungeons via GET /api/dungeons?worldId=...
 *
 * Each dungeon gets a themed entrance mesh at its anchor position:
 *   - fantasy:         stone arch with torches
 *   - cyber:           glowing data terminal pillar
 *   - crime:           steel door with chain-link
 *   - superhero:       energy-domed gateway
 *   - sovereign-ruins: cracked obelisk with refusal glyphs
 *   - lattice-crucible: pulsing reactor pylon
 *   - concord-link-frontier: corrugated outpost door
 *   - tunya:           wooden shrine torii
 *   - concordia-hub:   council seal stone
 *
 * Click / proximity opens the DungeonPanel (mounted separately in
 * lenses/world/page.tsx). This module is purely the in-world mesh.
 */

import * as THREE from 'three';
import { subscribe } from '@/lib/realtime/socket';

interface DungeonRow {
  id: string;
  world_id: string;
  template_kind: string;
  name: string;
  anchor_x: number;
  anchor_z: number;
  depth_level: number;
  room_count: number;
  status: string;
}

interface SpawnedPayload {
  worldId: string;
  dungeonId: string;
  name: string;
  templateKind: string;
  roomCount: number;
  depthLevel: number;
  position: { x: number; z: number };
}

interface SceneLike {
  add: (obj: unknown) => void;
  remove: (obj: unknown) => void;
}

interface ActiveEntrance {
  id: string;
  group: THREE.Group;
  templateKind: string;
  spawnedAt: number;
  pulsePhase: number;
}

// Per-template entrance colors + tags. Falls back to a stone arch.
const TEMPLATE_COLORS: Record<string, { primary: number; glow: number; tag: string }> = {
  crypts_of_the_old_order: { primary: 0x4a5568, glow: 0xf59e0b, tag: 'arch' },
  data_vault:              { primary: 0x1f2937, glow: 0x22d3ee, tag: 'pillar' },
  kingpin_compound:        { primary: 0x57534e, glow: 0xef4444, tag: 'door' },
  villain_lair:            { primary: 0x4c1d95, glow: 0xa78bfa, tag: 'dome' },
  buried_throne:           { primary: 0x1c1917, glow: 0xfacc15, tag: 'obelisk' },
  crucible_core:           { primary: 0x1e293b, glow: 0x67e8f9, tag: 'pylon' },
  outpost_complex:         { primary: 0x57534e, glow: 0xfbbf24, tag: 'door' },
  ancestor_grove:          { primary: 0x44403c, glow: 0x86efac, tag: 'torii' },
  council_undercity:       { primary: 0x44403c, glow: 0xfde047, tag: 'seal' },
  generic_ruin:            { primary: 0x57534e, glow: 0xa3a3a3, tag: 'arch' },
};

function buildEntranceMesh(templateKind: string, name: string): THREE.Group {
  const g = new THREE.Group();
  const config = TEMPLATE_COLORS[templateKind] || TEMPLATE_COLORS.generic_ruin;

  const primaryMat = new THREE.MeshLambertMaterial({ color: config.primary });
  const glowMat = new THREE.MeshLambertMaterial({
    color: config.glow,
    emissive: config.glow,
    emissiveIntensity: 0.7,
  });

  // Base plate.
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(2.8, 3.2, 0.4, 16),
    primaryMat,
  );
  base.position.y = 0.2;
  g.add(base);

  // Per-tag silhouette.
  switch (config.tag) {
    case 'arch': {
      const post1 = new THREE.Mesh(new THREE.BoxGeometry(0.6, 4, 0.6), primaryMat);
      post1.position.set(-1.5, 2.4, 0);
      g.add(post1);
      const post2 = new THREE.Mesh(new THREE.BoxGeometry(0.6, 4, 0.6), primaryMat);
      post2.position.set(1.5, 2.4, 0);
      g.add(post2);
      const top = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.6, 0.6), primaryMat);
      top.position.set(0, 4.7, 0);
      g.add(top);
      // Glow within the arch.
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 3.5), glowMat);
      glow.position.set(0, 2.4, 0.05);
      glow.userData.isPulse = 1;
      g.add(glow);
      break;
    }
    case 'pillar':
    case 'pylon': {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.0, 5, 12), primaryMat);
      p.position.y = 2.7;
      g.add(p);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.15, 8, 24), glowMat);
      ring.position.y = 4.8;
      ring.rotation.x = Math.PI / 2;
      ring.userData.isPulse = 1;
      g.add(ring);
      break;
    }
    case 'door': {
      const door = new THREE.Mesh(new THREE.BoxGeometry(3.4, 4.4, 0.4), primaryMat);
      door.position.y = 2.6;
      g.add(door);
      const handle = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), glowMat);
      handle.position.set(0.8, 2.4, 0.3);
      handle.userData.isPulse = 1;
      g.add(handle);
      break;
    }
    case 'dome': {
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(2.5, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshLambertMaterial({
          color: config.glow, emissive: config.glow, emissiveIntensity: 0.4,
          transparent: true, opacity: 0.55,
        }),
      );
      dome.position.y = 0.4;
      dome.userData.isPulse = 1;
      g.add(dome);
      break;
    }
    case 'obelisk':
    case 'seal': {
      const o = new THREE.Mesh(new THREE.BoxGeometry(1.4, 5.2, 1.4), primaryMat);
      o.position.y = 2.8;
      g.add(o);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(1.0, 0.8, 4), glowMat);
      cap.position.y = 5.8;
      cap.userData.isPulse = 1;
      g.add(cap);
      break;
    }
    case 'torii': {
      const post1 = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 4, 8), primaryMat);
      post1.position.set(-1.5, 2.4, 0);
      g.add(post1);
      const post2 = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 4, 8), primaryMat);
      post2.position.set(1.5, 2.4, 0);
      g.add(post2);
      const top = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.4, 0.6), primaryMat);
      top.position.set(0, 4.5, 0);
      top.rotation.z = 0.05;
      g.add(top);
      const lantern = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), glowMat);
      lantern.position.set(0, 4.2, 0);
      lantern.userData.isPulse = 1;
      g.add(lantern);
      break;
    }
  }

  g.userData.dungeonName = name;
  g.userData.templateKind = templateKind;
  return g;
}

type Cleanup = () => void;

export function attachDungeonEntrances(
  scene: SceneLike,
  opts: { worldId?: string } = {},
): Cleanup {
  const worldId = opts.worldId || 'concordia-hub';
  const active = new Map<string, ActiveEntrance>();
  let animFrame: number | null = null;
  let disposed = false;

  function add(row: DungeonRow | SpawnedPayload) {
    if (disposed) return;
    const id = 'id' in row ? row.id : row.dungeonId;
    if (active.has(id)) return;
    const tk = 'template_kind' in row ? row.template_kind : row.templateKind;
    const name = (row as DungeonRow | SpawnedPayload).name;
    const x = 'anchor_x' in row ? row.anchor_x : row.position.x;
    const z = 'anchor_z' in row ? row.anchor_z : row.position.z;
    try {
      const mesh = buildEntranceMesh(tk, name);
      mesh.position.set(x, 0, z);
      mesh.userData.dungeonId = id;
      scene.add(mesh);
      active.set(id, {
        id, group: mesh, templateKind: tk,
        spawnedAt: performance.now(),
        pulsePhase: Math.random() * Math.PI * 2,
      });
    } catch { /* never crash the scene */ }
  }

  // Hydrate existing dungeons.
  fetch(`/api/dungeons?worldId=${encodeURIComponent(worldId)}`, { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      if (disposed || !j?.ok) return;
      for (const d of j.dungeons ?? []) add(d);
    })
    .catch(() => { /* best-effort */ });

  // Subscribe to live spawns.
  const unsub = subscribe<SpawnedPayload>('world:dungeon-spawned', (payload) => {
    if (!payload || payload.worldId !== worldId) return;
    add(payload);
  });

  // Pulse animation — glow elements breathe so the entrance is visible.
  const tick = () => {
    if (disposed) return;
    const now = performance.now();
    for (const [, e] of active) {
      const t = (now - e.spawnedAt) / 1000;
      e.group.traverse((c) => {
        if ((c as THREE.Object3D & { userData?: { isPulse?: number } }).userData?.isPulse) {
          const m = (c as THREE.Mesh).material as THREE.MeshLambertMaterial;
          m.emissiveIntensity = 0.5 + Math.sin(t * 2 + e.pulsePhase) * 0.35;
        }
      });
    }
    animFrame = requestAnimationFrame(tick);
  };
  animFrame = requestAnimationFrame(tick);

  return () => {
    disposed = true;
    if (animFrame != null) cancelAnimationFrame(animFrame);
    try { unsub(); } catch { /* ok */ }
    for (const [, e] of active) {
      try { scene.remove(e.group); } catch { /* ok */ }
      e.group.traverse((c) => {
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
