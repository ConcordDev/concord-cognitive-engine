// tests/lib/daw-audio-buffer-edit.test.ts
//
// Pins the real PCM edit math behind the Studio AudioEditor (previously
// dead UI — `onOperation={() => {}}` and a buffer that was never
// populated). Every assertion here operates on actual Float32Array sample
// data, not fabricated numbers: cut/delete genuinely shrink the buffer by
// the selected sample count, paste genuinely grows it, fade/normalize/
// reverse genuinely transform the samples.
import { describe, it, expect } from 'vitest';
import {
  computeWaveformPeaks,
  applyAudioEditOperation,
  encodeDAWBufferToWavBlob,
} from '../../lib/daw/audio-buffer-edit';
import type { AudioBuffer as DAWAudioBuffer } from '../../lib/daw/types';

function makeBuffer(samples: number[], sampleRate = 8): DAWAudioBuffer {
  const data = Float32Array.from(samples);
  return {
    id: 'buf_test',
    name: 'test',
    sampleRate,
    duration: samples.length / sampleRate,
    channels: 1,
    waveformPeaks: computeWaveformPeaks([data]),
    channelData: [data],
  };
}

describe('computeWaveformPeaks', () => {
  it('returns an empty array for empty channel data', () => {
    expect(computeWaveformPeaks([])).toEqual([]);
    expect(computeWaveformPeaks([new Float32Array(0)])).toEqual([]);
  });

  it('buckets real samples into per-bucket max |sample| peaks', () => {
    const data = Float32Array.from([0, 0.2, -0.9, 0.1, 0.05, -0.05, 0.99, -0.99]);
    const peaks = computeWaveformPeaks([data], 4);
    expect(peaks).toHaveLength(4);
    // bucket 0: [0, 0.2] -> 0.2 ; bucket 1: [-0.9, 0.1] -> 0.9
    expect(peaks[0]).toBeCloseTo(0.2, 5);
    expect(peaks[1]).toBeCloseTo(0.9, 5);
    expect(peaks[3]).toBeCloseTo(0.99, 5);
  });

  it('clamps peaks to 1.0 even for out-of-range samples', () => {
    const data = Float32Array.from([2.5, -3, 0]);
    const peaks = computeWaveformPeaks([data], 1);
    expect(peaks[0]).toBe(1);
  });
});

