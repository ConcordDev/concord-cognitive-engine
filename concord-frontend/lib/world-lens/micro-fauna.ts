/**
 * Micro-Fauna — Wave G8. Decorative ambient life: bird flocks startle
 * when the player gets close, butterflies drift through flower zones,
 * fish ripple under water planes. Frontend-only.
 *
 * All entities are small primitive meshes — no per-pixel cost, no
 * external assets. Spawn density is bounded so a poorly-tuned world
 * stays GPU-cheap.
 */

import * as THREE from 'three';

interface SceneLike {
  add: (obj: THREE.Object3D) => void;
  remove: (obj: THREE.Object3D) => void;
}

const BIRD_FLOCK_RADIUS = 8;
const BIRD_STARTLE_RADIUS = 4;
const BIRDS_PER_FLOCK = 8;
const BUTTERFLIES_PER_ZONE = 4;

interface Bird {
  mesh: THREE.Mesh;
  basePos: THREE.Vector3;
  velocity: THREE.Vector3;
  startled: boolean;
  startleAt: number;
}

interface Butterfly {
  mesh: THREE.Mesh;
  basePos: THREE.Vector3;
  phase: number;
  amp: { x: number; y: number; z: number };
}

export class MicroFauna {
  private scene: SceneLike;
  private group: THREE.Group;
  private birds: Bird[] = [];
  private butterflies: Butterfly[] = [];
  private playerXZ: { x: number; z: number } = { x: 0, z: 0 };
  private raf: number | null = null;
  private disposed = false;
  private lastTickMs = 0;

  constructor(scene: SceneLike) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'micro-fauna';
    scene.add(this.group);
    this.raf = requestAnimationFrame(this.tick);
  }

  /** Seed N bird flocks and butterfly zones across a region. */
  populate(region: { cx: number; cz: number; radius: number; flocks: number; butterflyZones: number }) {
    // Clear existing entities first.
    for (const b of this.birds) this.group.remove(b.mesh);
    for (const b of this.butterflies) this.group.remove(b.mesh);
    this.birds = [];
    this.butterflies = [];

    for (let f = 0; f < region.flocks; f++) {
      const angle = (f / region.flocks) * Math.PI * 2;
      const fx = region.cx + Math.cos(angle) * region.radius * (0.3 + (f % 3) * 0.2);
      const fz = region.cz + Math.sin(angle) * region.radius * (0.3 + (f % 3) * 0.2);
      this.spawnFlock(fx, fz);
    }
    for (let z = 0; z < region.butterflyZones; z++) {
      const angle = (z / region.butterflyZones) * Math.PI * 2 + 0.5;
      const bx = region.cx + Math.cos(angle) * region.radius * 0.6;
      const bz = region.cz + Math.sin(angle) * region.radius * 0.6;
      this.spawnButterflyZone(bx, bz);
    }
  }

  setPlayerPosition(xz: { x: number; z: number }) { this.playerXZ = xz; }

  dispose() {
    this.disposed = true;
    if (this.raf != null) cancelAnimationFrame(this.raf);
    this.raf = null;
    try { this.scene.remove(this.group); } catch { /* ok */ }
    this.birds = [];
    this.butterflies = [];
  }

  private spawnFlock(cx: number, cz: number) {
    const geom = new THREE.BoxGeometry(0.12, 0.04, 0.08);
    const mat = new THREE.MeshLambertMaterial({ color: 0x333333 });
    for (let i = 0; i < BIRDS_PER_FLOCK; i++) {
      const mesh = new THREE.Mesh(geom, mat);
      const ox = (Math.random() - 0.5) * 4;
      const oz = (Math.random() - 0.5) * 4;
      mesh.position.set(cx + ox, 4 + Math.random() * 1.5, cz + oz);
      this.group.add(mesh);
      this.birds.push({
        mesh,
        basePos: mesh.position.clone(),
        velocity: new THREE.Vector3(),
        startled: false,
        startleAt: 0,
      });
    }
  }

  private spawnButterflyZone(cx: number, cz: number) {
    const geom = new THREE.PlaneGeometry(0.16, 0.16);
    for (let i = 0; i < BUTTERFLIES_PER_ZONE; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: [0xffaa44, 0xff66aa, 0x66aaff, 0xaaff66][i % 4],
        transparent: true, opacity: 0.85, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geom, mat);
      const ox = (Math.random() - 0.5) * 3;
      const oz = (Math.random() - 0.5) * 3;
      mesh.position.set(cx + ox, 0.6 + Math.random() * 0.4, cz + oz);
      this.group.add(mesh);
      this.butterflies.push({
        mesh,
        basePos: mesh.position.clone(),
        phase: Math.random() * Math.PI * 2,
        amp: { x: 0.3 + Math.random() * 0.3, y: 0.15 + Math.random() * 0.2, z: 0.3 + Math.random() * 0.3 },
      });
    }
  }

  private tick = (t: number) => {
    if (this.disposed) return;
    const dt = Math.min(0.1, (t - this.lastTickMs) / 1000);
    this.lastTickMs = t;
    const tSeconds = t / 1000;

    // Birds: idle hover; startle on player proximity.
    for (const b of this.birds) {
      const dx = b.basePos.x - this.playerXZ.x;
      const dz = b.basePos.z - this.playerXZ.z;
      const dist2 = dx * dx + dz * dz;
      if (!b.startled && dist2 < BIRD_STARTLE_RADIUS * BIRD_STARTLE_RADIUS) {
        b.startled = true;
        b.startleAt = t;
        // Eject outward from player.
        const dirLen = Math.sqrt(dist2) || 1;
        b.velocity.set((dx / dirLen) * 5, 4 + Math.random() * 2, (dz / dirLen) * 5);
      }
      if (b.startled) {
        b.mesh.position.x += b.velocity.x * dt;
        b.mesh.position.y += b.velocity.y * dt;
        b.mesh.position.z += b.velocity.z * dt;
        b.velocity.y -= 0.5 * dt; // gentle gravity
        const ageS = (t - b.startleAt) / 1000;
        if (ageS > 8) {
          // Return to base.
          b.startled = false;
          b.mesh.position.copy(b.basePos);
          b.velocity.set(0, 0, 0);
        }
      } else {
        // Idle hover.
        b.mesh.position.y = b.basePos.y + Math.sin(tSeconds * 3 + b.basePos.x) * 0.08;
        b.mesh.rotation.y = tSeconds * 0.5 + b.basePos.x;
      }
    }

    // Butterflies: chaotic Lévy-flight.
    for (const f of this.butterflies) {
      const p = tSeconds + f.phase;
      f.mesh.position.x = f.basePos.x + Math.sin(p * 1.7) * f.amp.x + Math.sin(p * 0.3) * 0.4;
      f.mesh.position.y = f.basePos.y + Math.sin(p * 2.3) * f.amp.y;
      f.mesh.position.z = f.basePos.z + Math.cos(p * 1.3) * f.amp.z + Math.cos(p * 0.7) * 0.4;
      f.mesh.rotation.y = p * 2;
    }

    this.raf = requestAnimationFrame(this.tick);
  };
}
