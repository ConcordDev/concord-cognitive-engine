// Evo-sound — bounded audio-refinement passes + interaction fitness.
import { describe, it, expect } from 'vitest';
import { enrichDirective, passesUpTo, soundFitness, MAX_AUDIO_PASS } from '@/lib/concordia/evo-sound';

const base = { layer: 'explosion' as const, gain: 0.8, freqHz: 60, waveform: 'sine' as const };

describe('enrichDirective', () => {
  it('level 0 leaves the base untouched (a never-interacted sound)', () => {
    const e = enrichDirective(base, 0);
    expect(e.subLayer).toBeUndefined();
    expect(e.gain).toBe(0.8);
  });

  it('passes accrue cumulatively with level', () => {
    expect(enrichDirective(base, 1).subLayer).toBe(true);
    const l3 = enrichDirective(base, 3);
    expect(l3.transient).toBe(true);
    expect(l3.harmonics).toBeGreaterThan(0);
    expect(l3.reverbTailMs).toBeUndefined(); // not yet
    const l5 = enrichDirective(base, 5);
    expect(l5.reverbTailMs).toBeGreaterThan(0);
    expect(l5.variationSeed).toBeDefined();
  });

  it('cannot over-cook past MAX_AUDIO_PASS', () => {
    expect(enrichDirective(base, 99)).toEqual(enrichDirective(base, MAX_AUDIO_PASS));
  });

  it('passesUpTo lists the cumulative enrichments', () => {
    expect(passesUpTo(2)).toEqual(['sub_layer', 'transient']);
  });
});

describe('soundFitness', () => {
  it('recent interactions outweigh old ones (2-week half-life)', () => {
    const now = Date.now();
    const recent = soundFitness([{ at: now }, { at: now }], now);
    const stale = soundFitness([{ at: now - 28 * 24 * 3600 * 1000 }, { at: now - 28 * 24 * 3600 * 1000 }], now);
    expect(recent).toBeGreaterThan(stale);
    expect(soundFitness([], now)).toBe(0);
  });
});
