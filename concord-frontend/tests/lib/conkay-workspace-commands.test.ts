import { describe, it, expect } from 'vitest';
import {
  applyWorkspaceCommand,
  describeStudy,
  parseWorkspaceCommand,
  studyFromSaved,
  type BeamDims,
  type BeamStudyResult,
} from '@/lib/conkay/workspace-commands';

const DIMS: BeamDims = { length: 1200, height: 300, flangeWidth: 150, flangeThickness: 15, webThickness: 9 };
const MATERIALS = [
  { id: 'steel-a36', label: 'ASTM A36 Structural Steel' },
  { id: 'steel-a992', label: 'ASTM A992 Steel (50 ksi)' },
  { id: 'aluminum-6061', label: 'Aluminum 6061-T6' },
  { id: 'aluminum-7075', label: 'Aluminum 7075-T6' },
  { id: 'stainless-304', label: 'Stainless Steel 304' },
  { id: 'pla', label: 'PLA (3D-print)' },
  { id: 'concrete', label: 'Concrete (30 MPa)' },
];

describe('parseWorkspaceCommand', () => {
  it('reads the concept prompt: web to 8 mm, keep flanges at 15 mm, re-run', () => {
    const c = parseWorkspaceCommand(
      "Let's reduce web thickness to 8.0 mm and re-run the FEA. Keep flanges at 15.0 mm.",
      DIMS,
      MATERIALS,
    );
    expect(c).not.toBeNull();
    expect(c!.dims).toEqual({ webThickness: 8, flangeThickness: 15 });
    // t_f is already 15 — restated, not reported as an edit.
    expect(c!.changes).toEqual(['t_w = 8 mm']);
    expect(c!.run).toBe(true);
    expect(c!.materialId).toBeUndefined();
  });

  it('reads symbols and units', () => {
    expect(parseWorkspaceCommand('t_w = 8', DIMS)!.dims).toEqual({ webThickness: 8 });
    expect(parseWorkspaceCommand('tf=12mm', DIMS)!.dims).toEqual({ flangeThickness: 12 });
    expect(parseWorkspaceCommand('length 1.5 m', DIMS)!.dims).toEqual({ length: 1500 });
    expect(parseWorkspaceCommand('L = 2400', DIMS)!.dims).toEqual({ length: 2400 });
    expect(parseWorkspaceCommand('depth 30 cm', DIMS)!.dims).toEqual({ height: 300 });
    expect(parseWorkspaceCommand('flange width 6 in', DIMS)!.dims).toEqual({ flangeWidth: 152.4 });
  });

  it('recognises a restated value without calling it a change', () => {
    const c = parseWorkspaceCommand('keep the flanges at 15 mm', DIMS)!;
    expect(c.dims).toEqual({ flangeThickness: 15 });
    expect(c.changes).toEqual([]);
  });

  it('applies relative edits against the current dims', () => {
    expect(parseWorkspaceCommand('reduce the web thickness by 1 mm', DIMS)!.dims).toEqual({ webThickness: 8 });
    expect(parseWorkspaceCommand('increase depth by 5 cm', DIMS)!.dims).toEqual({ height: 350 });
  });

  it('reads load, support and material without confusing them with dims', () => {
    const c = parseWorkspaceCommand('make it a cantilever with a 50 kN load in A36', DIMS, MATERIALS)!;
    expect(c.loadN).toBe(50000);
    expect(c.support).toBe('cantilever');
    expect(c.materialId).toBe('steel-a36');
    expect(c.dims).toEqual({});
    expect(parseWorkspaceCommand('fixed at both ends', DIMS)!.support).toBe('fixed');
    expect(parseWorkspaceCommand('simply supported, 10 kips', DIMS)!.loadN).toBeCloseTo(44482.216, 2);
  });

  it('names a material only from a token unique to it', () => {
    expect(parseWorkspaceCommand('switch to 6061', DIMS, MATERIALS)!.materialId).toBe('aluminum-6061');
    expect(parseWorkspaceCommand('use stainless 304', DIMS, MATERIALS)!.materialId).toBe('stainless-304');
    expect(parseWorkspaceCommand('try concrete', DIMS, MATERIALS)!.materialId).toBe('concrete');
    // "aluminum" and "steel" are shared — no guess.
    expect(parseWorkspaceCommand('make it aluminum', DIMS, MATERIALS)).toBeNull();
    // A quantity is never read as a grade, and "3D" is not PLA.
    expect(parseWorkspaceCommand('load 304 kN', DIMS, MATERIALS)!.materialId).toBeUndefined();
    expect(parseWorkspaceCommand('show me the 3D view', DIMS, MATERIALS)).toBeNull();
  });

  it('recognises save and keep actions', () => {
    expect(parseWorkspaceCommand('save model', DIMS)!.save).toBe(true);
    expect(parseWorkspaceCommand('keep this as a DTU', DIMS)!.keep).toBe(true);
    expect(parseWorkspaceCommand('run fea', DIMS)!.run).toBe(true);
  });

  it('returns null for questions so they go to the agent', () => {
    expect(parseWorkspaceCommand('why does the web carry the shear?', DIMS, MATERIALS)).toBeNull();
    expect(parseWorkspaceCommand('what about lateral torsional buckling', DIMS, MATERIALS)).toBeNull();
    expect(parseWorkspaceCommand('   ', DIMS)).toBeNull();
  });

  it('applyWorkspaceCommand merges onto the current inputs', () => {
    const c = parseWorkspaceCommand('t_w = 8, 20 kN', DIMS)!;
    const next = applyWorkspaceCommand(c, { dims: DIMS, loadN: 1000, support: 'fixed', materialId: 'steel-a36' });
    expect(next).toEqual({ dims: { ...DIMS, webThickness: 8 }, loadN: 20000, support: 'fixed', materialId: 'steel-a36' });
  });
});

