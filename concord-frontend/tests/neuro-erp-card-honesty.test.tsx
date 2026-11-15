/**
 * FIX-neuro-001 (frontend legs) — the ERP card rendered 'baseline
 * RMS 0.473' with no unit (the same card's amplitudes are μV), showed
 * a component name twice when the identifier matched two peaks, and
 * named components from a single epoch with no caveat. All three are
 * presentation fixes here; the identification itself stays the
 * server's.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('FIX-neuro-001 — ERP card honesty', () => {
  const s = read('components/neuro/NeuroActionPanel.tsx');

  it('baseline RMS carries the μV unit', () => {
    expect(s).toContain('baseline RMS {erpResult.baselineRms} μV');
  });

  it('each component name renders once', () => {
    expect(s).toContain('arr.findIndex((x) => x.component === c.component) === i');
  });

  it('a single-epoch identification carries the tentative caveat', () => {
    expect(s).toContain('erpResult.epochCount === 1 && erpResult.identifiedComponents.length > 0');
    expect(s).toContain('treat these component labels as tentative');
  });
});
