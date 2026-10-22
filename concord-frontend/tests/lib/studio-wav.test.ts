import { describe, it, expect } from 'vitest';
import { encodeWav, encodeWavBlob, readWavHeader } from '@/lib/daw/wav';

describe('encodeWav (RIFF WAV encoder)', () => {
  const sr = 48000;
  const left = new Float32Array([0, 0.5, -0.5, 1, -1, 2]);
  const right = new Float32Array([0, -0.25, 0.25, 0, 0, 0]);

  it('writes a valid 24-bit stereo PCM header', () => {
    const buf = encodeWav([left, right], sr, { bitDepth: 24 });
    const h = readWavHeader(buf);
    expect(h).toMatchObject({ format: 1, channels: 2, sampleRate: sr, bitDepth: 24, frames: left.length });
    expect(buf.byteLength).toBe(44 + left.length * 2 * 3);
    const v = new DataView(buf);
    expect(v.getUint32(4, true)).toBe(buf.byteLength - 8);
    expect(v.getUint32(28, true)).toBe(sr * 2 * 3);
  });

  it('encodes 16-bit samples with clamping and correct sign', () => {
    const buf = encodeWav([left], sr, { bitDepth: 16 });
    const v = new DataView(buf);
    const s = (i: number) => v.getInt16(44 + i * 2, true);
    expect(s(0)).toBe(0);
    expect(s(1)).toBe(Math.round(0.5 * 0x7fff));
    expect(s(2)).toBe(Math.round(-0.5 * 0x8000));
    expect(s(3)).toBe(0x7fff);
    expect(s(4)).toBe(-0x8000);
    expect(s(5)).toBe(0x7fff); // 2.0 clamps
  });

  it('encodes 24-bit little-endian samples', () => {
    const buf = encodeWav([new Float32Array([1, -1])], sr, { bitDepth: 24 });
    const b = new Uint8Array(buf, 44);
    expect([b[0], b[1], b[2]]).toEqual([0xff, 0xff, 0x7f]);
    expect([b[3], b[4], b[5]]).toEqual([0x00, 0x00, 0x80]);
  });

  it('writes IEEE float for 32-bit', () => {
    const buf = encodeWav([new Float32Array([0.25])], sr, { bitDepth: 32 });
    expect(readWavHeader(buf).format).toBe(3);
    expect(new DataView(buf).getFloat32(44, true)).toBeCloseTo(0.25);
  });

  it('pads shorter channels with silence and rejects bad input', () => {
    const buf = encodeWav([new Float32Array(4), new Float32Array(2)], sr, { bitDepth: 16 });
    expect(readWavHeader(buf).frames).toBe(4);
    expect(() => encodeWav([], sr)).toThrow();
    expect(() => encodeWav([left], 0)).toThrow();
  });

  it('produces an audio/wav blob', () => {
    const b = encodeWavBlob([left], sr);
    expect(b.type).toBe('audio/wav');
    expect(b.size).toBe(44 + left.length * 3);
  });
});