describe('applyAudioEditOperation — real sample manipulation', () => {
  it('no-ops (same buffer reference) with an honest reason when there is no channelData', () => {
    const buffer: DAWAudioBuffer = { id: 'b', name: 'n', sampleRate: 8, duration: 1, channels: 1, waveformPeaks: [] };
    const result = applyAudioEditOperation(buffer, { type: 'normalize' }, null, null, 0);
    expect(result.buffer).toBe(buffer);
    expect(result.summary).toMatch(/no decoded audio/i);
  });

  it('cut removes exactly the selected samples and shrinks duration', () => {
    // 8 samples @ 8Hz = 1s. Select [0.25, 0.5) -> samples [2,4).
    const buffer = makeBuffer([0, 1, 2, 3, 4, 5, 6, 7]);
    const result = applyAudioEditOperation(buffer, { type: 'cut' }, { start: 0.25, end: 0.5 }, null, 0);
    expect(result.buffer).not.toBe(buffer);
    expect(Array.from(result.buffer.channelData![0])).toEqual([0, 1, 4, 5, 6, 7]);
    expect(result.buffer.duration).toBeCloseTo(6 / 8, 6);
    expect(result.clipboard![0]).toEqual(Float32Array.from([2, 3]));
  });

  it('cut with no selection is a real no-op, not a fabricated success', () => {
    const buffer = makeBuffer([0, 1, 2, 3]);
    const result = applyAudioEditOperation(buffer, { type: 'cut' }, null, null, 0);
    expect(result.buffer).toBe(buffer);
    expect(result.clipboard).toBeUndefined();
    expect(result.summary).toMatch(/select a range/i);
  });

  it('delete removes the selection without populating the clipboard', () => {
    const buffer = makeBuffer([0, 1, 2, 3, 4, 5, 6, 7]);
    const result = applyAudioEditOperation(buffer, { type: 'delete' }, { start: 0.25, end: 0.5 }, null, 0);
    expect(Array.from(result.buffer.channelData![0])).toEqual([0, 1, 4, 5, 6, 7]);
    expect(result.clipboard).toBeUndefined();
  });

  it('copy leaves the buffer untouched but fills the clipboard', () => {
    const buffer = makeBuffer([0, 1, 2, 3, 4, 5, 6, 7]);
    const result = applyAudioEditOperation(buffer, { type: 'copy' }, { start: 0.25, end: 0.5 }, null, 0);
    expect(result.buffer).toBe(buffer);
    expect(result.clipboard![0]).toEqual(Float32Array.from([2, 3]));
  });

  it('paste with an empty clipboard is an honest no-op', () => {
    const buffer = makeBuffer([0, 1, 2, 3]);
    const result = applyAudioEditOperation(buffer, { type: 'paste' }, null, null, 0);
    expect(result.buffer).toBe(buffer);
    expect(result.summary).toMatch(/clipboard is empty/i);
  });

  it('paste inserts the real clipboard samples at the playhead position', () => {
    const buffer = makeBuffer([0, 1, 2, 3]);
    const clipboard = [Float32Array.from([9, 9])];
    // insertAtNormalized 0.5 of 4 samples -> insert at sample index 2
    const result = applyAudioEditOperation(buffer, { type: 'paste' }, null, clipboard, 0.5);
    expect(Array.from(result.buffer.channelData![0])).toEqual([0, 1, 9, 9, 2, 3]);
    expect(result.buffer.duration).toBeCloseTo(6 / 8, 6);
  });

  it('fadeIn ramps the selection from 0 to the original sample linearly', () => {
    const buffer = makeBuffer([1, 1, 1, 1]);
    const result = applyAudioEditOperation(buffer, { type: 'fadeIn' }, null, null, 0);
    const out = result.buffer.channelData![0];
    expect(out[0]).toBeCloseTo(0, 5);
    expect(out[3]).toBeCloseTo(0.75, 5); // (3-0)/4
  });

  it('fadeOut ramps the selection from the original sample to 0', () => {
    const buffer = makeBuffer([1, 1, 1, 1]);
    const result = applyAudioEditOperation(buffer, { type: 'fadeOut' }, null, null, 0);
    const out = result.buffer.channelData![0];
    expect(out[0]).toBeCloseTo(1, 5);
    expect(out[3]).toBeCloseTo(0.25, 5); // 1 - 3/4
  });

  it('normalize scales the true peak to -0.1 dBFS (0.9886) without distorting relative levels', () => {
    const buffer = makeBuffer([0.1, -0.2, 0.4, -0.4]); // peak = 0.4
    const result = applyAudioEditOperation(buffer, { type: 'normalize' }, null, null, 0);
    const out = result.buffer.channelData![0];
    const gain = 0.9886 / 0.4;
    expect(out[0]).toBeCloseTo(0.1 * gain, 4);
    expect(out[2]).toBeCloseTo(0.4 * gain, 4);
    let peak = 0;
    for (const v of out) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeCloseTo(0.9886, 4);
  });

  it('normalize on a silent buffer is an honest no-op', () => {
    const buffer = makeBuffer([0, 0, 0, 0]);
    const result = applyAudioEditOperation(buffer, { type: 'normalize' }, null, null, 0);
    expect(result.buffer).toBe(buffer);
    expect(result.summary).toMatch(/silent/i);
  });

  it('reverse actually reverses the sample order over the selection', () => {
    const buffer = makeBuffer([1, 2, 3, 4]);
    const result = applyAudioEditOperation(buffer, { type: 'reverse' }, null, null, 0);
    expect(Array.from(result.buffer.channelData![0])).toEqual([4, 3, 2, 1]);
  });

  it('reverse over a partial selection only reverses that range', () => {
    const buffer = makeBuffer([1, 2, 3, 4, 5, 6, 7, 8]);
    // select [0.25, 0.75) -> samples [2,6)
    const result = applyAudioEditOperation(buffer, { type: 'reverse' }, { start: 0.25, end: 0.75 }, null, 0);
    expect(Array.from(result.buffer.channelData![0])).toEqual([1, 2, 6, 5, 4, 3, 7, 8]);
  });
});

describe('encodeDAWBufferToWavBlob', () => {
  it('produces a real 44-byte-header WAV blob sized from the actual sample count', () => {
    const buffer = makeBuffer([0, 0.5, -0.5, 1], 8);
    const blob = encodeDAWBufferToWavBlob(buffer);
    expect(blob.type).toBe('audio/wav');
    // 44-byte header + 4 samples * 1 channel * 2 bytes/sample
    expect(blob.size).toBe(44 + 4 * 2);
  });

  it('round-trips real sample values through 16-bit PCM (within quantization error)', async () => {
    const buffer = makeBuffer([0.5, -0.5, 0.25], 8);
    const blob = encodeDAWBufferToWavBlob(buffer);
    // jsdom's Blob polyfill doesn't reliably implement .arrayBuffer()/Response
    // read-back; FileReader is the one path jsdom implements faithfully.
    const arrayBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as ArrayBuffer);
      fr.onerror = () => reject(fr.error);
      fr.readAsArrayBuffer(blob);
    });
    const bytes = new Uint8Array(arrayBuffer);
    const view = new DataView(bytes.buffer);
    const s0 = view.getInt16(44, true) / 0x7fff;
    const s1 = view.getInt16(46, true) / 0x8000;
    expect(s0).toBeCloseTo(0.5, 3);
    expect(s1).toBeCloseTo(-0.5, 3);
  });
});
