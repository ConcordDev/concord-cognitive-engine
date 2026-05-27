/**
 * Footprint Trail — Wave G7. Drops small dark decals behind the player
 * as they walk; each fades over ~60s. Frontend-only — no backend.
 *
 * Spawn rule: one decal per ~1.5m walked. Pool size capped at 200; the
 * oldest decal is recycled when the pool fills. Decal color is sampled
 * from a terrain-kind hint (mud=brown, sand=tan, snow=white-blue,
 * grass=transparent skip). We only spawn for non-grass terrain so the
 * world doesn't carpet itself with footprints.
 */

import * as THREE from 'three';

interface SceneLike {
  add: (obj: THREE.Object3D) => void;
  remove: (obj: THREE.Object3D) => void;
}

type TerrainKind = 'mud' | 'sand' | 'snow' | 'stone' | 'wood' | 'grass' | 'tile';

const TERRAIN_COLOR: Record<TerrainKind, number | null> = {
  mud:   0x3a2818,
  sand:  0xc8a878,
  snow:  0xd8dee9,
  stone: 0x707070,
  wood:  0x5a3a1a,
  tile:  null,        // skip
  grass: null,        // skip
};

const FOOTPRINT_FADE_MS = 60_000;
const STRIDE_M = 1.5;
const POOL_SIZE = 200;

interface FootprintEntry {
  mesh: THREE.Mesh;
  spawnedAt: number;
  baseColor: number;
}

export class FootprintTrail {
  private scene: SceneLike;
  private pool: FootprintEntry[] = [];
  private nextIndex = 0;
  private lastSpawnXZ: { x: number; z: number } | null = null;
  private group: THREE.Group;
  private disposed = false;
  private raf: number | null = null;
  private currentTerrain: TerrainKind = 'grass';

  constructor(scene: SceneLike) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'footprint-trail';
    scene.add(this.group);
    this.raf = requestAnimationFrame(this.tick);
  }

  setTerrain(kind: TerrainKind) { this.currentTerrain = kind; }

  /** Called by the world page or AvatarSystem3D each time the player moves. */
  recordPosition(x: number, y: number, z: number) {
    if (this.disposed) return;
    const color = TERRAIN_COLOR[this.currentTerrain];
    if (color == null) return; // grass/tile — no footprint
    if (this.lastSpawnXZ) {
      const dx = x - this.lastSpawnXZ.x;
      const dz = z - this.lastSpawnXZ.z;
      if (dx * dx + dz * dz < STRIDE_M * STRIDE_M) return;
    }
    this.lastSpawnXZ = { x, z };
    this.spawn(x, y, z, color);
  }

  dispose() {
    this.disposed = true;
    if (this.raf != null) cancelAnimationFrame(this.raf);
    this.raf = null;
    try { this.scene.remove(this.group); } catch { /* ok */ }
    for (const f of this.pool) {
      try { f.mesh.geometry?.dispose(); } catch { /* ok */ }
      const mat = f.mesh.material as THREE.Material | undefined;
      try { mat?.dispose(); } catch { /* ok */ }
    }
    this.pool = [];
  }

  private spawn(x: number, y: number, z: number, color: number) {
    const now = performance.now();
    // Reuse pool slot or create new.
    if (this.pool.length < POOL_SIZE) {
      const mesh = this.makeMesh(color);
      mesh.position.set(x, y + 0.01, z);
      this.group.add(mesh);
      this.pool.push({ mesh, spawnedAt: now, baseColor: color });
    } else {
      const slot = this.pool[this.nextIndex];
      slot.mesh.position.set(x, y + 0.01, z);
      slot.spawnedAt = now;
      slot.baseColor = color;
      const mat = slot.mesh.material as THREE.MeshBasicMaterial;
      mat.color.setHex(color);
      mat.opacity = 0.7;
      mat.transparent = true;
      this.nextIndex = (this.nextIndex + 1) % POOL_SIZE;
    }
  }

  private makeMesh(color: number): THREE.Mesh {
    const geom = new THREE.CircleGeometry(0.18, 6);
    geom.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.7, depthWrite: false,
    });
    return new THREE.Mesh(geom, mat);
  }

  private tick = (t: number) => {
    if (this.disposed) return;
    for (const f of this.pool) {
      const age = t - f.spawnedAt;
      if (age >= FOOTPRINT_FADE_MS) {
        const mat = f.mesh.material as THREE.MeshBasicMaterial;
        mat.opacity = 0;
      } else {
        const mat = f.mesh.material as THREE.MeshBasicMaterial;
        mat.opacity = 0.7 * (1 - age / FOOTPRINT_FADE_MS);
      }
    }
    this.raf = requestAnimationFrame(this.tick);
  };
}
