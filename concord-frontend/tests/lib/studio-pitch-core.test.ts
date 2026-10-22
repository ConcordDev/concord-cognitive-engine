import { describe, it, expect } from 'vitest';
import {
  yinDetect,
  snapHz,
  scaleMaskFor,
  pitchLatencySamples,
  processPitchSignal,
  PITCH_PRESETS,
  type PitchSettings,
} from '@/lib/daw/dsp/pitch/core';

const SR = 48000;

function sine(hz: number, n: number, vibratoCents = 0, vibratoHz = 0): Float32Array {
  const out = new Float32Array(n);
  let phase = 0;
  let vPhase = 0;
  for (let i = 0; i < n; i++) {
    const wobble = vibratoCents ? Math.pow(2, (vibratoCents / 1200) * Math.sin(vPhase)) : 1;
    const f = hz * wobble;
    out[i] = Math.sin(phase);
    phase += (2 * Math.PI * f) / SR;
    if (phase > Math.PI * 2) phase -= Math.PI * 2;
    vPhase += (2 * Math.PI * vibratoHz) / SR;
  }
  return out;
}

function saw(hz: number, n: number): Float32Array {
  const out = new Float32Array(n);
  let p = 0;
  const inc = hz / SR;
  for (let i = 0; i < n; i++) {
    out[i] = 2 * p - 1;
    p += inc;
    if (p >= 1) p -= 1;
  }
  return out;
}

function cents(actual: number, expected: number): number {
  return Math.abs(1200 * Math.log2(actual / expected));
}

function settings(over: Partial<PitchSettings> = {}): PitchSettings {
  return {
    sampleRate: SR,
    retuneMs: 0,
    humanize: 0,
    flexCents: 200,
    preserveVibrato: false,
    transpose: 0,
    mix: 1,
    mode: 'low',
    minHz: 70,
    maxHz: 1200,
    scaleMask: 0xfff,
    bypass: false,
    ...over,
  };
}

describe('YIN', () => {
  it('measures sine, saw, and vibrato within 5 cents from 80 to 1000 Hz', () => {
    for (const hz of [80, 220, 440, 1000]) {
      const s = yinDetect(sine(hz, 4096), SR, 60, 1400);
      expect(cents(s.hz, hz), `sine ${hz} -> ${s.hz}`).toBeLessThan(5);
      expect(s.confidence).toBeGreaterThan(0.5);
      const w = yinDetect(saw(hz, 4096), SR, 60, 1400);
      expect(cents(w.hz, hz), `saw ${hz} -> ${w.hz}`).toBeLessThan(5);
    }
    const vib = yinDetect(sine(440, 8192, 30, 5.5), SR, 60, 1400);
    expect(cents(vib.hz, 440)).toBeLessThan(40);
  });

  it('does not jump an octave when a second harmonic is present', () => {
    const n = 8192;
    const mix = new Float32Array(n);
    const a = sine(200, n);
    const b = sine(400, n);
    for (let i = 0; i < n; i++) mix[i] = a[i] + 0.65 * b[i];
    const found = yinDetect(mix, SR, 60, 1400);
    expect(cents(found.hz, 200)).toBeLessThan(5);
  });
});

describe('scale snap', () => {
  it('snaps to the project key and treats an unknown scale as chromatic', () => {
    const cMajor = scaleMaskFor('C', 'major');
    expect(cMajor.known).toBe(true);
    expect(snapHz(445, cMajor.mask, 0)).toBeCloseTo(440, 0);
    const unknown = scaleMaskFor('C', 'custom-mask');
    expect(unknown.known).toBe(false);
    expect(snapHz(445, unknown.mask, 0)).toBeCloseTo(440, 0);
    expect(snapHz(440, cMajor.mask, 2)).toBeCloseTo(493.88, 0);
  });
});

describe('Pitch Correct processor', () => {
  it('reports a latency that matches the impulse offset at ratio 1', () => {
    const s = settings({ mix: 0 });
    const latency = pitchLatencySamples(SR, s.minHz, s.mode);
    const n = latency + 64;
    const input = new Float32Array(n);
    input[0] = 1;
    const { output, latency: reported } = processPitchSignal(input, s);
    expect(reported).toBe(latency);
    let peak = 0;
    let at = 0;
    for (let i = 0; i < output.length; i++) if (Math.abs(output[i]) > peak) { peak = Math.abs(output[i]); at = i; }
    expect(at).toBe(latency);
  });

  it('pulls a 445 Hz sine to the nearest chromatic note', () => {
    const n = SR;
    const { output, latency } = processPitchSignal(sine(445, n), settings({ retuneMs: 0, flexCents: 200 }));
    const slice = output.subarray(latency + 8000, latency + 16000);
    const found = yinDetect(slice, SR, 60, 1400);
    expect(cents(found.hz, 440)).toBeLessThan(5);
  });

  it('leaves notes outside the flex window dry', () => {
    const n = SR;
    const { output, latency } = processPitchSignal(sine(445, n), settings({ retuneMs: 0, flexCents: 5 }));
    const slice = output.subarray(latency + 8000, latency + 16000);
    const found = yinDetect(slice, SR, 60, 1400);
    expect(cents(found.hz, 445)).toBeLessThan(5);
  });

  it('is deterministic', () => {
    const input = sine(445, 16000);
    const a = processPitchSignal(input, settings());
    const b = processPitchSignal(input, settings());
    expect(a.latency).toBe(b.latency);
    expect(Array.from(a.output.subarray(0, 1000))).toEqual(Array.from(b.output.subarray(0, 1000)));
  });

  it('names the two vocal presets without a vendor mark', () => {
    expect(PITCH_PRESETS.map((p) => p.name)).toEqual(['Rap vocal: hard tune', 'R&B vocal: natural tune']);
    const blob = JSON.stringify(PITCH_PRESETS).toLowerCase();
    expect(blob).not.toMatch(/auto-?tune|melodyne|flex pitch|elastic/);
  });
});
