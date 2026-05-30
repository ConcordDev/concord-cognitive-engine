/**
 * World VFX bridge — the single consumer of the `concordia:particle-effect`
 * window CustomEvent. Every gameplay/combat/crafting system that wants a
 * one-shot particle burst dispatches:
 *
 *   window.dispatchEvent(new CustomEvent('concordia:particle-effect', {
 *     detail: { type: 'impact_wood', position: { x, y, z }, intensity, duration },
 *   }));
 *
 * and this bridge renders it. Bursts are pooled THREE.Points (additive
 * blending) that move by velocity + gravity, fade over their lifetime, and
 * recycle when expired. The pool is capped (default 32); the oldest burst is
 * evicted + fully disposed when the cap is exceeded so nothing leaks.
 *
 * The bridge follows the ConcordiaScene layer contract: it is attached to a
 * parent THREE.Group and is driven by `update(delta, elapsed)` each frame —
 * the caller wires `parentGroup.userData.update = bridge.update`.
 */

import * as THREE from 'three';

export interface ParticleParams {
  /** Hex color of the burst (e.g. 0x8b6e4b for woodchips). */
  color: number;
  /** Particle count in the burst. */
  count: number;
  /** Radial spread factor (initial horizontal velocity magnitude). */
  spread: number;
  /** Base upward/outward speed. */
  speed: number;
  /** Gravity applied per second (negative = falls, positive = rises). */
  gravity: number;
  /** Lifetime in milliseconds. */
  lifetimeMs: number;
  /** Point size in world units. */
  size: number;
}

const DEFAULT_PARAMS: ParticleParams = {
  color: 0xcfcfcf,
  count: 14,
  spread: 1.0,
  speed: 2.0,
  gravity: -4.0,
  lifetimeMs: 600,
  size: 0.16,
};

/**
 * PURE: resolve the visual parameters for a given effect `type`.
 * Unit-testable; no THREE / DOM access. Unknown types fall back to
 * DEFAULT_PARAMS.
 */
