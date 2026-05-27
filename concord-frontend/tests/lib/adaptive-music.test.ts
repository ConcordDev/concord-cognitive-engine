import { describe, it, expect } from 'vitest';
import { computeStemTargetGain, _testing, type StemName } from '@/lib/world-lens/adaptive-music';

describe('computeStemTargetGain', () => {
  it('combat_drum peaks when state.combat is 1', () => {
    const g = computeStemTargetGain('combat_drum', { combat: 1, tension: 0, revelation: 0, exploration: 0 });
    expect(g).toBeCloseTo(0.85, 2);
  });

  it('revelation_strings peaks when state.revelation is 1', () => {
    const g = computeStemTargetGain('revelation_strings', { combat: 0, tension: 0, revelation: 1, exploration: 0 });
    expect(g).toBeCloseTo(0.9, 2);
  });

  it('tension_pad responds to tension', () => {
    const g = computeStemTargetGain('tension_pad', { combat: 0, tension: 1, revelation: 0, exploration: 0 });
    expect(g).toBeCloseTo(0.85, 2);
  });

  it('ambient_bed strongest in exploration state', () => {
    const explore = computeStemTargetGain('ambient_bed', { combat: 0, tension: 0, revelation: 0, exploration: 1 });
    const combat = computeStemTargetGain('ambient_bed', { combat: 1, tension: 0, revelation: 0, exploration: 0 });
    expect(explore).toBeGreaterThan(combat);
  });

  it('combat_drum is silent during exploration', () => {
    const g = computeStemTargetGain('combat_drum', { combat: 0, tension: 0, revelation: 0, exploration: 1 });
    expect(g).toBe(0);
  });

  it('clamps to [0, 1]', () => {
    const g = computeStemTargetGain('combat_drum', { combat: 5, tension: 5, revelation: 5, exploration: 5 });
    expect(g).toBeLessThanOrEqual(1);
    expect(g).toBeGreaterThanOrEqual(0);
  });
});

describe('STATE_MATRIX shape', () => {
  it('has all 4 stems defined', () => {
    const names: StemName[] = ['ambient_bed', 'tension_pad', 'combat_drum', 'revelation_strings'];
    for (const n of names) {
      expect(_testing.STATE_MATRIX[n]).toBeDefined();
      expect(_testing.STATE_MATRIX[n].combat).toBeGreaterThanOrEqual(0);
      expect(_testing.STATE_MATRIX[n].tension).toBeGreaterThanOrEqual(0);
      expect(_testing.STATE_MATRIX[n].revelation).toBeGreaterThanOrEqual(0);
      expect(_testing.STATE_MATRIX[n].exploration).toBeGreaterThanOrEqual(0);
    }
  });

  it('combat_drum has dominant combat weight', () => {
    const m = _testing.STATE_MATRIX.combat_drum;
    expect(m.combat).toBeGreaterThan(m.tension);
    expect(m.combat).toBeGreaterThan(m.revelation);
    expect(m.combat).toBeGreaterThan(m.exploration);
  });

  it('revelation_strings has dominant revelation weight', () => {
    const m = _testing.STATE_MATRIX.revelation_strings;
    expect(m.revelation).toBeGreaterThan(m.combat);
    expect(m.revelation).toBeGreaterThan(m.tension);
    expect(m.revelation).toBeGreaterThan(m.exploration);
  });
});

describe('STEM_FALLBACK_FREQ', () => {
  it('has a distinct frequency per stem', () => {
    const freqs = new Set<number>();
    const names: StemName[] = ['ambient_bed', 'tension_pad', 'combat_drum', 'revelation_strings'];
    for (const n of names) {
      freqs.add(_testing.STEM_FALLBACK_FREQ[n].freq);
    }
    expect(freqs.size).toBe(4);
  });
});
