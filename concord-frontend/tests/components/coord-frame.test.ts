// World ↔ scene coordinate transform — the single source of truth that aligns
// server-seeded content (buildings, nodes) with the origin-centred scene.

import { describe, it, expect } from 'vitest';
import {
  WORLD_TO_SCENE_OFFSET, worldToSceneAxis, sceneToWorldAxis, worldToScene, sceneToWorld,
} from '@/lib/world-lens/coord-frame';

describe('coord-frame', () => {
  it('shifts the seed city (800,1000) onto the origin-centred plateau (-200,0)', () => {
    expect(worldToSceneAxis(800)).toBe(-200);
    expect(worldToSceneAxis(1000)).toBe(0);
    expect(WORLD_TO_SCENE_OFFSET).toBe(1000);
  });

  it('round-trips world→scene→world losslessly', () => {
    const world = { x: 50, z: 1950, id: 'n1' };
    const scene = worldToScene(world);
    expect(scene.x).toBe(-950);
    expect(scene.z).toBe(950);
    expect(scene.id).toBe('n1'); // preserves other fields
    const back = sceneToWorld(scene);
    expect(back.x).toBe(50);
    expect(back.z).toBe(1950);
  });

  it('axis helpers are inverses', () => {
    expect(sceneToWorldAxis(worldToSceneAxis(123))).toBe(123);
  });
});