export function particleParamsForType(type: string): ParticleParams {
  switch (type) {
    // ── Impacts ────────────────────────────────────────────────────
    case 'impact':
      return { color: 0xffe6a0, count: 18, spread: 2.2, speed: 3.4, gravity: -6.0, lifetimeMs: 420, size: 0.18 };
    case 'impact_wood':
    case 'woodchips':
      return { color: 0x8b6e4b, count: 16, spread: 2.6, speed: 4.2, gravity: -9.0, lifetimeMs: 360, size: 0.12 };
    case 'impact_stone':
    case 'rock_debris':
      return { color: 0x9b9d99, count: 18, spread: 2.4, speed: 4.6, gravity: -11.0, lifetimeMs: 480, size: 0.13 };
    case 'impact_soil':
    case 'dirt':
      return { color: 0x6e5238, count: 16, spread: 2.0, speed: 3.0, gravity: -8.0, lifetimeMs: 500, size: 0.15 };

    // ── Ambient debris ─────────────────────────────────────────────
    case 'dust':
      return { color: 0xb8a988, count: 12, spread: 1.4, speed: 1.4, gravity: -1.2, lifetimeMs: 900, size: 0.2 };
    case 'leaves':
      return { color: 0x6fae54, count: 10, spread: 1.6, speed: 1.0, gravity: -1.0, lifetimeMs: 1600, size: 0.22 };

    // ── Sparkle / sparks / flashes ─────────────────────────────────
    case 'sparkle':
      return { color: 0xfff4b0, count: 20, spread: 1.2, speed: 1.6, gravity: 0.4, lifetimeMs: 800, size: 0.1 };
    case 'sparks':
      return { color: 0xffc04d, count: 22, spread: 3.0, speed: 5.5, gravity: -12.0, lifetimeMs: 350, size: 0.08 };
    case 'flash':
      return { color: 0xffffff, count: 24, spread: 2.0, speed: 6.0, gravity: -2.0, lifetimeMs: 180, size: 0.22 };

    // ── Smoke / steam ──────────────────────────────────────────────
    case 'smoke':
      return { color: 0x5a5a5a, count: 14, spread: 0.8, speed: 1.2, gravity: 1.4, lifetimeMs: 1400, size: 0.3 };
    case 'steam':
      return { color: 0xd6e4ea, count: 14, spread: 0.7, speed: 1.4, gravity: 2.0, lifetimeMs: 1200, size: 0.28 };

    // ── Water ──────────────────────────────────────────────────────
    case 'splash':
      return { color: 0x4f9bdb, count: 20, spread: 2.0, speed: 4.0, gravity: -9.0, lifetimeMs: 520, size: 0.12 };
    case 'water':
    case 'water_pour':
      return { color: 0x3f8fcf, count: 18, spread: 1.0, speed: 2.4, gravity: -7.0, lifetimeMs: 700, size: 0.11 };

    // ── Magic / restoration ────────────────────────────────────────
    case 'heal':
      return { color: 0x7ee07a, count: 18, spread: 1.0, speed: 1.8, gravity: 2.2, lifetimeMs: 1100, size: 0.16 };
    case 'cast':
      return { color: 0x9b7af0, count: 18, spread: 1.4, speed: 2.0, gravity: 0.6, lifetimeMs: 800, size: 0.15 };
    case 'arcane':
      return { color: 0xb469ff, count: 22, spread: 1.6, speed: 2.4, gravity: 0.8, lifetimeMs: 1000, size: 0.17 };
    case 'glitch':
      return { color: 0x39ffd0, count: 20, spread: 2.6, speed: 4.5, gravity: 0.0, lifetimeMs: 420, size: 0.13 };

    // ── Element-motion voices (skill-motion ELEMENT_MOTION) ────────────────
    // Emitted by the move-resolver for created spells/skills. Without these the
    // elemental created moves fell to the generic default puff.
    // (Covered by scripts/verify-move-render-coverage.mjs.)
    case 'flame':
      return { color: 0xff7a30, count: 24, spread: 0.9, speed: 3.0, gravity: -2.0, lifetimeMs: 550, size: 0.34 };
    case 'frost':
      return { color: 0x9ee9ff, count: 18, spread: 1.1, speed: 2.4, gravity: 2.4, lifetimeMs: 620, size: 0.30 };
    case 'spark':
      return { color: 0xfff39b, count: 14, spread: 1.4, speed: 5.5, gravity: 0.0, lifetimeMs: 320, size: 0.22 };
    case 'toxin':
      return { color: 0x86d96b, count: 16, spread: 0.6, speed: 1.6, gravity: -0.4, lifetimeMs: 950, size: 0.36 };
    case 'heart':
      return { color: 0xff8fc7, count: 14, spread: 0.8, speed: 1.4, gravity: 0.6, lifetimeMs: 900, size: 0.22 };

    default:
      return { ...DEFAULT_PARAMS };
  }
}

interface EventDetail {
  type?: string;
  position?: { x?: number; y?: number; z?: number };
  duration?: number;
  intensity?: number;
}

interface LiveBurst {
  points: THREE.Points;
  positions: Float32Array;
  velocities: Float32Array;
  count: number;
  gravity: number;
  ageMs: number;
  lifetimeMs: number;
  baseOpacity: number;
}

export interface WorldVFXBridge {
  update(delta: number, elapsed: number): void;
  dispose(): void;
  /** Test/diagnostic helper — number of live bursts. */
  activeCount(): number;
}

