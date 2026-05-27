/**
 * BloodDecal — projected splatter quads on physical hits.
 *
 * Spawns a small alpha-textured quad oriented to the receiving surface
 * normal at the hit point. Decals fade over time and FIFO-evict once the
 * pool exceeds capacity so the world never accumulates more than N marks.
 *
 * For surfaces with a real DecalGeometry path, prefer that. This module is
 * a cheap dependency-free fallback that uses a simple oriented PlaneGeometry
 * with a normal-offset to avoid z-fighting. Looks correct on flat-ish
 * surfaces, which is what 95% of combat hits encounter.
 */

import type * as THREE_NS from 'three';

export interface BloodDecalOptions {
  capacity?:     number;
  lifetimeSec?:  number;
  baseSize?:     number;
  color?:        number;
  normalOffset?: number;
  sharedTexture?: THREE_NS.Texture;
}

export interface BloodDecalAPI {
  spawn(position: { x: number; y: number; z: number }, normal: { x: number; y: number; z: number }, magnitude?: number): void;
  tick(nowSec: number): void;
  dispose(): void;
  activeCount(): number;
}

interface ActiveDecal {
  mesh:        THREE_NS.Mesh;
  startTime:   number;
  duration:    number;
  baseOpacity: number;
}

function makeSplatterTexture(THREE: typeof THREE_NS, seed = 0xa1b2): THREE_NS.Texture {
  const size = 128;
  const canvas = typeof document !== 'undefined'
    ? document.createElement('canvas')
    : { width: size, height: size, getContext: () => null } as unknown as HTMLCanvasElement;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, size, size);
    // Main drop
    const cx = size / 2, cy = size / 2;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.42);
    g.addColorStop(0.0, 'rgba(120,10,15,1)');
    g.addColorStop(0.55, 'rgba(160,30,20,0.85)');
    g.addColorStop(1.0, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.42, 0, Math.PI * 2);
    ctx.fill();
    // Satellite spatter — deterministic from seed
    let s = seed | 0;
    const rand = () => {
      s = (s * 1664525 + 1013904223) | 0;
      return ((s >>> 0) / 0xffffffff);
    };
    for (let i = 0; i < 18; i++) {
      const theta = rand() * Math.PI * 2;
      const r = (0.25 + rand() * 0.68) * size * 0.5;
      const dx = cx + Math.cos(theta) * r;
      const dy = cy + Math.sin(theta) * r;
      const dr = (1 + rand() * 5);
      ctx.fillStyle = `rgba(${100 + Math.floor(rand() * 60)}, ${10 + Math.floor(rand() * 20)}, 12, ${0.55 + rand() * 0.35})`;
      ctx.beginPath();
      ctx.arc(dx, dy, dr, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

export function createBloodDecals(
  THREE: typeof THREE_NS,
  scene: THREE_NS.Object3D,
  opts: BloodDecalOptions = {},
): BloodDecalAPI {
  const capacity     = opts.capacity     ?? 32;
  const lifetimeSec  = opts.lifetimeSec  ?? 20;
  const baseSize     = opts.baseSize     ?? 0.55;
  const color        = opts.color        ?? 0xffffff;
  const normalOffset = opts.normalOffset ?? 0.02;
  const texture = opts.sharedTexture ?? makeSplatterTexture(THREE);

  const active: ActiveDecal[] = [];
  let disposed = false;
  const geometry = new THREE.PlaneGeometry(1, 1);

  const _q = new THREE.Quaternion();
  const _from = new THREE.Vector3(0, 0, 1);
  const _to = new THREE.Vector3();

  return {
    activeCount() { return active.length; },

    spawn(position, normal, magnitude = 1) {
      if (disposed) return;
      if (active.length >= capacity) {
        const evicted = active.shift();
        if (evicted) {
          try { scene.remove(evicted.mesh); } catch { /* idempotent */ }
          try { (evicted.mesh.material as THREE_NS.Material).dispose(); } catch { /* idempotent */ }
        }
      }
      const mat = new THREE.MeshBasicMaterial({
        map: texture,
        color,
        transparent: true,
        opacity: 0.0,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -4,
      });
      const mesh = new THREE.Mesh(geometry, mat);
      mesh.frustumCulled = false;
      const mag = Math.max(0.5, Math.min(magnitude, 2.5));
      const scale = baseSize * mag;
      mesh.scale.setScalar(scale);

      _to.set(normal.x, normal.y, normal.z);
      if (_to.lengthSq() < 1e-6) _to.set(0, 1, 0);
      _to.normalize();
      _q.setFromUnitVectors(_from, _to);
      mesh.quaternion.copy(_q);
      // Twist about the decal's own local +Z (which after _q now points
      // along the world-space normal) so the splatter pattern doesn't
      // repeat between hits at the same surface.
      mesh.rotateOnAxis(new THREE.Vector3(0, 0, 1), Math.random() * Math.PI * 2);

      mesh.position.set(
        position.x + _to.x * normalOffset,
        position.y + _to.y * normalOffset,
        position.z + _to.z * normalOffset,
      );

      scene.add(mesh);

      const baseOpacity = 0.85 + Math.random() * 0.10;
      mat.opacity = baseOpacity;
      active.push({
        mesh,
        startTime: (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000,
        duration: lifetimeSec * (0.85 + Math.random() * 0.3),
        baseOpacity,
      });
    },

    tick(nowSec) {
      if (disposed) return;
      for (let i = active.length - 1; i >= 0; i--) {
        const d = active[i];
        const t = nowSec - d.startTime;
        if (t >= d.duration) {
          try { scene.remove(d.mesh); } catch { /* idempotent */ }
          try { (d.mesh.material as THREE_NS.Material).dispose(); } catch { /* idempotent */ }
          active.splice(i, 1);
          continue;
        }
        const lifeFrac = t / d.duration;
        const fadeStart = 0.5;
        const fade = lifeFrac < fadeStart
          ? 1
          : 1 - ((lifeFrac - fadeStart) / (1 - fadeStart));
        (d.mesh.material as THREE_NS.MeshBasicMaterial).opacity = d.baseOpacity * fade;
      }
    },

    dispose() {
      disposed = true;
      for (const d of active) {
        try { scene.remove(d.mesh); } catch { /* idempotent */ }
        try { (d.mesh.material as THREE_NS.Material).dispose(); } catch { /* idempotent */ }
      }
      active.length = 0;
      try { geometry.dispose(); } catch { /* idempotent */ }
    },
  };
}