const RESULT: BeamStudyResult = {
  jobId: 'sim_2', name: 'Beam', updatedAt: '2026-10-06T12:00:00.000Z', dims: DIMS,
  support: 'simply-supported', loadN: 200000,
  material: { id: 'steel-a992', label: 'ASTM A992 Steel (50 ksi)', E: 200000, yield: 345 },
  section: { areaMm2: 7086, IxMm4: 1.06e8, IyMm4: 8.4e6 },
  maxStressMPa: 84.73, maxDeflectionMm: 0.3389, utilization: 0.2456, safetyFactor: 4.07, pass: true,
  handCheck: { maxStressMPa: 84.73, maxDeflectionMm: 0.3389, stressError: 0, deflectionError: 0, agrees: true, tolerance: 0.02 },
  warnings: [], utilizationByMember: [{ id: 'M1', utilization: 0.1 }],
};

describe('describeStudy', () => {
  it('reports only solver numbers and the hand check', () => {
    const text = describeStudy(RESULT);
    expect(text).toContain('84.7 MPa');
    expect(text).toContain('safety factor 4.07');
    expect(text).toContain('solver agrees');
    expect(text).not.toMatch(/confiden/i);
  });

  it('adds a signed change against the previous run', () => {
    const prev = { ...RESULT, jobId: 'sim_1', maxStressMPa: 90 };
    expect(describeStudy(RESULT, prev)).toContain('(-5.9%)');
  });

  it('says plainly when the section fails or the hand check disagrees', () => {
    const bad = { ...RESULT, pass: false, utilization: 1.3, handCheck: { ...RESULT.handCheck, agrees: false, stressError: 0.1 } };
    const text = describeStudy(bad);
    expect(text).toContain('does not carry the load');
    expect(text).toContain('Treat this run with caution');
  });
});

describe('studyFromSaved', () => {
  it('rebuilds a result from beamStudy-get and refuses incomplete records', () => {
    const saved = {
      name: 'Beam', dims: DIMS, support: 'cantilever', loadN: 5000, jobId: 'sim_9',
      summary: { maxStressMPa: 1, maxDeflectionMm: 2, utilization: 0.1, safetyFactor: 9, pass: true, handCheck: RESULT.handCheck, warnings: [] },
      section: RESULT.section, utilizationByMember: [], dtuId: 'dtu_1',
      materialInfo: RESULT.material,
    };
    const r = studyFromSaved(saved)!;
    expect(r.jobId).toBe('sim_9');
    expect(r.material.yield).toBe(345);
    expect(r.dtuId).toBe('dtu_1');
    expect(studyFromSaved({ ...saved, summary: undefined })).toBeNull();
    expect(studyFromSaved(null)).toBeNull();
  });
});

describe('conkayWorkspaceHref', () => {
  it('builds the workspace link for each handoff', async () => {
    const { conkayWorkspaceHref } = await import('@/lib/conkay/workspace-link');
    expect(conkayWorkspaceHref()).toBe('/lenses/conkay');
    expect(conkayWorkspaceHref({ ask: '  t_w = 8 mm  ' })).toBe('/lenses/conkay?ask=t_w+%3D+8+mm');
    expect(conkayWorkspaceHref({ dtu: 'dtu_1', title: 'Frame beam' })).toBe('/lenses/conkay?dtu=dtu_1&title=Frame+beam');
    expect(conkayWorkspaceHref({ ws: 'proj_1', ask: '' })).toBe('/lenses/conkay?ws=proj_1');
  });
});
