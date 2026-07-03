// concord-frontend/tests/lib/conkay/artifact-kinds.test.ts
//
// Unit F9 (K5) — pins the artifact→3D kind registry's honesty contract:
//   (a) each normalizer produces a real ConkayArtifact ONLY from a real macro
//       result's real fields (shapes grounded in the live handlers — see the
//       module header), and returns null otherwise — never a guess;
//   (b) detectArtifact routes a real (domain, macro, input, result) to the right
//       kind, and returns null for a shape that matches no kind (the STOP-POINT
//       feeder — an unknown result never fabricates an artifact);
//   (c) the fea-frame kind is byte-identical to the store's feaResultFromRun (so
//       the generalized viewer and ForwardSimPanel can't diverge);
//   (d) the shape-driven `building` kind matches a real BuildingDTU shape and
//       nothing else.
//
// Placement note: this exercises a `lib/` module, and the vitest `include` in
// vitest.config.ts scans `tests/**` (not `lib/**`), so the test lives under
// tests/lib/conkay/ — the repo's real convention for lib-module tests (mirrors
// tests/lib/hooks/, tests/lib/lenses/). The spec said "beside it"; the harness
// wouldn't run it there.

import { describe, it, expect } from 'vitest';
import {
  detectArtifact,
  artifactKindLabel,
  ARTIFACT_KINDS,
  type ConkayArArtifact,
  type ConkayFeaArtifact,
  type ConkayFoundryArtifact,
  type ConkayForgeArtifact,
  type ConkayBuildingArtifact,
} from '@/lib/conkay/artifact-kinds';
import { feaResultFromRun } from '@/components/conkay/conkayHudStore';

// ── Real macro-result fixtures (fields grounded in the live handlers) ────────

// ar.render → { drawList:[{ id, kind, color, transform:{position,rotation,scale}, ... }], title, ... }
const AR_RESULT = {
  title: 'Lattice beacon',
  objectCount: 2,
  drawList: [
    { id: 'core', kind: 'model', color: '#ff0000', transform: { position: { x: 1, y: 0, z: 0 }, scale: 1 } },
    { id: 'ring', kind: 'primitive', color: '#00ff00', transform: { position: { x: -1, y: 0, z: 0 }, scale: 2 } },
  ],
};

// engineering.runFEA input model + solver return (same shapes as the solver).
const FEA_INPUT = {
  model: {
    nodes: [
      { id: 'n1', x: 0, y: 0, z: 0 },
      { id: 'n2', x: 3, y: 0, z: 0 },
    ],
    members: [{ id: 'm1', nodeI: 'n1', nodeJ: 'n2', area: 10 }],
  },
};
const FEA_RESULT = {
  jobId: 'job-1',
  elapsedMs: 12,
  displacements: [
    { nodeId: 'n1', dx: 0, dy: 0, dz: 0, rx: 0, ry: 0, rz: 0, magnitude: 0 },
    { nodeId: 'n2', dx: 0.5, dy: -0.25, dz: 0, rx: 0, ry: 0, rz: 0, magnitude: 0.56 },
  ],
  utilization: [{ id: 'm1', combinedStress: 15800, utilization: 0.73, pass: true }],
  stresses: [{ id: 'm1', combinedStress: 15800 }],
  summary: { maxDisplacement: 0.56, maxUtilization: 0.73, allPass: true, memberCount: 1, nodeCount: 2 },
};

// foundry.preview → { ok, previewWorldId, universeType, activatedSystems, skippedStubs }
const FOUNDRY_RESULT = {
  ok: true,
  previewWorldId: 'preview-abc123',
  universeType: 'fantasy',
  activatedSystems: ['terrain-biomes', 'weather'],
  skippedStubs: ['economy'],
};

// forge.sandbox → { projectId, versionId, html, fileCount }
const FORGE_RESULT = {
  projectId: 'proj-9',
  versionId: 'v3',
  html: '<!doctype html><title>Todo</title><body>real generated app</body>',
  fileCount: 4,
};

describe('normalizeAr (ar.render → ar-render)', () => {
  it('produces one component per real drawList object and carries the real title + drawList', () => {
    const a = detectArtifact('ar', 'render', {}, AR_RESULT) as ConkayArArtifact;
    expect(a).not.toBeNull();
    expect(a.kind).toBe('ar-render');
    expect(a.title).toBe('Lattice beacon');
    expect(a.drawList).toHaveLength(2);
    expect(a.components.map((c) => c.id)).toEqual(['core', 'ring']);
    expect(a.components.map((c) => c.kind)).toEqual(['model', 'primitive']);
    expect(a.sourceDomain).toBe('ar');
    expect(a.sourceMacro).toBe('render');
  });

  it('returns null for an empty drawList (nothing real to inspect)', () => {
    expect(detectArtifact('ar', 'render', {}, { drawList: [], title: 'x' })).toBeNull();
    expect(detectArtifact('ar', 'render', {}, {})).toBeNull();
  });

  it('does not match a non-ar domain/macro', () => {
    expect(detectArtifact('music', 'render', {}, AR_RESULT)).toBeNull();
    expect(detectArtifact('ar', 'sceneList', {}, AR_RESULT)).toBeNull();
  });
});

