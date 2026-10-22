import { describe, it, expect } from 'vitest';
import { integratedLoudness, loudnessRange, truePeak, measureLoudness, linToDb, rmsDbfs } from '@/lib/daw/dsp/loudness';
import { limitTruePeak, masterToTarget } from '@/lib/daw/dsp/limiter';

const sine = (freq: number, dbfs: number, sec: number, sr: number, phase = 0) => {
  const a = Math.pow(10, dbfs / 20);
  const n = Math.round(sec * sr);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = a * Math.sin((2 * Math.PI * freq * i) / sr + phase);
  return x;
};

describe('BS.1770 loudness (EBU Tech 3341/3342 reference signals)', () => {
  for (const sr of [44100, 48000]) {
    it(`1 kHz stereo sine at -23 dBFS reads -23.0 LUFS ±0.1 @ ${sr}`, () => {
      const s = sine(1000, -23, 20, sr);
      expect(integratedLoudness([s, s], sr)).toBeCloseTo(-23, 1);
    });
  }

  it('1 kHz stereo sine at -33 dBFS reads -33.0 LUFS ±0.1', () => {
    const s = sine(1000, -33, 20, 48000);
    expect(Math.abs(integratedLoudness([s, s], 48000) + 33)).toBeLessThan(0.1);
  });

  it('gates silence: 10 s tone + 10 s silence still reads the tone level', () => {
    const sr = 48000;
    const tone = sine(1000, -23, 10, sr);
    const x = new Float32Array(sr * 20);
    x.set(tone, 0);
    expect(Math.abs(integratedLoudness([x, x], sr) + 23)).toBeLessThan(0.15);
  });

  it('EBU 3342 case 1: 20 s at -20 then 20 s at -30 LUFS gives LRA 10 ±1', () => {
    const sr = 48000;
    const a = sine(1000, -20, 20, sr);
    const b = sine(1000, -30, 20, sr);
    const x = new Float32Array(a.length + b.length);
    x.set(a, 0);
    x.set(b, a.length);
    const lra = loudnessRange([x, x], sr);
    expect(Math.abs(lra - 10)).toBeLessThan(1);
  });

  it('true peak catches inter-sample peaks (fs/4 sine at 45° has sample peak -3 dB, true peak 0 dB)', () => {
    const sr = 48000;
    const x = sine(sr / 4, 0, 1, sr, Math.PI / 4);
    let sp = 0;
    for (const v of x) sp = Math.max(sp, Math.abs(v));
    expect(linToDb(sp)).toBeCloseTo(-3.01, 1);
    expect(Math.abs(linToDb(truePeak([x])))).toBeLessThan(0.3);
  });

  it('measureLoudness returns all metrics', () => {
    const s = sine(1000, -23, 5, 48000);
    const r = measureLoudness([s, s], 48000);
    expect(r.integratedLufs).toBeCloseTo(-23, 0);
    expect(r.truePeakDbtp).toBeLessThan(-22.5);
    expect(r.lra).toBeGreaterThanOrEqual(0);
  });

  it('rmsDbfs of a full-scale sine is -3 dBFS', () => {
    expect(rmsDbfs([sine(1000, 0, 1, 44100)])).toBeCloseTo(-3.01, 1);
  });
});

describe('look-ahead true-peak limiter', () => {
  it('holds the ceiling on a +6 dB hot signal', () => {
    const sr = 48000;
    const x = sine(997, 6, 2, sr);
    const y = sine(1503, 4, 2, sr);
    const out = limitTruePeak([x, y], sr, { ceilingDb: -1 });
    expect(linToDb(truePeak(out.channels))).toBeLessThanOrEqual(-1 + 1e-3);
    expect(out.maxReductionDb).toBeGreaterThan(6);
  });

  it('leaves quiet audio untouched', () => {
    const sr = 48000;
    const x = sine(440, -12, 0.5, sr);
    const out = limitTruePeak([x], sr, { ceilingDb: -1 });
    for (let i = 0; i < x.length; i += 997) expect(out.channels[0][i]).toBeCloseTo(x[i], 6);
  });

  it('catches a single transient spike', () => {
    const sr = 48000;
    const x = sine(220, -20, 1, sr);
    x[24000] = 1.8;
    const out = limitTruePeak([x], sr, { ceilingDb: -0.3 });
    expect(linToDb(truePeak(out.channels))).toBeLessThanOrEqual(-0.3 + 1e-3);
  });

  it('masterToTarget lands within 1 LU of -14 LUFS and under -1 dBTP', () => {
    const sr = 44100;
    const a = sine(110, -20, 8, sr);
    const b = sine(880, -26, 8, sr);
    const mix = a.map((v, i) => v + b[i]);
    const res = masterToTarget([mix, mix], sr, { lufs: -14, ceilingDb: -1 });
    expect(Math.abs(res.report.integratedLufs + 14)).toBeLessThan(1);
    expect(res.report.truePeakDbtp).toBeLessThanOrEqual(-1 + 1e-3);
  });
});
