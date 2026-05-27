/**
 * Cold-breath particles — visible exhale when ambient temperature is low.
 *
 * Periodic, faint white-blue puffs at the head bone. Modulated by
 * temperature (no breath above 5°C, faint at 0–5°C, visible at < 0°C,
 * dense at < -10°C). Also accelerates during combat / sprint for the
 * "heavy breathing" effect.
 */

import type * as THREE_NS from 'three';

export interface ColdBreathAPI {
  /** Update ambient temperature in °C. */
  setTemperature(c: number): void;
  /** Update breathing rate (1 = idle, 2 = combat, etc). */
  setExertion(level: number): void;
  /** Each frame, supply the head world position + look-direction. */
  tick(nowSec: number, headPos: { x: number; y: number; z: number }, lookDir: { x: number; y: number; z: number }): void;
  dispose(): void;
}

interface BreathPuff {
  positions:  Float32Array;
  velocities: Float32Array;
  startTime:  number;
  duration:   number;
  points:     THREE_NS.Points;
}

function makeFogSprite(THREE: typeof THREE_NS): THREE_NS.Texture {
  const size = 32;
  const canvas = typeof document !== 'undefined'
    ? document.createElement('canvas')
    : { width: size, height: size, getContext: () => null } as unknown as HTMLCanvasElement;
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0.0, 'rgba(220,235,250,0.45)');
    g.addColorStop(0.5, 'rgba(220,235,250,0.15)');
    g.addColorStop(1.0, 'rgba(220,235,250,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

export function createColdBreath(
  THREE: typeof THREE_NS,
  scene: THREE_NS.Object3D,
  opts: { maxConcurrent?: number; sharedTexture?: THREE_NS.Texture } = {},
): ColdBreathAPI {
  const maxConcurrent = opts.maxConcurrent ?? 8;
  const texture = opts.sharedTexture ?? makeFogSprite(THREE);
  const active: BreathPuff[] = [];
  let disposed = false;
  let temperatureC = 20;
  let exertion = 1;
  let lastBreathAt = -Infinity;

  function visibilityFactor(tempC: number): number {
    // 0 at >5°C, 1.0 at <-10°C, linear in between
    if (tempC >= 5) return 0;
    if (tempC <= -10) return 1;
    return (5 - tempC) / 15;
  }

  function spawnPuff(headPos: { x: number; y: number; z: number }, lookDir: { x: number; y: number; z: number }, visibility: number, now: number) {
    if (active.length >= maxConcurrent) {
      const old = active.shift();
      if (old) {
        try { scene.remove(old.points); } catch { /* idempotent */ }
        try { (old.points.geometry as THREE_NS.BufferGeometry).dispose(); } catch { /* idempotent */ }
        try { (old.points.material as THREE_NS.Material).dispose(); } catch { /* idempotent */ }
      }
    }
    const count = 8;
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    // Exhale direction = look direction + slight upward
    const dx = lookDir.x; const dy = lookDir.y + 0.15; const dz = lookDir.z;
    const dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const fx = dx / dl, fy = dy / dl, fz = dz / dl;
    for (let i = 0; i < count; i++) {
      const idx = i * 3;
      positions[idx]     = headPos.x;
      positions[idx + 1] = headPos.y;
      positions[idx + 2] = headPos.z;
      const speed = (0.3 + Math.random() * 0.4) * exertion;
      velocities[idx]     = fx * speed + (Math.random() - 0.5) * 0.15;
      velocities[idx + 1] = fy * speed + (Math.random() - 0.5) * 0.10;
      velocities[idx + 2] = fz * speed + (Math.random() - 0.5) * 0.15;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.16,
      color: 0xdfeefc,
      map: texture,
      transparent: true,
      depthWrite: false,
      opacity: 0.35 * visibility,
      blending: THREE.NormalBlending,
    });
    const points = new THREE.Points(geom, mat);
    points.frustumCulled = false;
    scene.add(points);
    active.push({
      positions,
      velocities,
      startTime: now,
      duration: 1.2,
      points,
    });
  }

  return {
    setTemperature(c) { temperatureC = c; },
    setExertion(level) { exertion = Math.max(0.5, level); },

    tick(nowSec, headPos, lookDir) {
      if (disposed) return;
      const visibility = visibilityFactor(temperatureC);

      // Update existing puffs
      for (let i = active.length - 1; i >= 0; i--) {
        const puff = active[i];
        const t = nowSec - puff.startTime;
        if (t >= puff.duration) {
          try { scene.remove(puff.points); } catch { /* idempotent */ }
          try { (puff.points.geometry as THREE_NS.BufferGeometry).dispose(); } catch { /* idempotent */ }
          try { (puff.points.material as THREE_NS.Material).dispose(); } catch { /* idempotent */ }
          active.splice(i, 1);
          continue;
        }
        const lifeFrac = t / puff.duration;
        const dt = 0.016;
        for (let k = 0; k < 8; k++) {
          const idx = k * 3;
          puff.positions[idx]     += puff.velocities[idx]     * dt;
          puff.positions[idx + 1] += puff.velocities[idx + 1] * dt;
          puff.positions[idx + 2] += puff.velocities[idx + 2] * dt;
          puff.velocities[idx]     *= 0.94;
          puff.velocities[idx + 1] *= 0.94;
          puff.velocities[idx + 2] *= 0.94;
        }
        (puff.points.geometry.attributes.position as THREE_NS.BufferAttribute).needsUpdate = true;
        const mat = puff.points.material as THREE_NS.PointsMaterial;
        mat.opacity = (0.35 * (1 - lifeFrac)) * visibility;
        mat.size = mat.size * (1 + 0.01);
      }

      // Spawn a new puff on breath cadence
      if (visibility > 0.05) {
        const breathInterval = Math.max(0.6, 2.2 / Math.max(0.5, exertion));
        if (nowSec - lastBreathAt >= breathInterval) {
          spawnPuff(headPos, lookDir, visibility, nowSec);
          lastBreathAt = nowSec;
        }
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

export const _testing = { visibilityFactorTest: (tempC: number) => {
  if (tempC >= 5) return 0;
  if (tempC <= -10) return 1;
  return (5 - tempC) / 15;
}};
