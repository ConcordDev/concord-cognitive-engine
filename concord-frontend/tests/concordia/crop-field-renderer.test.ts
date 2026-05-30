import { describe, it, expect } from 'vitest';
import { cropVisual } from '@/lib/world-lens/crop-field-renderer';

describe('cropVisual (pure)', () => {
  it('height grows with growth stage', () => {
    const h0 = cropVisual({ crop_kind: 'wheat', growth_stage: 0 }).height;
    const h1 = cropVisual({ crop_kind: 'wheat', growth_stage: 1 }).height;
    const h2 = cropVisual({ crop_kind: 'wheat', growth_stage: 2 }).height;
    const h3 = cropVisual({ crop_kind: 'wheat', growth_stage: 3 }).height;
    expect(h0).toBeLessThan(h1);
    expect(h1).toBeLessThan(h2);
    expect(h2).toBeLessThan(h3);
    expect(h0).toBeCloseTo(0.1, 5);
    expect(h3).toBeCloseTo(0.8, 5);
  });

  it('ripe flag only at stage >= 3', () => {
    expect(cropVisual({ crop_kind: 'wheat', growth_stage: 0 }).ripe).toBe(false);
    expect(cropVisual({ crop_kind: 'wheat', growth_stage: 2 }).ripe).toBe(false);
    expect(cropVisual({ crop_kind: 'wheat', growth_stage: 3 }).ripe).toBe(true);
  });

  it('colour shifts from green toward golden as it ripens', () => {
    const young = cropVisual({ crop_kind: 'corn', growth_stage: 0 }).color;
    const ripe = cropVisual({ crop_kind: 'corn', growth_stage: 3 }).color;
    expect(young).not.toBe(ripe);

    // young = pure green seed colour; ripe = golden seed colour.
    expect(young).toBe(0x4caf50);
    expect(ripe).toBe(0xd4af37);

    // ripe has more red channel than young (greening → golden).
    const redOf = (hex: number) => (hex >> 16) & 0xff;
    expect(redOf(ripe)).toBeGreaterThan(redOf(young));
  });

  it('clamps out-of-range stages', () => {
    const below = cropVisual({ crop_kind: 'x', growth_stage: -5 });
    const above = cropVisual({ crop_kind: 'x', growth_stage: 99 });
    expect(below.height).toBeCloseTo(0.1, 5);
    expect(below.ripe).toBe(false);
    expect(above.height).toBeCloseTo(0.8, 5);
    expect(above.ripe).toBe(true);
  });
});
