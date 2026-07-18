// Phase S4 — provenance threading. Pins that a published building/creature
// carries its real DTU id + lineage from the macro result, and that an
// iterated (re-derived, un-republished) building honestly has NO dtuId — the
// signal the overlay uses to say "not yet published" instead of inventing one.
import { describe, it, expect } from 'vitest';
import { detectArtifact } from '@/lib/conkay/artifact-kinds';

const BUILDING_INPUT = {
  archetype: 'tower',
  feature: 'spire',
  name: 'Test Tower',
  position: { x: 0, y: 0, z: 0 },
  dimensions: { width: 6, height: 20, depth: 6 },
};

describe('S4 provenance fields', () => {
  it('a published building carries dtuId + lineage from the result', () => {
    const a = detectArtifact('game-design', 'building-publish', BUILDING_INPUT, {
      ok: true,
      buildingId: 'b1',
      dtuId: 'dtu_tower_9',
      citations: [{ parentId: 'dtu_p1' }, { parentId: 'dtu_p2' }],
    });
    expect(a?.dtuId).toBe('dtu_tower_9');
    expect(a?.lineage).toEqual(['dtu_p1', 'dtu_p2']);
  });

  it('an iterated/re-derived building (no result dtuId) has no dtuId → "not yet published"', () => {
    const a = detectArtifact('game-design', 'building-publish', BUILDING_INPUT, { ok: true, buildingId: 'b1' });
    expect(a?.dtuId).toBeFalsy();
    expect(a?.lineage).toEqual([]);
  });

  it('a published creature carries its blueprint dtuId', () => {
    const a = detectArtifact('creatures', 'creature-publish', {}, {
      ok: true,
      topology: 'quadruped',
      species_id: 'sp_wolf',
      creatureId: 'wc_1',
      dtuId: 'dtu_wolf_3',
      spawned: true,
    });
    expect(a?.dtuId).toBe('dtu_wolf_3');
  });
});
