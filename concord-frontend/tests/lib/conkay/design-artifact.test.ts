// tests/lib/conkay/design-artifact.test.ts
//
// Pins the designs adapter's honesty contract:
//   - a workbench view carrying `feaFrame` maps to the `fea-frame` artifact by
//     REUSING the registry normalizers (the members/utilization/displacements
//     are exactly what feaResultFromRun joins, byte-identical to the
//     ForwardSim / artifact-panel render) with provenance corrected to the
//     TRUE origin (the workbench's structure.frame run, not a runFEA macro
//     call that never happened);
//   - the artifact's sourceInput is a real Iterate-able model: feaModelFromInput
//     accepts it and a delta scales its real area/momentI + loads — the loop
//     FeaIterateBar drives through the real solver;
//   - a view without feaFrame, and any showcase snapshot, produce NO artifact
//     (null — receipts carry no geometry; nothing is invented).
import { describe, it, expect } from 'vitest';
import { designArtifactFrom, designArtifactFromSnapshot, designArtifactFromWorkbenchView } from '@/lib/conkay/design-artifact';
import { feaModelFromInput, proposeFeaIteration, type FeaModel } from '@/lib/conkay/fea-iterate';
import type { ConkayArtifact, ConkayFeaArtifact } from '@/lib/conkay/artifact-kinds';
import type { DesignSnapshot } from '@/lib/conkay/designs-api';
import type { WorkbenchFeaFrame, WorkbenchView } from '@/lib/conkay/workbench-api';

/** The server's feaFrameOf shape (chat/workbench.js): the kerb-twist case of a solved tub frame. */
const FEA_FRAME: WorkbenchFeaFrame = {
  runId: 'structure.frame@CHASSIS',
  case: 'kerb-twist',
  model: {
    nodes: [
      { id: 'FA.L', x: 0.9, y: -0.7, z: 0.24 },
      { id: 'FA.R', x: 0.9, y: 0.7, z: 0.24 },
      { id: 'QA.L', x: 2.9, y: -0.7, z: 0.24 },
    ],
    members: [
      { id: 'rail-fL1', nodeI: 'FA.L', nodeJ: 'S0.9.L', area: 0.00168, momentI: 4.2e-6, depthIn: 0.09, elasticModulus: 6.9e10, allowableStress: 2.76e8 },
      { id: 'rail-fR1', nodeI: 'FA.R', nodeJ: 'S0.9.R', area: 0.00168, momentI: 4.2e-6, depthIn: 0.09, elasticModulus: 6.9e10, allowableStress: 2.76e8 },
    ],
    loads: [{ nodeId: 'FA.R', Fx: 0, Fy: 0, Fz: 5121.3, Mx: 0, My: 0, Mz: 0 }],
    supports: [{ nodeId: 'QA.L', fixedDOF: ['x', 'y', 'z'] }],
  },
  result: {
    displacements: [
      { nodeId: 'FA.L', dx: 0, dy: 0, dz: -0.00162 },
      { nodeId: 'FA.R', dx: 0, dy: 0, dz: 0.00159 },
      { nodeId: 'QA.L', dx: 0, dy: 0, dz: 0 },
    ],
    utilization: [
      { id: 'rail-fL1', utilization: 0.0413 },
      { id: 'rail-fR1', utilization: 0.0472 },
    ],
    stresses: [
      { id: 'rail-fL1', combinedStress: 11406459 },
      { id: 'rail-fR1', combinedStress: 13001273 },
    ],
    summary: { maxUtilization: 0.0472 },
  },
};

/** A bare view — no solved frame carried. */
const view = (feaFrame?: WorkbenchFeaFrame | null): WorkbenchView => ({
  version: '1.1.0', revision: 0, receipt: 'd8c7cc281e676b5024c3', state: {}, locked: [], knobs: [],
  graph: { nodes: [], edges: [] }, checks: [],
  ...(feaFrame !== undefined ? { feaFrame } : {}),
});

const SNAP = { id: 'car', checks: [], values: [] } as unknown as DesignSnapshot;

describe('designArtifactFromWorkbenchView', () => {
  it('maps a view feaFrame to the fea-frame artifact through the registry, with the true origin as provenance', () => {
    const a = designArtifactFromWorkbenchView(view(FEA_FRAME));
    expect(a).not.toBeNull();
    const fea = a as ConkayFeaArtifact;
    expect(fea.kind).toBe('fea-frame');
    // The registry's own reshape: geometry from the model, numbers joined by member id.
    expect(fea.fea.nodes.map((n) => n.id)).toEqual(['FA.L', 'FA.R', 'QA.L']);
    expect(fea.fea.members[0]).toMatchObject({ id: 'rail-fL1', nodeI: 'FA.L', nodeJ: 'S0.9.L', utilization: 0.0413, stress: 11406459 });
    expect(fea.fea.displacements[1]).toMatchObject({ nodeId: 'FA.R', dz: 0.00159 });
    expect(fea.fea.summary).toMatchObject({ maxUtilization: 0.0472 });
    expect(fea.components.map((c) => c.id)).toEqual(['rail-fL1', 'rail-fR1']);
    // Honest provenance — the workbench's own run, not an engineering.runFEA macro call.
    expect(fea.sourceDomain).toBe('conkay');
    expect(fea.sourceMacro).toContain('structure.frame@CHASSIS');
    expect(fea.sourceMacro).toContain('kerb-twist');
  });

  it('the artifact carries a real Iterate-able sourceInput: a delta scales its real fields', () => {
    const a = designArtifactFromWorkbenchView(view(FEA_FRAME)) as ConkayFeaArtifact;
    const model = feaModelFromInput(a.sourceInput) as FeaModel;
    expect(model).not.toBeNull();
    expect(model.members.length).toBe(2);
    expect(model.loads.length).toBe(1);
    const p = proposeFeaIteration(a.sourceInput, 'make the members thicker');
    expect(p.ok).toBe(true);
    // The honest iterate spine: the model's own area/momentI scale, loads untouched.
    const scaled = (p as { newInput: { model: FeaModel } }).newInput.model;
    expect(scaled.members[0].area).toBeCloseTo(0.00168 * 1.6, 9);
    expect(scaled.members[0].momentI).toBeCloseTo(4.2e-6 * 1.6, 9);
    expect(scaled.members[0].elasticModulus).toBe(6.9e10);
    expect(scaled.loads).toEqual(model.loads);
  });

  it('no feaFrame (a plain view, or a showcase snapshot) -> no artifact, never a stand-in', () => {
    expect(designArtifactFromWorkbenchView(view())).toBeNull();
    expect(designArtifactFromWorkbenchView(view(null))).toBeNull();
    expect(designArtifactFromWorkbenchView(null)).toBeNull();
    expect(designArtifactFromSnapshot(SNAP)).toBeNull();
    expect(designArtifactFrom({ snapshot: SNAP, view: view() })).toBeNull();
    const a = designArtifactFrom({ snapshot: SNAP, view: view(FEA_FRAME) }) as ConkayArtifact;
    expect(a.kind).toBe('fea-frame');
  });
});