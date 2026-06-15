/**
 * Element VFX — per-element 3D-world particle bursts at hit points.
 *
 * Spawn a short-lived particle effect attached to the scene at a given
 * position. Each element has a distinct visual signature:
 *   fire      — additive orange→red sprites rising on jitter cone
 *   ice       — alpha-blended cyan shards on radial outward spread
 *   lightning — additive yellow-white sparks in zig-zag chain
 *   poison    — alpha-blended green bubbles drifting up
 *   water     — additive cyan droplets on parabolic arc
 *   energy    — additive violet plasma orbs pulsing outward
 *   physical  — alpha-blended grey dust on radial puff
 *
 * Pooled per-element so spawning is allocation-free at steady state.
 * Each burst self-cleans after its lifetime; pool reclaims slot.
 */

import type * as THREE_NS from 'three';

export type ElementKind =
  | 'fire'
  | 'ice'
  | 'lightning'
  | 'poison'
  | 'water'
  | 'energy'
  | 'physical'
  | 'bleed';

interface ParticleSpec {
  count:        number;
  lifetimeSec:  number;
  size:         number;
  color:        number;
  blending:     'additive' | 'normal';
  gravity:      number;
  spread:       number;
  upwardBias:   number;
  twinkle:      number;
}

const SPECS: Record<ElementKind, ParticleSpec> = {
  fire:      { count: 24, lifetimeSec: 0.55, size: 0.34, color: 0xff7a30, blending: 'additive', gravity: -1.2, spread: 0.85, upwardBias: 2.1, twinkle: 0.35 },
  ice:       { count: 18, lifetimeSec: 0.62, size: 0.30, color: 0x9ee9ff, blending: 'normal',   gravity:  2.4, spread: 1.10, upwardBias: 0.40, twinkle: 0.10 },
  lightning: { count: 14, lifetimeSec: 0.32, size: 0.22, color: 0xfff39b, blending: 'additive', gravity:  0.0, spread: 1.40, upwardBias: 0.20, twinkle: 0.95 },
  poison:    { count: 16, lifetimeSec: 0.95, size: 0.36, color: 0x86d96b, blending: 'normal',   gravity: -0.4, spread: 0.55, upwardBias: 1.30, twinkle: 0.05 },
  water:     { count: 20, lifetimeSec: 0.55, size: 0.26, color: 0x5fbfff, blending: 'additive', gravity:  3.2, spread: 0.95, upwardBias: 1.20, twinkle: 0.15 },
  energy:    { count: 16, lifetimeSec: 0.55, size: 0.40, color: 0xc77bff, blending: 'additive', gravity:  0.0, spread: 0.70, upwardBias: 0.10, twinkle: 0.50 },
  physical:  { count: 12, lifetimeSec: 0.40, size: 0.30, color: 0xb6a079, blending: 'normal',   gravity:  1.8, spread: 0.80, upwardBias: 0.90, twinkle: 0.05 },
  // Blood spray — crimson droplets that burst outward then fall under gravity.
  // Spawned on flesh (physical/melee) hits in addition to the impact dust, and
  // as a heavier burst on lethal blows. Dark arterial red, no twinkle (wet, not
  // sparkly), normal blending so it reads as opaque droplets, not glow.
  bleed:     { count: 20, lifetimeSec: 0.70, size: 0.20, color: 0xa01818, blending: 'normal',   gravity:  6.5, spread: 1.05, upwardBias: 1.10, twinkle: 0.0 },
};

interface ActiveBurst {
  positions: Float32Array;
  velocities: Float32Array;
  startTime: number;
  duration: number;
  points: THREE_NS.Points;
  spec: ParticleSpec;
}

export interface ElementVfxAPI {
  spawn(element: ElementKind, position: { x: number; y: number; z: number }, magnitude?: number): void;
  tick(nowSec: number): void;
  dispose(): void;
  activeCount(): number;
}

