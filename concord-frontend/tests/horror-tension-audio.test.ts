// E2 — horror tension audio param mapping (pure, headless).
import { describe, it, expect } from 'vitest';
import { tensionStemParams, ghostStepParams, ghostStepWorldPos } from '@/lib/audio/horror-tension';

describe('tensionStemParams', () => {
  it('calm is silent + inactive', () => {
    const p = tensionStemParams('calm', 0.9);
    expect(p.active).toBe(false);
    expect(p.gain).toBe(0);
  });

  it('tension is a soft active drone that rises with dread', () => {
    const lo = tensionStemParams('tension', 0.35);
    const hi = tensionStemParams('tension', 0.75);
    expect(lo.active).toBe(true);
    expect(hi.gain).toBeGreaterThan(lo.gain);
    expect(hi.dissonance).toBeGreaterThan(lo.dissonance);
  });

  it('terror is louder + brighter + more dissonant than tension', () => {
    const tension = tensionStemParams('tension', 0.7);
    const terror = tensionStemParams('terror', 0.7);
    expect(terror.gain).toBeGreaterThan(tension.gain);
    expect(terror.filterHz).toBeGreaterThan(tension.filterHz);
    expect(terror.dissonance).toBeGreaterThan(tension.dissonance);
  });
});

describe('ghostStepParams', () => {
  it('silent beyond the audible radius or with null distance', () => {
    expect(ghostStepParams(null).shouldPlay).toBe(false);
    expect(ghostStepParams(100).shouldPlay).toBe(false);
  });

  it('plays faster + louder as the ghost closes in', () => {
    const far = ghostStepParams(20);
    const near = ghostStepParams(3);
    expect(far.shouldPlay).toBe(true);
    expect(near.shouldPlay).toBe(true);
    expect(near.intervalMs).toBeLessThan(far.intervalMs); // faster cadence up close
    expect(near.volume).toBeGreaterThan(far.volume);
  });
});

describe('ghostStepWorldPos', () => {
  it('passes through a valid ghost position', () => {
    expect(ghostStepWorldPos({ x: 5, y: 0, z: -3 })).toEqual({ x: 5, y: 0, z: -3 });
  });
  it('returns null for missing/invalid', () => {
    expect(ghostStepWorldPos(null)).toBe(null);
    expect(ghostStepWorldPos(undefined)).toBe(null);
  });
});