describe('normalizeFea (engineering.runFEA → fea-frame)', () => {
  it('is byte-identical to the store feaResultFromRun (no divergence from ForwardSimPanel)', () => {
    const a = detectArtifact('engineering', 'runFEA', FEA_INPUT, FEA_RESULT) as ConkayFeaArtifact;
    expect(a).not.toBeNull();
    expect(a.kind).toBe('fea-frame');
    // Exactly the store's pure reshape — same producer, no re-derivation.
    expect(a.fea).toEqual(feaResultFromRun(FEA_INPUT, FEA_RESULT));
    expect(a.fea.members[0]).toMatchObject({ id: 'm1', nodeI: 'n1', nodeJ: 'n2', utilization: 0.73, stress: 15800 });
    expect(a.components).toEqual([{ id: 'm1', label: 'n1 → n2', kind: 'member' }]);
  });

  it('returns null for a partial/failed solve (needs BOTH input geometry and solver arrays)', () => {
    expect(detectArtifact('engineering', 'runFEA', {}, FEA_RESULT)).toBeNull(); // no geometry
    expect(detectArtifact('engineering', 'runFEA', FEA_INPUT, {})).toBeNull(); // no solver return
  });
});

describe('normalizeFoundry (foundry.preview → foundry-worldspec)', () => {
  it('carries the real previewWorldId + activated systems + skipped stubs', () => {
    const a = detectArtifact('foundry', 'preview', {}, FOUNDRY_RESULT) as ConkayFoundryArtifact;
    expect(a).not.toBeNull();
    expect(a.kind).toBe('foundry-worldspec');
    expect(a.previewWorldId).toBe('preview-abc123');
    expect(a.universeType).toBe('fantasy');
    expect(a.activatedSystems).toEqual(['terrain-biomes', 'weather']);
    expect(a.skippedStubs).toEqual(['economy']);
    expect(a.components.map((c) => c.id)).toEqual(['terrain-biomes', 'weather']);
  });

  it('returns null without a real previewWorldId (no persisted world ⟹ nothing renderable)', () => {
    expect(detectArtifact('foundry', 'preview', {}, { ok: false, reason: 'no_systems' })).toBeNull();
    expect(detectArtifact('foundry', 'preview', {}, { previewWorldId: '' })).toBeNull();
  });
});

describe('normalizeForge (forge.sandbox → forge-app)', () => {
  it('carries the real generated html + fileCount + projectId', () => {
    const a = detectArtifact('forge', 'sandbox', {}, FORGE_RESULT) as ConkayForgeArtifact;
    expect(a).not.toBeNull();
    expect(a.kind).toBe('forge-app');
    expect(a.html).toContain('real generated app');
    expect(a.fileCount).toBe(4);
    expect(a.projectId).toBe('proj-9');
  });

  it('returns null without real html (forge.generate returns code text, not a served/renderable doc)', () => {
    // forge.generate's shape ({ code, sections, config, ... }) has no html → no forge-app artifact.
    expect(detectArtifact('forge', 'generate', {}, { code: 'const x=1', sections: [], template: 't' })).toBeNull();
    expect(detectArtifact('forge', 'sandbox', {}, { projectId: 'p', html: '' })).toBeNull();
  });
});

describe('normalizeBuilding (shape-driven → building)', () => {
  const BUILDING_RESULT = {
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

  it('matches a real BuildingDTU-shaped result regardless of domain (shape-driven detector)', () => {
    const a = detectArtifact('anydomain', 'anymacro', {}, BUILDING_RESULT) as ConkayBuildingArtifact;
    expect(a).not.toBeNull();
    expect(a.kind).toBe('building');
    expect(a.buildings).toHaveLength(1);
    expect(a.validation).toHaveLength(1);
    expect(a.components).toEqual([{ id: 'b1', label: 'Warehouse', kind: 'building' }]);
  });

  it('returns null when buildings lack the load-bearing fields (no half-real render)', () => {
    expect(detectArtifact('x', 'y', {}, { buildings: [{ id: 'b1' }] })).toBeNull(); // no dimensions/structure
    expect(detectArtifact('x', 'y', {}, { buildings: [] })).toBeNull();
    expect(detectArtifact('x', 'y', {}, {})).toBeNull();
  });
});

describe('detectArtifact registry + STOP-POINT feeder', () => {
  it('returns null for a result that matches no kind (never fabricates one)', () => {
    expect(detectArtifact('music', 'nowPlaying', {}, { track: 'x', ms: 3 })).toBeNull();
    expect(detectArtifact('accounting', 'trialBalance', {}, { rows: [] })).toBeNull();
    expect(detectArtifact('x', 'y', {}, null)).toBeNull();
  });

  it('exposes exactly the 5 registered kinds, each with a normalizer + label', () => {
    expect(ARTIFACT_KINDS.map((e) => e.kind).sort()).toEqual(
      ['ar-render', 'building', 'fea-frame', 'forge-app', 'foundry-worldspec'],
    );
    for (const e of ARTIFACT_KINDS) {
      expect(typeof e.normalize).toBe('function');
      expect(e.label.length).toBeGreaterThan(0);
    }
  });

  it('artifactKindLabel resolves a registered kind and falls back to the raw string for an unknown one', () => {
    expect(artifactKindLabel('ar-render')).toBe('AR scene');
    expect(artifactKindLabel('some-future-kind')).toBe('some-future-kind');
  });
});
