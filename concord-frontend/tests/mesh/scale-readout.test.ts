import { describe, expect, it } from 'vitest';
import { dimensionLabel, displayScale, gridStep, scaleBarLength, spanMm } from '@/lib/mesh/scale-readout';

describe('scale readout', () => {
  it('picks a 1/2/5 grid and a scale bar shorter than the span', () => {
    expect(gridStep(80)).toBe(10);
    expect(scaleBarLength(400)).toBe(100);
    expect(scaleBarLength(30)).toBeLessThanOrEqual(30);
  });

  it('labels a layout bbox in millimetres and a beam by axis', () => {
    expect(dimensionLabel({
      units: 'mm',
      bbox_mm: { length: 405, height: 880, width: 330 },
    })).toBe('405 × 880 × 330 mm (long × tall × wide)');
    expect(dimensionLabel({
      units: 'mm',
      geometryUnits: 'm',
      extents_mm: { x: 10, y: 20, z: 2000 },
    })).toBe('X 10 × Y 20 × Z 2000 mm');
    expect(spanMm({ units: 'mm', bbox_mm: { length: 405, height: 880, width: 330 } })).toBe(880);
  });

  it('says unitless and does not invent millimetres', () => {
    const label = dimensionLabel({ units: 'unitless', scaleNote: 'unitless (not to scale)' });
    expect(label).toBe('unitless (not to scale)');
    expect(label).not.toMatch(/mm/);
    expect(spanMm({ units: 'unitless' })).toBe(0);
  });

  it('scales inline metre positions only', () => {
    expect(displayScale({ usingPositions: true, geometryUnits: 'm', units: 'mm' })).toBe(1000);
    expect(displayScale({ usingPositions: false, geometryUnits: 'm', units: 'mm' })).toBe(1);
    expect(displayScale({ usingPositions: true, geometryUnits: 'mm', units: 'mm' })).toBe(1);
  });
});
