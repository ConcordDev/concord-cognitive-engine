/**
 * ProjectileTracer — instant hit-scan streak between a muzzle point and an
 * impact point, fading out over a short window.
 *
 * The server resolves ranged combat as an instant distance check
 * (cityPresence.applyAttack), not a physically-simulated travel-time
 * projectile — there is no "bullet in flight" on the server. A tracer that
 * visibly crawled from muzzle to target over hundreds of milliseconds would
 * misrepresent that mechanic (the hit is already resolved before the visual
 * would arrive). So this draws the line instantly at full length and fades
 * it, matching how hit-scan weapons read in most action games, instead of
 * animating a moving projectile mesh.
 *
 * Pooled: a fixed number of line segments are pre-allocated and cycled
 * round-robin so rapid fire never allocates new geometry.
 */

import type * as THREE_NS from 'three';

export interface ProjectileTracerOptions {
  /** Max concurrent tracer streaks. Default 8 (plenty for realistic fire rate). */
  poolSize?: number;
  /** Seconds the streak takes to fade from full opacity to invisible. Default 0.14. */
  fadeSec?: number;
  /** Tracer color (linear). Default warm muzzle-flash yellow-white. */
  color?: number;
}

export interface ProjectileTracerAPI {
  /** Draw a new tracer streak from `from` to `to`, world-space. */
  fire(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }): void;
  /** Advance fade timers. Call once per frame. */
  tick(nowSec: number): void;
  dispose(): void;
}

interface Slot {
  line: THREE_NS.Line;
  geom: THREE_NS.BufferGeometry;
  mat: THREE_NS.LineBasicMaterial;
  firedAt: number;
  active: boolean;
}

export function createProjectileTracerSystem(
  THREE: typeof THREE_NS,
  scene: THREE_NS.Object3D,
  opts: ProjectileTracerOptions = {},
): ProjectileTracerAPI {
  const poolSize = opts.poolSize ?? 8;
  const fadeSec  = opts.fadeSec  ?? 0.14;
  const color    = opts.color    ?? 0xfff4c2;

  const slots: Slot[] = [];
  for (let i = 0; i < poolSize; i++) {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const mat = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const line = new THREE.Line(geom, mat);
    line.frustumCulled = false;
    line.renderOrder = 7;
    line.visible = false;
    scene.add(line);
    slots.push({ line, geom, mat, firedAt: -Infinity, active: false });
  }
  let cursor = 0;

  return {
    fire(from, to) {
      const slot = slots[cursor];
      cursor = (cursor + 1) % poolSize;
      const pos = slot.geom.attributes.position as THREE_NS.BufferAttribute;
      pos.setXYZ(0, from.x, from.y, from.z);
      pos.setXYZ(1, to.x, to.y, to.z);
      pos.needsUpdate = true;
      slot.geom.computeBoundingSphere();
      slot.firedAt = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
      slot.active = true;
      slot.line.visible = true;
      slot.mat.opacity = 0.9;
    },

    tick(nowSec) {
      for (const slot of slots) {
        if (!slot.active) continue;
        const age = nowSec - slot.firedAt;
        if (age >= fadeSec) {
          slot.active = false;
          slot.line.visible = false;
          slot.mat.opacity = 0;
          continue;
        }
        slot.mat.opacity = 0.9 * (1 - age / fadeSec);
      }
    },

    dispose() {
      for (const slot of slots) {
        try { scene.remove(slot.line); } catch { /* idempotent */ }
        try { slot.geom.dispose(); } catch { /* idempotent */ }
        try { slot.mat.dispose(); } catch { /* idempotent */ }
      }
      slots.length = 0;
    },
  };
}
