import { describe, it, expect } from 'vitest';
import { chirpArrivalDelays, judgeDelays, makeChirp, CAL_CHIRPS, CAL_TOLERANCE_SEC } from '@/lib/daw/dsp/calibration';
import { computeRecordOffsetSec } from '@/lib/daw/input-devices';

function place(dst: Float32Array, src: Float32Array, at: number): void {
  const i0 = Math.floor(at);
  const frac = at - i0;
  for (let i = 0; i < src.length; i++) {
    if (i0 + i < dst.length) dst[i0 + i] += src[i] * (1 - frac);
    if (i0 + i + 1 < dst.length) dst[i0 + i + 1] += src[i] * frac;
  }
}

describe('latency calibration', () => {
  it('finds a synthetic delay within 0.5 ms', () => {
    const sr = 48000;
    const chirp = makeChirp(sr);
    for (const delaySec of [0.005, 0.0104, 0.0235, 0.1]) {
      const recorded = new Float32Array(Math.ceil((delaySec + 0.2) * sr));
      place(recorded, chirp, delaySec * sr);
      const [delay] = chirpArrivalDelays(recorded, chirp, sr, [0], 0);
      expect(delay).not.toBeNull();
      expect(Math.abs((delay as number) - delaySec) * 1000).toBeLessThan(0.5);
    }
  });

  it('accepts 8 of 10 chirps within 2 ms and rejects a scattered set', () => {
    const sr = 48000;
    const chirp = makeChirp(sr);
    const delaySec = 0.02;
    const recorded = new Float32Array(Math.ceil(9 * sr));
    const plays: number[] = [];
    for (let i = 0; i < CAL_CHIRPS; i++) {
      const t = 0.2 + i * 0.75;
      plays.push(t);
      place(recorded, chirp, (t + delaySec) * sr);
    }
    const delays = chirpArrivalDelays(recorded, chirp, sr, plays, 0);
    const judged = judgeDelays(delays);
    expect(judged.ok).toBe(true);
    expect(judged.agree).toBeGreaterThanOrEqual(8);
    expect(Math.abs(judged.offsetSec - delaySec)).toBeLessThan(CAL_TOLERANCE_SEC);
    const scattered = judgeDelays([0.01, 0.02, 0.05, 0.08, 0.01, 0.04, null, null, null, null]);
    expect(scattered.ok).toBe(false);
    expect(computeRecordOffsetSec({ baseLatency: 0.01, outputLatency: 0.02, measuredSec: judged.offsetSec })).toBeCloseTo(judged.offsetSec, 5);
    expect(computeRecordOffsetSec({ measuredSec: 2 })).toBe(0.5);
  });
});