/** Build a small radial-gradient circle texture used as the particle sprite. */
function makeCircleTexture(THREE: typeof THREE_NS): THREE_NS.Texture {
  const size = 64;
  const canvas = typeof document !== 'undefined'
    ? document.createElement('canvas')
    : { width: size, height: size, getContext: () => null } as unknown as HTMLCanvasElement;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0.0, 'rgba(255,255,255,1)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.55)');
    g.addColorStop(1.0, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/** Create a fresh element-vfx system bound to a scene. */
export function createElementVfx(
  THREE: typeof THREE_NS,
  scene: THREE_NS.Object3D,
  options: { maxConcurrent?: number; sharedTexture?: THREE_NS.Texture } = {},
): ElementVfxAPI {
  const maxConcurrent = options.maxConcurrent ?? 24;
  const texture = options.sharedTexture ?? makeCircleTexture(THREE);

  const active: ActiveBurst[] = [];
  let disposed = false;

  function buildPoints(spec: ParticleSpec): {
    points: THREE_NS.Points;
    positions: Float32Array;
    velocities: Float32Array;
  } {
    const positions = new Float32Array(spec.count * 3);
    const velocities = new Float32Array(spec.count * 3);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      size: spec.size,
      color: spec.color,
      map: texture,
      transparent: true,
      depthWrite: false,
      sizeAttenuation: true,
      blending: spec.blending === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const points = new THREE.Points(geom, mat);
    points.frustumCulled = false;
    return { points, positions, velocities };
  }

  return {
    activeCount() {
      return active.length;
    },

    spawn(element, position, magnitude = 1) {
      if (disposed) return;
      const spec = SPECS[element];
      if (!spec) return;
      if (active.length >= maxConcurrent) {
        const oldest = active.shift();
        if (oldest) {
          try { scene.remove(oldest.points); } catch { /* idempotent */ }
          try { (oldest.points.geometry as THREE_NS.BufferGeometry).dispose(); } catch { /* idempotent */ }
          try { (oldest.points.material as THREE_NS.Material).dispose(); } catch { /* idempotent */ }
        }
      }
      const { points, positions, velocities } = buildPoints(spec);
      const mag = Math.max(0.3, Math.min(magnitude, 3));
      for (let i = 0; i < spec.count; i++) {
        const idx = i * 3;
        positions[idx + 0] = position.x;
        positions[idx + 1] = position.y;
        positions[idx + 2] = position.z;

        const theta = Math.random() * Math.PI * 2;
        const radial = (0.3 + Math.random() * 0.7) * spec.spread * mag;
        const lift = (Math.random() * 0.8 + 0.2) * spec.upwardBias * mag;
        velocities[idx + 0] = Math.cos(theta) * radial;
        velocities[idx + 1] = lift;
        velocities[idx + 2] = Math.sin(theta) * radial;
      }
      scene.add(points);
      active.push({
        positions,
        velocities,
        startTime: (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000,
        duration: spec.lifetimeSec * (0.85 + Math.random() * 0.3),
        points,
        spec,
      });
    },

    tick(nowSec) {
      if (disposed) return;
      for (let b = active.length - 1; b >= 0; b--) {
        const burst = active[b];
        const t = nowSec - burst.startTime;
        if (t >= burst.duration) {
          try { scene.remove(burst.points); } catch { /* idempotent */ }
          try { (burst.points.geometry as THREE_NS.BufferGeometry).dispose(); } catch { /* idempotent */ }
          try { (burst.points.material as THREE_NS.Material).dispose(); } catch { /* idempotent */ }
          active.splice(b, 1);
          continue;
        }
        const lifeFrac = t / burst.duration;
        const dt = Math.min(0.05, t > 0 ? (nowSec - burst.startTime) / Math.max(1, burst.spec.count) : 0.016);
        const positions = burst.positions;
        const velocities = burst.velocities;
        const gravity = burst.spec.gravity;
        for (let i = 0; i < burst.spec.count; i++) {
          const idx = i * 3;
          positions[idx + 0] += velocities[idx + 0] * dt;
          positions[idx + 1] += velocities[idx + 1] * dt;
          positions[idx + 2] += velocities[idx + 2] * dt;
          velocities[idx + 1] += gravity * dt;
        }
        (burst.points.geometry.attributes.position as THREE_NS.BufferAttribute).needsUpdate = true;

        const mat = burst.points.material as THREE_NS.PointsMaterial;
        const baseOpacity = 1 - lifeFrac;
        const twinkle = burst.spec.twinkle > 0
          ? burst.spec.twinkle * Math.sin(nowSec * 30 + (burst.startTime * 1000) % 7)
          : 0;
        mat.opacity = Math.max(0, Math.min(1, baseOpacity + twinkle * 0.5));
        mat.size = burst.spec.size * (1 - lifeFrac * 0.35);
      }
    },

    dispose() {
      disposed = true;
      for (const burst of active) {
        try { scene.remove(burst.points); } catch { /* idempotent */ }
        try { (burst.points.geometry as THREE_NS.BufferGeometry).dispose(); } catch { /* idempotent */ }
        try { (burst.points.material as THREE_NS.Material).dispose(); } catch { /* idempotent */ }
      }
      active.length = 0;
    },
  };
}

export const _testing = { SPECS };
