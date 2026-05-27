/**
 * Footstep dust — small puff particle on each foot-plant.
 *
 * Spawns 5–8 short-lived sprites at a foot position, drifting up
 * slightly + radial spread. Color tinted by terrain material (yellow
 * sand puff, grey stone, dark mud, white snow).
 *
 * Lightweight system; can be triggered hundreds of times in combat
 * sequences without GC pressure thanks to scene-Object pooling on the
 * outer driver layer. This module just builds the geometry per puff.
 */

import type * as THREE_NS from 'three';
import type { TerrainMaterial } from './footstep-audio';

const DUST_COLORS: Record<TerrainMaterial, number> = {
  grass: 0xa1c282,
  sand:  0xd9b771,
  stone: 0x9b9d99,
  wood:  0x8b6e4b,
  snow:  0xeef2f7,
  tile:  0xb0b0b8,
  mud:   0x5b4030,
  dirt:  0x8a6c4c,
  metal: 0xb3b9c0,
};

export interface FootDustAPI {
  spawn(position: { x: number; y: number; z: number }, material: TerrainMaterial, intensity?: number): void;
  tick(nowSec: number): void;
  dispose(): void;
  activeCount(): number;
}

interface ActivePuff {
  positions:  Float32Array;
  velocities: Float32Array;
  startTime:  number;
  duration:   number;
  count:      number;
  points:     THREE_NS.Points;
}

function makeSoftCircle(THREE: typeof THREE_NS): THREE_NS.Texture {
  const size = 32;
  const canvas = typeof document !== 'undefined'
    ? document.createElement('canvas')
    : { width: size, height: size, getContext: () => null } as unknown as HTMLCanvasElement;
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0.0, 'rgba(255,255,255,0.85)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.30)');
    g.addColorStop(1.0, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

export function createFootDust(
  THREE: typeof THREE_NS,
  scene: THREE_NS.Object3D,
  opts: { maxConcurrent?: number; sharedTexture?: THREE_NS.Texture } = {},
): FootDustAPI {
  const maxConcurrent = opts.maxConcurrent ?? 24;
  const texture = opts.sharedTexture ?? makeSoftCircle(THREE);
  const active: ActivePuff[] = [];
  let disposed = false;

  return {
    activeCount() { return active.length; },

    spawn(position, material, intensity = 1) {
      if (disposed) return;
      if (active.length >= maxConcurrent) {
        const old = active.shift();
        if (old) {
          try { scene.remove(old.points); } catch { /* idempotent */ }
          try { (old.points.geometry as THREE_NS.BufferGeometry).dispose(); } catch { /* idempotent */ }
          try { (old.points.material as THREE_NS.Material).dispose(); } catch { /* idempotent */ }
        }
      }
      const count = 5 + Math.floor(Math.random() * 4);
      const positions = new Float32Array(count * 3);
      const velocities = new Float32Array(count * 3);
      const mag = Math.max(0.4, Math.min(intensity, 2.5));
      for (let i = 0; i < count; i++) {
        const idx = i * 3;
        positions[idx]     = position.x;
        positions[idx + 1] = position.y + 0.02;
        positions[idx + 2] = position.z;
        const theta = Math.random() * Math.PI * 2;
        const speed = (0.2 + Math.random() * 0.5) * mag;
        velocities[idx]     = Math.cos(theta) * speed;
        velocities[idx + 1] = (0.3 + Math.random() * 0.6) * mag;
        velocities[idx + 2] = Math.sin(theta) * speed;
      }
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const mat = new THREE.PointsMaterial({
        size: 0.18 * mag,
        color: DUST_COLORS[material] ?? DUST_COLORS.dirt,
        map: texture,
        transparent: true,
        depthWrite: false,
        opacity: 0.7,
        blending: THREE.NormalBlending,
      });
      const points = new THREE.Points(geom, mat);
      points.frustumCulled = false;
      scene.add(points);
      active.push({
        positions,
        velocities,
        startTime: (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000,
        duration: 0.55 + Math.random() * 0.2,
        count,
        points,
      });
    },

    tick(nowSec) {
      if (disposed) return;
      for (let b = active.length - 1; b >= 0; b--) {
        const puff = active[b];
        const t = nowSec - puff.startTime;
        if (t >= puff.duration) {
          try { scene.remove(puff.points); } catch { /* idempotent */ }
          try { (puff.points.geometry as THREE_NS.BufferGeometry).dispose(); } catch { /* idempotent */ }
          try { (puff.points.material as THREE_NS.Material).dispose(); } catch { /* idempotent */ }
          active.splice(b, 1);
          continue;
        }
        const lifeFrac = t / puff.duration;
        const dt = 0.016;
        for (let i = 0; i < puff.count; i++) {
          const idx = i * 3;
          puff.positions[idx]     += puff.velocities[idx]     * dt;
          puff.positions[idx + 1] += puff.velocities[idx + 1] * dt;
          puff.positions[idx + 2] += puff.velocities[idx + 2] * dt;
          puff.velocities[idx + 1] -= 0.6 * dt;   // dust settles
          puff.velocities[idx]     *= 0.92;        // air drag
          puff.velocities[idx + 2] *= 0.92;
        }
        (puff.points.geometry.attributes.position as THREE_NS.BufferAttribute).needsUpdate = true;
        const mat = puff.points.material as THREE_NS.PointsMaterial;
        mat.opacity = Math.max(0, 0.7 * (1 - lifeFrac));
        mat.size = mat.size * (1 + 0.02);   // expand slightly
      }
    },

    dispose() {
      disposed = true;
      for (const p of active) {
        try { scene.remove(p.points); } catch { /* idempotent */ }
        try { (p.points.geometry as THREE_NS.BufferGeometry).dispose(); } catch { /* idempotent */ }
        try { (p.points.material as THREE_NS.Material).dispose(); } catch { /* idempotent */ }
      }
      active.length = 0;
    },
  };
}

export const _testing = { DUST_COLORS };
