import { describe, it, expect } from 'vitest';
import { parseWorkspaceCommand, applyWorkspaceCommand, parseSafetyFactor, describeStudy, type BeamStudyResult } from '@/lib/conkay/workspace-commands';

const DIMS = { length: 1200, height: 300, flangeWidth: 150, flangeThickness: 15, webThickness: 9 };
// The engineering lens's real material ids/labels.
const MATERIALS = [
  { id: 'steel-a36', label: 'ASTM A36 Structural Steel' },
  { id: 'steel-a992', label: 'ASTM A992 Steel (50 ksi)' },
  { id: 'steel-4140', label: 'AISI 4140 Alloy Steel' },
  { id: 'aluminum-6061-t6', label: 'Aluminum 6061-T6' },
  { id: 'aluminum-7075-t6', label: 'Aluminum 7075-T6' },
  { id: 'stainless-304', label: 'Stainless Steel 304' },
  { id: 'douglas-fir', label: 'Douglas Fir (Structural)' },
  { id: 'cfrp', label: 'Carbon Fiber (CFRP)' },
];

const parse = (t: string, mat = 'steel-a992') => parseWorkspaceCommand(t, DIMS, MATERIALS, mat);

describe('workspace prompt: span, material, safety factor (live-test bug)', () => {
  it('applies the full example prompt with nothing left unapplied', () => {
    const cmd = parse('Design a 3 m simply supported aluminum beam carrying 5 kN at midspan with a safety factor of 1.5.');
    expect(cmd).not.toBeNull();
    expect(cmd!.dims.length).toBe(3000);
    expect(cmd!.loadN).toBe(5000);
    expect(cmd!.support).toBe('simply-supported');
    expect(cmd!.materialId).toBe('aluminum-6061-t6');
    expect(cmd!.requiredSafetyFactor).toBe(1.5);
    expect(cmd!.note || '').not.toMatch(/not applied/i);
    // Section left as-is.
    expect(cmd!.dims.height).toBeUndefined();
    const next = applyWorkspaceCommand(cmd!, { dims: DIMS, loadN: 200000, support: 'simply-supported', materialId: 'steel-a992' });
    expect(next).toMatchObject({ dims: { ...DIMS, length: 3000 }, loadN: 5000, materialId: 'aluminum-6061-t6', requiredSafetyFactor: 1.5 });
  });

  it.each([
    ['a 3 m beam', 3000],
    ['a 3 meter beam', 3000],
    ['a 3 metre span', 3000],
    ['3000 mm span', 3000],
    ['a 3000 mm long steel girder', 3000],
    ['10 ft span', 3048],
    ['a 10 ft simply supported beam', 3048],
    ['span 2.5 meters', 2500],
  ])('span: %s', (t, mm) => {
    expect(parse(t)!.dims.length).toBe(mm);
  });

  it('does not read a depth as the span', () => {
    const cmd = parse('a 400 mm deep beam');
    expect(cmd?.dims.length).toBeUndefined();
  });

  it.each([
    ['aluminum', 'aluminum-6061-t6'],
    ['aluminium', 'aluminum-6061-t6'],
    ['7075 aluminum', 'aluminum-7075-t6'],
    ['A36 steel', 'steel-a36'],
    ['4140 steel', 'steel-4140'],
    ['stainless steel', 'stainless-304'],
    ['timber', 'douglas-fir'],
    ['carbon fiber', 'cfrp'],
  ])('material: %s', (word, id) => {
    expect(parse(`make it ${word}`, 'aluminum-6061-t6')?.materialId ?? 'aluminum-6061-t6').toBe(id);
  });

  it('plain "steel" keeps the current steel grade, defaults to A992 otherwise', () => {
    // Already steel: nothing to change, so it is not treated as an edit.
    expect(parse('make it steel', 'steel-a36')).toBeNull();
    expect(parse('a 3 m steel beam', 'steel-a36')!.materialId).toBe('steel-a36');
    expect(parse('make it steel', 'aluminum-6061-t6')!.materialId).toBe('steel-a992');
  });

  it.each([
    ['safety factor of 1.5', 1.5], ['SF 2', 2], ['FoS = 3', 3], ['factor of safety at least 1.67', 1.67], ['2x safety factor', 2], ['safety factor of two', 2],
  ])('safety factor: %s', (t, v) => {
    expect(parseSafetyFactor(t).value).toBe(v);
  });

  it('rejects an out-of-range safety factor', () => {
    expect(parseSafetyFactor('safety factor 0.5').value).toBeNull();
  });

  it('describeStudy leads with the PASS/FAIL verdict when an SF was asked for', () => {
    const text = describeStudy({
      material: { id: 'aluminum-6061-t6', label: 'Aluminum 6061-T6', E: 68900, yield: 276 }, support: 'simply-supported', loadN: 5000,
      dims: { ...DIMS, length: 3000 }, maxStressMPa: 5.3, maxDeflectionMm: 1, utilization: 0.02, safetyFactor: 52.1, pass: true,
      handCheck: { maxStressMPa: 5.3, maxDeflectionMm: 1, stressError: 0, deflectionError: 0, agrees: true, tolerance: 0.02 },
      safetyCheck: { requiredSafetyFactor: 1.5, stated: true, achievedSafetyFactor: 52.12, governing: 'hand', margin: 33.7, marginPct: 3374.7, pass: true, verdict: 'PASS: achieved SF 52.12 vs required SF 1.5, margin +3374.7% (hand governs).' },
      warnings: [],
    } as unknown as BeamStudyResult);
    expect(text).toMatch(/PASS: achieved SF 52\.12 vs required SF 1\.5/);
  });
});
