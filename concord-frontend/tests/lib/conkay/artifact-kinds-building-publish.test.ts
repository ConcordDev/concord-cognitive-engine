// concord-frontend/tests/lib/conkay/artifact-kinds-building-publish.test.ts
//
// Unit A1 — pins normalizeBuildingPublish's honesty contract: a successful
// `game-design.building-publish` call (server/domains/gamedesign.js) produces
// a real `building` ConkayArtifact CONSTRUCTED from the call's real INPUT
// (archetype/feature/dimensions/name/position — the exact payload shape
// AssetStudioPanel.tsx sends) + its real RESULT (buildingId as the id) —
// never a placeholder. A non-ok result, a missing buildingId, a missing
// archetype, or non-positive dimensions all return null. A non-building
// macro is unaffected, and the pre-existing shape-driven `building` detector
// (any macro literally returning `buildings[]`) still works unchanged.
//
// New file (not an edit to the existing tests/lib/conkay/artifact-kinds.test.ts)
// per the Unit A1 build contract's touch-file list.

import { describe, it, expect } from 'vitest';
import { detectArtifact, type ConkayBuildingArtifact } from '@/lib/conkay/artifact-kinds';

// The EXACT payload shape AssetStudioPanel.tsx builds for
// `lensRun('game-design', 'building-publish', payload)` (components/game-design/
// AssetStudioPanel.tsx lines ~144-158).
const PUBLISH_INPUT = {
  name: 'The Salted Anchor',
  archetype: 'tavern',
  feature: 'belfry',
  withInterior: true,
  dimensions: { width: 9, height: 5, depth: 7 },
  worldId: 'concordia-hub',
  position: { x: 12, y: 0, z: -4 },
  rotationY: 45,
};

// The EXACT return shape `game-design.building-publish` sends back
// (server/domains/gamedesign.js: `return { ok: true, dtuId, buildingId, spawned: true, citation };`).
const PUBLISH_RESULT = {
  ok: true,
  dtuId: 'dtu_abc123',
  buildingId: 'wb_xyz789',
  spawned: true,
  citation: null,
};

