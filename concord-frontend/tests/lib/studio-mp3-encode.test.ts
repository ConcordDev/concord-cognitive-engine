import { describe, expect, it } from 'vitest';
import { encodeMp3, inspectMp3, MP3_VBR_SUPPORTED } from '@/lib/daw/mp3-encode';

describe('studio mp3 export', () => {
  it('encodes a 1 second sine as stereo MPEG-1 Layer III with ID3 tags', async () => {
    const sampleRate = 44100;
    const n = sampleRate;
    const left = new Float32Array(n);
    const right = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const s = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.4;
      left[i] = s;
      right[i] = s * 0.8;
    }
    const bytes = await encodeMp3({
      channels: [left, right],
      sampleRate,
      bitrate: 320,
      tags: { title: 'Sine', artist: 'Concord', bpm: 120, key: 'C minor' },
    });
    expect(bytes[0]).toBe(0x49);
    expect(bytes[1]).toBe(0x44);
    expect(bytes[2]).toBe(0x33);
    const info = inspectMp3(bytes);
    expect(info.hasId3).toBe(true);
    expect(info.sampleRate).toBe(44100);
    expect(info.channels).toBe(2);
    expect(info.bitrateKbps).toBe(320);
    expect(info.cbr).toBe(true);
    expect(info.frameCount).toBeGreaterThan(0);
    // lamejs prepends encoder delay and pads to a 1152-sample frame, so the
    // frame-counted duration sits a little above the 1.000 s of PCM.
    expect(info.durationSec).toBeGreaterThan(0.98);
    expect(info.durationSec).toBeLessThan(1.15);
    expect(info.tags.title).toBe('Sine');
    expect(info.tags.artist).toBe('Concord');
    expect(info.tags.bpm).toBe('120');
    expect(info.tags.key).toBe('C minor');
    const frame = bytes.findIndex((b, i) => b === 0xff && i + 1 < bytes.length && (bytes[i + 1] & 0xe0) === 0xe0 && (bytes[i + 1] & 0x06) === 0x02);
    expect(frame).toBeGreaterThan(0);
    expect(MP3_VBR_SUPPORTED).toBe(false);
  });
});