function makeSoftCircle(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0.0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.4)');
    g.addColorStop(1.0, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/**
 * Construct the bridge. Adds a `concordia:particle-effect` window listener
 * (no-op listener wiring when `window` is absent, e.g. SSR/tests). Returns
 * an object whose `update` should be called every frame and whose `dispose`
 * tears everything down.
 */
export function createWorldVFXBridge(
  parentGroup: THREE.Group,
  opts: { maxBursts?: number } = {},
): WorldVFXBridge {
  const maxBursts = Math.max(1, opts.maxBursts ?? 32);
  const live: LiveBurst[] = [];
  const sharedTexture = makeSoftCircle();
  let disposed = false;

  function evictOldest(): void {
    const old = live.shift();
    if (!old) return;
    try { parentGroup.remove(old.points); } catch { /* idempotent */ }
    try { (old.points.geometry as THREE.BufferGeometry).dispose(); } catch { /* idempotent */ }
    try { (old.points.material as THREE.Material).dispose(); } catch { /* idempotent */ }
  }

  function spawn(type: string, position: { x: number; y: number; z: number }, intensity: number, durationMs?: number): void {
    if (disposed) return;
    while (live.length >= maxBursts) evictOldest();

    const params = particleParamsForType(type);
    const mag = Math.max(0.3, Math.min(intensity, 3));
    const count = params.count;
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const idx = i * 3;
      positions[idx] = position.x;
      positions[idx + 1] = position.y;
      positions[idx + 2] = position.z;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.5; // bias upward hemisphere
      const horiz = Math.sin(phi) * params.spread * (0.4 + Math.random() * 0.6) * mag;
      const vert = (Math.cos(phi) * 0.5 + 0.5) * params.speed * (0.5 + Math.random() * 0.6) * mag;
      velocities[idx] = Math.cos(theta) * horiz;
      velocities[idx + 1] = vert;
      velocities[idx + 2] = Math.sin(theta) * horiz;
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const matOpts: THREE.PointsMaterialParameters = {
      size: params.size * mag,
      color: params.color,
      transparent: true,
      depthWrite: false,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
    };
    if (sharedTexture) matOpts.map = sharedTexture;
    const mat = new THREE.PointsMaterial(matOpts);

    const points = new THREE.Points(geom, mat);
    points.frustumCulled = false;
    parentGroup.add(points);

    const lifetimeMs = typeof durationMs === 'number' && durationMs > 0 ? durationMs : params.lifetimeMs;

    live.push({
      points,
      positions,
      velocities,
      count,
      gravity: params.gravity,
      ageMs: 0,
      lifetimeMs,
      baseOpacity: 0.9,
    });
  }

  function onParticleEffect(e: Event): void {
    const detail = (e as CustomEvent).detail as EventDetail | undefined;
    if (!detail || typeof detail.type !== 'string') return;
    const p = detail.position;
    if (!p || typeof p.x !== 'number' || typeof p.y !== 'number' || typeof p.z !== 'number') return;
    const intensity = typeof detail.intensity === 'number' ? detail.intensity : 1;
    const durationMs = typeof detail.duration === 'number' ? detail.duration : undefined;
    spawn(detail.type, { x: p.x, y: p.y, z: p.z }, intensity, durationMs);
  }

  const hasWindow = typeof window !== 'undefined';
  if (hasWindow) {
    window.addEventListener('concordia:particle-effect', onParticleEffect as EventListener);
  }

  return {
    activeCount(): number {
      return live.length;
    },

    update(delta: number): void {
      if (disposed || live.length === 0) return;
      const dt = Math.max(0, Math.min(delta, 0.1)); // clamp to avoid huge steps
      const dtMs = dt * 1000;

      for (let b = live.length - 1; b >= 0; b--) {
        const burst = live[b];
        burst.ageMs += dtMs;
        const t = burst.ageMs / burst.lifetimeMs;

        if (t >= 1) {
          // expired — recycle (dispose + remove)
          try { parentGroup.remove(burst.points); } catch { /* idempotent */ }
          try { (burst.points.geometry as THREE.BufferGeometry).dispose(); } catch { /* idempotent */ }
          try { (burst.points.material as THREE.Material).dispose(); } catch { /* idempotent */ }
          live.splice(b, 1);
          continue;
        }

        const { positions, velocities, count, gravity } = burst;
        for (let i = 0; i < count; i++) {
          const idx = i * 3;
          velocities[idx + 1] += gravity * dt;
          positions[idx] += velocities[idx] * dt;
          positions[idx + 1] += velocities[idx + 1] * dt;
          positions[idx + 2] += velocities[idx + 2] * dt;
        }
        const attr = burst.points.geometry.getAttribute('position') as THREE.BufferAttribute;
        attr.needsUpdate = true;

        const mat = burst.points.material as THREE.PointsMaterial;
        mat.opacity = burst.baseOpacity * (1 - t);
      }
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (hasWindow) {
        window.removeEventListener('concordia:particle-effect', onParticleEffect as EventListener);
      }
      for (const burst of live) {
        try { parentGroup.remove(burst.points); } catch { /* idempotent */ }
        try { (burst.points.geometry as THREE.BufferGeometry).dispose(); } catch { /* idempotent */ }
        try { (burst.points.material as THREE.Material).dispose(); } catch { /* idempotent */ }
      }
      live.length = 0;
      try { sharedTexture?.dispose(); } catch { /* idempotent */ }
    },
  };
}
