import { describe, it, expect } from 'vitest';
import { beamReportBody, beamReportDtuCall, beamReportHeadline, beamReportSentence } from '@/lib/conkay/beam-report';
import type { BeamStudyResult } from '@/lib/conkay/workspace-commands';

const DIMS = { length: 1200, height: 300, flangeWidth: 150, flangeThickness: 15, webThickness: 9 };

function result(over: Partial<BeamStudyResult> = {}): BeamStudyResult {
  return {
    jobId: 'sim_span',
    name: '4 m span',
    updatedAt: '2026-10-10T00:00:00.000Z',
    dims: DIMS,
    support: 'simply-supported',
    loadN: 10000,
    material: { id: 'steel-a992', label: 'ASTM A992 Steel (50 ksi)', E: 200000, yield: 345 },
    section: { areaMm2: 7086, IxMm4: 1.06e8, IyMm4: 8.4e6 },
    maxStressMPa: 12.5,
    maxDeflectionMm: 0.4,
    utilization: 0.036,
    safetyFactor: 27.6,
    pass: true,
    handCheck: { maxStressMPa: 12.4, maxDeflectionMm: 0.39, stressError: 0.01, deflectionError: 0.02, agrees: true, tolerance: 0.02 },
    warnings: [],
    utilizationByMember: [],
    ...over,
  };
}

describe('beam report uses the solved span', () => {
  it('drops a name that claims a different span', () => {
    const r = result();
    expect(beamReportHeadline(r)).toBe('1200 mm span');
    const sentence = beamReportSentence(r);
    expect(sentence.startsWith('1200 mm span:')).toBe(true);
    expect(sentence).not.toMatch(/4 m/);
    expect(sentence).toContain('1200 mm');
    expect(sentence).toContain('10 kN');
    const body = beamReportBody(r);
    expect(body).toContain('L=1200 mm');
    expect(body).toContain('12.50 MPa');
    expect(body).not.toMatch(/4 m/);
  });

  it('keeps a name that does not claim a span', () => {
    const r = result({ name: 'Shop beam' });
    expect(beamReportHeadline(r)).toBe('Shop beam');
    expect(beamReportSentence(r).startsWith('Shop beam:')).toBe(true);
  });

  it('keeps a name whose span matches the solve, including mm, cm and ft', () => {
    expect(beamReportHeadline(result({ name: '1200 mm span' }))).toBe('1200 mm span');
    expect(beamReportHeadline(result({ name: '120 cm span' }))).toBe('120 cm span');
    expect(beamReportHeadline(result({ name: 'shop, 3.937 ft' }))).toBe('shop, 3.937 ft');
    expect(beamReportHeadline(result({ name: '' }))).toBe('1200 mm span');
    const failed = result({
      support: 'cantilever',
      pass: false,
      jobId: null,
      handCheck: { maxStressMPa: 400, maxDeflectionMm: 12, stressError: 0.2, deflectionError: 0.1, agrees: false, tolerance: 0.02 },
      warnings: ['shear not checked'],
    });
    const body = beamReportBody(failed);
    expect(body).toContain('at the free end');
    expect(body).toContain('fails');
    expect(body).toContain('does not agree');
    expect(body).toContain('sim job n/a');
  });

  it('puts the solved length in the DTU title and machine record', () => {
    const call = beamReportDtuCall(result());
    expect(call).not.toBeNull();
    expect(call!.input.title).toContain('1200 mm span');
    expect(call!.input.title).not.toMatch(/4 m/);
    expect(call!.input.machine).toMatchObject({
      kind: 'conkay_beam_study',
      loadN: 10000,
      dims: DIMS,
      maxStressMPa: 12.5,
    });
    expect(String(call!.input.human.summary)).toContain('1200 mm');
    expect(beamReportDtuCall(result({ jobId: null }))).toBeNull();
    expect(beamReportDtuCall(null)).toBeNull();
  });
});