describe('normalizeBuildingPublish (game-design.building-publish → building)', () => {
  it('constructs a real building artifact whose dimensions/archetype/name/position match the real input, id from the real result', () => {
    const a = detectArtifact('game-design', 'building-publish', PUBLISH_INPUT, PUBLISH_RESULT) as ConkayBuildingArtifact;
    expect(a).not.toBeNull();
    expect(a.kind).toBe('building');
    expect(a.buildings).toHaveLength(1);
    const b = a.buildings[0];
    // id ← result.buildingId (the real spawned world_buildings row id).
    expect(b.id).toBe('wb_xyz789');
    // name/dimensions/position ← real input, untouched.
    expect(b.name).toBe('The Salted Anchor');
    expect(b.dimensions).toEqual({ width: 9, height: 5, depth: 7 });
    expect(b.position).toEqual({ x: 12, y: 0, z: -4 });
    // building_type + the extra archetype/feature fields BuildingRenderer3D
    // reads via inline type-cast ← real input, untouched.
    expect(b.building_type).toBe('tavern');
    expect((b as unknown as { archetype: string }).archetype).toBe('tavern');
    expect((b as unknown as { feature?: string }).feature).toBe('belfry');
    // Structural placeholders — documented, minimal, inert on the archetype
    // render path (never fabricated as if they were real analysis).
    expect(b.floors).toBe(1);
    expect(b.structure).toEqual({
      columns: { count: 0, spacing: 0, radius: 0 },
      beams: { count: 0, height: 0 },
      roofType: 'flat',
      hasBasement: false,
      windowRows: 0,
      windowsPerRow: 0,
    });
    // No structural analysis ran ⟹ honestly empty, never fabricated stress data.
    expect(a.validation).toEqual([]);
    expect(a.components).toEqual([{ id: 'wb_xyz789', label: 'The Salted Anchor', kind: 'building' }]);
    expect(a.sourceDomain).toBe('game-design');
    expect(a.sourceMacro).toBe('building-publish');
  });

  it('omits the extra `feature` field when the publish had no iconic feature (honest — never invents one)', () => {
    const noFeatureInput = { ...PUBLISH_INPUT, feature: null };
    const a = detectArtifact('game-design', 'building-publish', noFeatureInput, PUBLISH_RESULT) as ConkayBuildingArtifact;
    expect(a).not.toBeNull();
    expect((a.buildings[0] as unknown as { feature?: string }).feature).toBeUndefined();
  });

  it('falls back to "Untitled building" only when the real input genuinely has no name (never blank)', () => {
    const noNameInput = { ...PUBLISH_INPUT, name: '' };
    const a = detectArtifact('game-design', 'building-publish', noNameInput, PUBLISH_RESULT) as ConkayBuildingArtifact;
    expect(a.buildings[0].name).toBe('Untitled building');
  });

  it('returns null for a non-ok publish result (honest failure, never a placeholder building)', () => {
    expect(detectArtifact('game-design', 'building-publish', PUBLISH_INPUT, { ok: false, error: 'overlap', existingId: 'wb_1' })).toBeNull();
    expect(detectArtifact('game-design', 'building-publish', PUBLISH_INPUT, { ok: false, error: 'invalid_archetype' })).toBeNull();
  });

  it('returns null when the result carries no real buildingId', () => {
    expect(detectArtifact('game-design', 'building-publish', PUBLISH_INPUT, { ok: true, dtuId: 'dtu_1', spawned: true })).toBeNull();
    expect(detectArtifact('game-design', 'building-publish', PUBLISH_INPUT, {})).toBeNull();
    expect(detectArtifact('game-design', 'building-publish', PUBLISH_INPUT, null)).toBeNull();
  });

  it('returns null when the real input has no genuine archetype or non-positive dimensions', () => {
    expect(detectArtifact('game-design', 'building-publish', { ...PUBLISH_INPUT, archetype: '' }, PUBLISH_RESULT)).toBeNull();
    expect(detectArtifact('game-design', 'building-publish', {}, PUBLISH_RESULT)).toBeNull();
    expect(detectArtifact(
      'game-design', 'building-publish',
      { ...PUBLISH_INPUT, dimensions: { width: 0, height: 5, depth: 7 } },
      PUBLISH_RESULT,
    )).toBeNull();
    expect(detectArtifact(
      'game-design', 'building-publish',
      { ...PUBLISH_INPUT, dimensions: { width: 9, height: -1, depth: 7 } },
      PUBLISH_RESULT,
    )).toBeNull();
  });

  it('does not match a non-building-publish domain/macro (a different game-design macro is unaffected)', () => {
    expect(detectArtifact('game-design', 'building-list-mine', PUBLISH_INPUT, PUBLISH_RESULT)).toBeNull();
    expect(detectArtifact('world', 'building-publish', PUBLISH_INPUT, PUBLISH_RESULT)).toBeNull();
    // A totally unrelated macro result is untouched by this detector.
    expect(detectArtifact('music', 'nowPlaying', {}, { track: 'x' })).toBeNull();
  });

  it('the pre-existing shape-driven building detector still works unchanged (composition did not break it)', () => {
    const shapeResult = {
      buildings: [
        {
          id: 'b1',
          name: 'Warehouse',
          position: { x: 0, y: 0, z: 0 },
          dimensions: { width: 10, height: 6, depth: 8 },
          floors: 2,
          material: 'steel',
          style: 'industrial',
          structure: { columns: { count: 4, spacing: 3, radius: 0.2 }, beams: { count: 3, height: 3 }, roofType: 'flat', hasBasement: false, windowRows: 2, windowsPerRow: 4 },
        },
      ],
      validationData: [{ buildingId: 'b1', stressRatio: 0.4, hasFailure: false }],
    };
    const a = detectArtifact('anydomain', 'anymacro', {}, shapeResult) as ConkayBuildingArtifact;
    expect(a).not.toBeNull();
    expect(a.kind).toBe('building');
    expect(a.buildings[0].id).toBe('b1');
    expect(a.validation).toHaveLength(1);
  });
});
