// Ground-planting (2026-06-26). Server-spawned entities (NPCs, other players,
// creatures, resource nodes) arrive at Y=0, but the city plateau renders at
// ~40m, so without planting them on the terrain surface they're buried under
// the world. TerrainRenderer publishes window.__concordiaSampleGroundY (the
// exact heightmap sampler); the entity renderers read it via sampleGroundY and
// set Y to it. This pins the sampler contract + the graceful pre-terrain path.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { sampleGroundY } from '@/lib/world-lens/coord-frame';

describe('sampleGroundY — the shared ground sampler', () => {
  afterEach(() => {
    delete (window as unknown as { __concordiaSampleGroundY?: unknown }).__concordiaSampleGroundY;
  });

  it('returns null before the terrain publishes a sampler (caller keeps its Y)', () => {
    expect(sampleGroundY(0, 0)).toBeNull();
  });

  it('returns the published surface height at (x,z)', () => {
    (window as unknown as { __concordiaSampleGroundY: (x: number, z: number) => number })
      .__concordiaSampleGroundY = (x, z) => 40 + x * 0 + z * 0;
    expect(sampleGroundY(-200, 0)).toBe(40);
  });

  it('passes the scene coords straight through to the sampler', () => {
    const spy = vi.fn((x: number, z: number) => x + z);
    (window as unknown as { __concordiaSampleGroundY: typeof spy }).__concordiaSampleGroundY = spy;
    expect(sampleGroundY(-150, 25)).toBe(-125);
    expect(spy).toHaveBeenCalledWith(-150, 25);
  });

  it('never throws if the sampler itself throws — degrades to null', () => {
    (window as unknown as { __concordiaSampleGroundY: () => number }).__concordiaSampleGroundY = () => {
      throw new Error('terrain mid-rebuild');
    };
    expect(sampleGroundY(0, 0)).toBeNull();
  });
});
