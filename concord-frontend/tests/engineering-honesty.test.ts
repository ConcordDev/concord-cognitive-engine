// Engineering honesty: the user's own frame model + FEA runs are real,
// persisted work solved by a real direct-stiffness solver, so the header must
// not say "Simulated / Not real data". The model must start empty (no sample
// portal frame solved as if it were the user's), runs with nothing to solve
// must say what's missing, and the kept DTU title must be unique per run.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderHook } from '@testing-library/react';
import { getLensManifest } from '@/lib/lenses/manifest';
import { useDepthBadge } from '@/hooks/useDepthBadge';
import { EMPTY_FEA_MODEL, feaModelGap } from '@/components/engineering/types';
import { feaReportDtuCall } from '@/components/engineering/feaReport';

const m = getLensManifest('engineering');

describe('Engineering lens honesty', () => {
  it('is on the Real tier, not "Simulated / Not real data"', () => {
    expect(m?.dataTier).toBe('REAL_FREE');
    expect(renderHook(() => useDepthBadge('engineering')).result.current?.label).toBe('Real');
  });

  it('copy says what is not supported yet and drops SIM_GRADE / export claims', () => {
    const copy = JSON.stringify([m?.emptyState, m?.firstRunGuide]);
    expect(copy).not.toMatch(/SIM_GRADE|Export drawings|validate enforces/);
    expect(m?.emptyState?.caption).toMatch(/not a stamped analysis/);
    expect(m?.emptyState?.caption).toMatch(/aren't supported yet/);
  });

  it('the model starts empty and an incomplete model says what is missing', () => {
    expect(EMPTY_FEA_MODEL).toEqual({ nodes: [], members: [], loads: [], supports: [] });
    expect(feaModelGap(EMPTY_FEA_MODEL)).toBe('add at least two nodes');
    const two = { ...EMPTY_FEA_MODEL, nodes: [{ id: 'N1', x: 0, y: 0, z: 0 }, { id: 'N2', x: 10, y: 0, z: 0 }] };
    expect(feaModelGap(two)).toBe('add a member between two nodes');
    const types = readFileSync(join(__dirname, '../components/engineering/types.ts'), 'utf8');
    expect(types).not.toContain('DEFAULT_FEA_MODEL');
    const provider = readFileSync(join(__dirname, '../components/engineering/EngineeringFeaProvider.tsx'), 'utf8');
    expect(provider).toContain('useState<FEAModel>(EMPTY_FEA_MODEL)');
    expect(provider).toMatch(/nothing to solve yet/);
  });

  it('kept FEA DTU title carries the sim job id so identical runs do not collide', () => {
    const summary = { memberCount: 1, nodeCount: 2, maxUtilization: 0.1, maxDisplacement: 0.2, allPass: true };
    const a = feaReportDtuCall({ jobName: 'FEA run', result: { jobId: 'sim_a', summary } as never });
    const b = feaReportDtuCall({ jobName: 'FEA run', result: { jobId: 'sim_b', summary } as never });
    expect(String(a?.input.title)).toMatch(/^FEA run: 1 members, 2 nodes.* · sim_a$/);
    expect(a?.input.title).not.toBe(b?.input.title);
  });
});

describe('Engineering Run FEA wiring', () => {
  it('solves through engineering.runFEA directly, not a throwaway artifact id', () => {
    const provider = readFileSync(join(__dirname, '../components/engineering/EngineeringFeaProvider.tsx'), 'utf8');
    expect(provider).toMatch(/lensRun<Record<string, unknown>>\('engineering', 'runFEA', \{ model/);
    expect(provider).not.toMatch(/useCreateArtifact|'temp'|Analysis returned no result/);
  });
});

describe('Engineering FEA unit labels match the solver', () => {
  // The direct-stiffness solver takes coordinates in the same length unit as
  // A (in²) / I (in⁴) / E (psi): inches. Labels used to say "ft" for
  // coordinates and "MPa" for stresses that are psi (lb / in²).
  it('labels node coordinates in inches and member stress in psi', () => {
    const model = readFileSync(join(__dirname, '../components/engineering/ModelPanel.tsx'), 'utf8');
    const viewer = readFileSync(join(__dirname, '../components/engineering/FEAResultViewer.tsx'), 'utf8');
    expect(model).toMatch(/X \(in\)/);
    expect(model).not.toMatch(/\((ft)\)<\/th>/);
    expect(viewer).not.toContain('Stress (MPa)');
    expect(viewer).toContain("{stressUnit ? `Stress (${stressUnit})` : 'Stress'}");
    const results = readFileSync(join(__dirname, '../components/engineering/ResultsPanel.tsx'), 'utf8');
    expect(results).toContain('stressUnit="psi"');
  });
});
