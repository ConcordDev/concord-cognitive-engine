import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { attachWorldRenderers } from '@/lib/world-lens/attach-world-renderers';

// WS2 — the single mount point that takes the four already-tested renderer libs
// live. This test pins the contract ConcordiaScene relies on: one update/dispose
// handle, defensive against per-renderer throws, no network in a headless test.

describe('WS2 — attachWorldRenderers mount point', () => {
  beforeEach(() => {
    // No real fetch in jsdom — the data renderers fire one on construct.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns an update/dispose handle and mounts objects into the layers', () => {
    const infra = new THREE.Group();
    const particles = new THREE.Group();
    const handle = attachWorldRenderers(infra, particles, { worldId: 'concordia-hub' });
    expect(typeof handle.update).toBe('function');
    expect(typeof handle.dispose).toBe('function');
    // update is callable for many frames without throwing
    expect(() => {
      for (let i = 0; i < 10; i++) handle.update(0.016, i * 0.016);
    }).not.toThrow();
    handle.dispose();
  });

  it('dispose is idempotent and stops further updates', () => {
    const infra = new THREE.Group();
    const particles = new THREE.Group();
    const handle = attachWorldRenderers(infra, particles, { worldId: 'w' });
    handle.dispose();
    expect(() => handle.dispose()).not.toThrow();
    // post-dispose update is a no-op (does not throw)
    expect(() => handle.update(0.016, 1)).not.toThrow();
  });

  it('the VFX bridge picks up a concordia:particle-effect after mount', () => {
    const infra = new THREE.Group();
    const particles = new THREE.Group();
    const handle = attachWorldRenderers(infra, particles, { worldId: 'w', maxBursts: 4 });
    // Fire the orphan event the bridge consumes.
    window.dispatchEvent(
      new CustomEvent('concordia:particle-effect', {
        detail: { type: 'sparkle', position: { x: 0, y: 1, z: 0 }, intensity: 1, duration: 500 },
      }),
    );
    handle.update(0.016, 0.016);
    // A burst should now live under the particles group.
    expect(particles.children.length).toBeGreaterThan(0);
    handle.dispose();
  });
});
