import { describe, it, expect } from 'vitest';
import { extractChroma, matchChroma, analyzeSnapshot, _internal } from '@/lib/daw/chord-detect';

const SR = 22050;

function tone(freqHz: number, durSec: number, amp = 0.5): Float32Array {
  const n = Math.round(SR * durSec);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = amp * Math.sin((2 * Math.PI * freqHz * i) / SR);
  }
  return out;
}

function mixTones(freqs: number[], durSec: number, amp = 0.5): Float32Array {
  const n = Math.round(SR * durSec);
  const out = new Float32Array(n);
  for (const f of freqs) {
    for (let i = 0; i < n; i++) {
      out[i] += amp * Math.sin((2 * Math.PI * f * i) / SR);
    }
  }
  // Normalise to ±1.
  let max = 0;
  for (let i = 0; i < n; i++) if (Math.abs(out[i]) > max) max = Math.abs(out[i]);
  if (max > 0) for (let i = 0; i < n; i++) out[i] /= max;
  return out;
}

describe('extractChroma', () => {
  it('returns 12 bins normalised to [0..1]', () => {
    const chroma = extractChroma(tone(440, 1), SR);
    expect(chroma).toHaveLength(12);
    for (const v of chroma) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('peaks on A for a 440Hz sine', () => {
    const chroma = extractChroma(tone(440, 1), SR);
    // A4 = MIDI 69 = pitch-class 9
    const maxIdx = chroma.indexOf(Math.max(...chroma));
    expect(maxIdx).toBe(9);
  });

  it('returns all zeros for silence', () => {
    const silence = new Float32Array(2048);
    const chroma = extractChroma(silence, SR);
    expect(chroma.every(v => v === 0)).toBe(true);
  });
});

describe('matchChroma', () => {
  it('returns top-3 candidates sorted by confidence', () => {
    const chroma = extractChroma(mixTones([261.63, 329.63, 392.0], 1), SR); // C4, E4, G4 = Cmaj
    const c = matchChroma(chroma);
    expect(c).toHaveLength(3);
    for (let i = 1; i < c.length; i++) {
      expect(c[i - 1].confidence).toBeGreaterThanOrEqual(c[i].confidence);
    }
  });

  it('top candidate for C major triad is Cmaj', () => {
    const chroma = extractChroma(mixTones([261.63, 329.63, 392.0], 1), SR);
    const [top] = matchChroma(chroma);
    expect(top.name).toBe('Cmaj');
    expect(top.confidence).toBeGreaterThan(0.5);
  });

  it('top candidate for A minor triad is Amin', () => {
    // A3=220, C4=261.63, E4=329.63
    const chroma = extractChroma(mixTones([220, 261.63, 329.63], 1), SR);
    const [top] = matchChroma(chroma);
    expect(top.name).toBe('Amin');
  });

  it('top candidate for G major triad is Gmaj', () => {
    // G3=196, B3=246.94, D4=293.66
    const chroma = extractChroma(mixTones([196, 246.94, 293.66], 1), SR);
    const [top] = matchChroma(chroma);
    expect(top.name).toBe('Gmaj');
  });
});

describe('analyzeSnapshot', () => {
  it('returns empty array for empty input', () => {
    expect(analyzeSnapshot(new Float32Array(0), SR)).toEqual([]);
  });
});

describe('internal templates', () => {
  it('exports 24 templates (12 maj + 12 min)', () => {
    expect(_internal.ALL_TEMPLATES).toHaveLength(24);
    const majors = _internal.ALL_TEMPLATES.filter(t => t.quality === 'maj');
    const minors = _internal.ALL_TEMPLATES.filter(t => t.quality === 'min');
    expect(majors).toHaveLength(12);
    expect(minors).toHaveLength(12);
  });

  it('major template rotated by 0 starts at root', () => {
    expect(_internal.rotate(_internal.MAJOR_TEMPLATE, 0)[0]).toBe(1);
  });

  it('cosine of identical vectors is 1', () => {
    expect(_internal.cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 5);
  });

  it('cosine of zero vector is 0', () => {
    expect(_internal.cosine([0, 0, 0], [1, 2, 3])).toBe(0);
  });
});
