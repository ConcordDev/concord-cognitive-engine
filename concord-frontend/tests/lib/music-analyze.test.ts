// Upload analysis is measured, not guessed: tempo from real beats, key from
// real harmony, loudness by BS.1770 — and null when there is nothing to measure.
import { describe, it, expect } from 'vitest';
import { analyzeTrack, estimateTempo } from '@/lib/music/analyze';
import { integratedLoudness } from '@/lib/daw/dsp/loudness';

const SR = 22050;

/** A kick-and-hat loop at `bpm`: decaying 60 Hz thumps on beats, short noise ticks on off-beats. */
function beat(bpm: number, seconds: number, seed = 1): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR));
  const spb = (60 / bpm) * SR;
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647 - 0.5; };
  for (let b = 0; b * spb < out.length; b++) {
    const k = Math.round(b * spb);
    for (let i = 0; i < 0.18 * SR && k + i < out.length; i++) out[k + i] += 0.8 * Math.exp(-i / (0.05 * SR)) * Math.sin((2 * Math.PI * 60 * i) / SR);
    const h = Math.round((b + 0.5) * spb);
    for (let i = 0; i < 0.03 * SR && h + i < out.length; i++) out[h + i] += 0.25 * Math.exp(-i / (0.008 * SR)) * rnd();
  }
  return out;
}

/** Sustained triads of C major (C–F–G–C), no drums. */
function chords(seconds: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR));
  const prog = [[60, 64, 67], [65, 69, 72], [67, 71, 74], [60, 64, 67]];
  const seg = out.length / prog.length;
  prog.forEach((triad, ci) => {
    for (let i = Math.floor(ci * seg); i < Math.floor((ci + 1) * seg); i++) {
      let v = 0;
      for (const m of triad) v += Math.sin((2 * Math.PI * 440 * Math.pow(2, (m - 69) / 12) * i) / SR);
      out[i] = 0.15 * v;
    }
  });
  return out;
}

describe('tempo', () => {
  for (const bpm of [84, 96, 120, 128, 140, 174]) {
    it(`finds ${bpm} BPM within 1 BPM (or its octave for drum & bass)`, () => {
      const r = estimateTempo(beat(bpm, 20), SR);
      expect(r.bpm).not.toBeNull();
      const got = r.bpm!;
      // 174 is often heard as 87 (half-time); either octave is an honest reading.
      const ok = Math.abs(got - bpm) <= 1 || (bpm > 160 && Math.abs(got - bpm / 2) <= 1);
      expect(ok, `${bpm} → ${got}`).toBe(true);
    });
  }

  it('returns null for silence, steady tones and too-short clips', () => {
    expect(estimateTempo(new Float32Array(SR * 10), SR).bpm).toBeNull();
    expect(estimateTempo(chords(12), SR).bpm).toBeNull();
    expect(estimateTempo(beat(120, 2), SR).bpm).toBeNull();
  });
});

describe('analyzeTrack', () => {
  it('reports key and loudness from the audio itself', () => {
    const x = chords(12);
    const a = analyzeTrack([x], SR);
    expect(a.key === 'C major' || a.key === 'A minor').toBe(true);
    expect(a.lufs).toBe(Math.round(integratedLoudness([x], SR) * 10) / 10);
    expect(a.durationSec).toBe(12);
  });

  it('silence has no key, no tempo and no loudness', () => {
    const a = analyzeTrack([new Float32Array(SR * 6)], SR);
    expect(a).toEqual({ bpm: null, key: null, lufs: null, durationSec: 6 });
  });
});
