/**
 * WeaponTrail — ribbon strip following a weapon bone through space.
 *
 * The trail samples the weapon tip position into a rolling history buffer.
 * Each frame, the buffer becomes the spine of a 2-vertex-per-segment ribbon
 * with width tapering from tip-end (latest) to tail-end (oldest). Opacity
 * fades with age; total length is bounded.
 *
 * Designed for swing arcs: spawn → swing → fade. Call setActive(true) on
 * swing-start, setActive(false) on swing-end. Inactive trails fade smoothly
 * rather than vanishing.
 */

import type * as THREE_NS from 'three';

export interface WeaponTrailOptions {
  /** Max number of history samples. Longer = more flowing. Default 18. */
  historyLength?: number;
  /** World-space width of the trail at the head. Default 0.18. */
  headWidth?: number;
  /** Tail width as fraction of head width. Default 0.05. */
  tailWidthFrac?: number;
  /** Trail color (linear). Default neon-cyan. */
  color?: number;
  /** Seconds to fade out after setActive(false). Default 0.35. */
  fadeOutSec?: number;
  /** Minimum samples before geometry renders. Default 4. */
  minSamples?: number;
}

export interface WeaponTrailAPI {
  readonly mesh: THREE_NS.Mesh;
  setActive(active: boolean): void;
  sample(position: { x: number; y: number; z: number }, nowSec: number): void;
  tick(nowSec: number): void;
  dispose(): void;
  isActive(): boolean;
}

interface SamplePoint {
  x: number;
  y: number;
  z: number;
  t: number;
}

/**
 * Create a weapon-trail ribbon. The caller must call sample() each frame
 * (typically post-animation, with the weapon-tip world position) and tick()
 * to update visible geometry + opacity.
 */
export function createWeaponTrail(
  THREE: typeof THREE_NS,
  scene: THREE_NS.Object3D,
  opts: WeaponTrailOptions = {},
): WeaponTrailAPI {
  const historyLength = opts.historyLength ?? 18;
  const headWidth     = opts.headWidth     ?? 0.18;
  const tailWidthFrac = opts.tailWidthFrac ?? 0.05;
  const color         = opts.color         ?? 0xb8f0ff;
  const fadeOutSec    = opts.fadeOutSec    ?? 0.35;
  const minSamples    = opts.minSamples    ?? 4;

  // Reserve enough vertices for max ribbon: historyLength × 2 sides.
  const verts = new Float32Array(historyLength * 2 * 3);
  const uvs   = new Float32Array(historyLength * 2 * 2);
  const indices: number[] = [];
  for (let i = 0; i < historyLength - 1; i++) {
    const a = i * 2;
    const b = i * 2 + 1;
    const c = (i + 1) * 2;
    const d = (i + 1) * 2 + 1;
    indices.push(a, c, b);
    indices.push(b, c, d);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geom.setIndex(indices);

  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.0,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  scene.add(mesh);

  const samples: SamplePoint[] = [];
  let active = false;
  let lastActiveAt = -Infinity;

  const _tmpForward = new THREE.Vector3();
  const _tmpRight   = new THREE.Vector3();
  const _tmpUp      = new THREE.Vector3(0, 1, 0);

  function rebuildGeometry() {
    const n = Math.min(samples.length, historyLength);
    if (n < minSamples) {
      mat.opacity = 0;
      return;
    }
    for (let i = 0; i < n; i++) {
      const s     = samples[samples.length - 1 - i]; // newest first
      const sNext = samples[Math.max(0, samples.length - 1 - i - 1)];
      _tmpForward.set(sNext.x - s.x, sNext.y - s.y, sNext.z - s.z);
      if (_tmpForward.lengthSq() < 1e-8) _tmpForward.set(1, 0, 0);
      _tmpForward.normalize();
      _tmpRight.crossVectors(_tmpForward, _tmpUp).normalize();
      if (_tmpRight.lengthSq() < 1e-8) _tmpRight.set(1, 0, 0);

      const ageFrac = i / Math.max(1, n - 1);
      const w = headWidth * (1 - ageFrac * (1 - tailWidthFrac));

      const aIdx = i * 2 * 3;
      const bIdx = aIdx + 3;
      verts[aIdx + 0] = s.x + _tmpRight.x * w;
      verts[aIdx + 1] = s.y + _tmpRight.y * w;
      verts[aIdx + 2] = s.z + _tmpRight.z * w;
      verts[bIdx + 0] = s.x - _tmpRight.x * w;
      verts[bIdx + 1] = s.y - _tmpRight.y * w;
      verts[bIdx + 2] = s.z - _tmpRight.z * w;

      const uvAIdx = i * 2 * 2;
      const uvBIdx = uvAIdx + 2;
      uvs[uvAIdx + 0] = ageFrac; uvs[uvAIdx + 1] = 0;
      uvs[uvBIdx + 0] = ageFrac; uvs[uvBIdx + 1] = 1;
    }
    for (let i = n; i < historyLength; i++) {
      const aIdx = i * 2 * 3;
      verts[aIdx]     = verts[aIdx + 1] = verts[aIdx + 2]     = 0;
      verts[aIdx + 3] = verts[aIdx + 4] = verts[aIdx + 5]     = 0;
    }
    (geom.attributes.position as THREE_NS.BufferAttribute).needsUpdate = true;
    (geom.attributes.uv as THREE_NS.BufferAttribute).needsUpdate = true;
  }

  return {
    mesh,
    isActive: () => active,

    setActive(next: boolean) {
      active = next;
      if (next) {
        lastActiveAt = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
      }
    },

    sample(position, nowSec) {
      if (!active) return;
      samples.push({ x: position.x, y: position.y, z: position.z, t: nowSec });
      if (samples.length > historyLength) samples.shift();
      lastActiveAt = nowSec;
    },

    tick(nowSec) {
      rebuildGeometry();
      if (active) {
        mat.opacity = Math.min(0.95, mat.opacity + 0.20);
        return;
      }
      if (!isFinite(lastActiveAt)) {
        mat.opacity = 0;
        return;
      }
      const age = nowSec - lastActiveAt;
      const fade = Math.max(0, 1 - age / fadeOutSec);
      mat.opacity = mat.opacity * 0.85 + fade * 0.15;
      if (fade <= 0) {
        samples.length = 0;
        mat.opacity = 0;
      }
    },

    dispose() {
      try { scene.remove(mesh); } catch { /* idempotent */ }
      try { geom.dispose(); } catch { /* idempotent */ }
      try { mat.dispose(); } catch { /* idempotent */ }
      samples.length = 0;
    },
  };
}
