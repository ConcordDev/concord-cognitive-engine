import { describe, it, expect } from 'vitest';
import { encodeWav, _internal } from '@/lib/daw/audio-logger';

describe('encodeWav', () => {
  it('produces a Blob with audio/wav MIME and 44-byte header', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const blob = encodeWav(samples, 22050);
    expect(blob.type).toBe('audio/wav');
    expect(blob.size).toBe(44 + samples.length * 2);
  });

  it('blob size scales with sample count', () => {
    const oneSample = encodeWav(new Float32Array([0]), 22050);
    const tenSamples = encodeWav(new Float32Array(10).fill(0), 22050);
    expect(tenSamples.size - oneSample.size).toBe((10 - 1) * 2);
  });

  it('produces correctly sized header + body for varying sample rates', () => {
    const a = encodeWav(new Float32Array(100), 22050);
    const b = encodeWav(new Float32Array(100), 48000);
    // Sample rate doesn't affect byte count — only sample count does.
    expect(a.size).toBe(b.size);
  });
});

describe('downsample', () => {
  it('passes through when in==out rate', () => {
    const input = new Float32Array([0, 0.5, 1, -0.5]);
    const out = _internal.downsample(input, 22050, 22050);
    expect(out).toBe(input);
  });

  it('halves the length for 44.1k → 22.05k', () => {
    const input = new Float32Array(2048).fill(0.5);
    const out = _internal.downsample(input, 44100, 22050);
    expect(out.length).toBeCloseTo(input.length / 2, -1);
  });

  it('preserves DC level on constant signal', () => {
    const input = new Float32Array(2048).fill(0.42);
    const out = _internal.downsample(input, 48000, 22050);
    const mean = out.reduce((s, x) => s + x, 0) / out.length;
    expect(mean).toBeCloseTo(0.42, 2);
  });
});

describe('AudioLogger constants', () => {
  it('exposes sane ring buffer params', () => {
    expect(_internal.CHUNK_SEC).toBeGreaterThan(0);
    expect(_internal.RING_MAX_CHUNKS).toBeGreaterThan(0);
    expect(_internal.RING_MAX_CHUNKS * _internal.CHUNK_SEC).toBeGreaterThanOrEqual(60);
    expect(_internal.DOWNSAMPLE_RATE).toBeLessThan(48000);
  });
});
