// Track 1 — adaptive music. Pins the pure mode recolor the SoundscapeEngine
// chord scheduler now consumes: minor flattens the major-quality degrees,
// major raises the minor ones, neutral is identity, roots/4ths/5ths never move,
// and combat intensity maps to a mode.
//
// Run: npx vitest run tests/music-mode.test.ts

import { describe, it, expect } from 'vitest';
import { recolorChord, recolorSemitone, modeForIntensity } from '../lib/concordia/music-mode';

describe('recolorChord', () => {
  it('darkens a major triad to minor', () => {
    expect(recolorChord([0, 4, 7], 'minor')).toEqual([0, 3, 7]);
  });

  it('brightens a minor triad to major', () => {
    expect(recolorChord([0, 3, 7], 'major')).toEqual([0, 4, 7]);
  });

  it('is identity in neutral', () => {
    expect(recolorChord([0, 4, 7, 11], 'neutral')).toEqual([0, 4, 7, 11]);
  });

  it('leaves roots, 4ths, and 5ths alone', () => {
    // 0=root, 5=4th, 7=5th stay; only the colour tones move.
    expect(recolorChord([0, 5, 7], 'minor')).toEqual([0, 5, 7]);
    expect(recolorChord([0, 5, 7], 'major')).toEqual([0, 5, 7]);
  });

  it('recolors major 6th and 7th to minor', () => {
    // pc 9 (M6) → 8, pc 11 (M7) → 10
    expect(recolorChord([0, 4, 7, 9, 11], 'minor')).toEqual([0, 3, 7, 8, 10]);
  });

  it('works octave-agnostically via pitch class', () => {
    // 16 = pc 4 (major third up an octave) → 15
    expect(recolorSemitone(16, 'minor')).toBe(15);
  });

  it('returns a new array (pure)', () => {
    const src = [0, 4, 7];
    const out = recolorChord(src, 'minor');
    expect(out).not.toBe(src);
    expect(src).toEqual([0, 4, 7]);
  });
});

describe('modeForIntensity', () => {
  it('stays neutral when calm and darkens under tension', () => {
    expect(modeForIntensity(0)).toBe('neutral');
    expect(modeForIntensity(0.4)).toBe('neutral');
    expect(modeForIntensity(0.6)).toBe('minor');
    expect(modeForIntensity(1)).toBe('minor');
  });
});
