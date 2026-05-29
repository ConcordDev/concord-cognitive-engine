// I1 — cel-shade gradient + material mapping (pure, headless).
import { describe, it, expect } from 'vitest';
import { toonRampBytes, toonParamsFromStandard } from '@/lib/world-lens/cel-shade';

describe('toonRampBytes', () => {
  it('produces a hard-banded ramp (few distinct values for few steps)', () => {
    const bytes = toonRampBytes(3, 256);
    expect(bytes.length).toBe(256);
    const distinct = new Set(Array.from(bytes));
    // 3 steps → exactly 3 quantised levels.
    expect(distinct.size).toBe(3);
    // first band is darkest (0), last is brightest (255).
    expect(bytes[0]).toBe(0);
    expect(bytes[255]).toBe(255);
  });

  it('more steps → more bands', () => {
    expect(new Set(Array.from(toonRampBytes(5))).size).toBe(5);
  });

  it('is monotonic non-decreasing', () => {
    const b = toonRampBytes(4);
    for (let i = 1; i < b.length; i++) expect(b[i]).toBeGreaterThanOrEqual(b[i - 1]);
  });
});

describe('toonParamsFromStandard', () => {
  it('preserves color/emissive/intensity', () => {
    const fakeColor = { clone: () => 'c' };
    const fakeEmissive = { clone: () => 'e' };
    const p = toonParamsFromStandard({ color: fakeColor, emissive: fakeEmissive, emissiveIntensity: 0.3 });
    expect(p.color).toBe(fakeColor);
    expect(p.emissive).toBe(fakeEmissive);
    expect(p.emissiveIntensity).toBe(0.3);
  });
  it('defaults emissiveIntensity to 0 when absent', () => {
    expect(toonParamsFromStandard({}).emissiveIntensity).toBe(0);
  });
});
