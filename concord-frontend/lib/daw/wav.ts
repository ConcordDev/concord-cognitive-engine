/**
 * RIFF/WAVE encoder for Concord Studio exports and recorded takes.
 *
 * Produces a real PCM WAV (format 1, 16/24-bit) or IEEE float WAV
 * (format 3, 32-bit). Channels are interleaved; samples are clamped to
 * [-1, 1] before integer conversion with optional TPDF dither on 16-bit.
 */

export type WavBitDepth = 16 | 24 | 32;

export interface WavOptions {
  bitDepth?: WavBitDepth;
  /** Triangular dither when reducing to 16-bit. */
  dither?: boolean;
}

export function encodeWav(channels: Float32Array[], sampleRate: number, opts: WavOptions = {}): ArrayBuffer {
  if (!channels.length) throw new Error('encodeWav: no channels');
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error('encodeWav: bad sample rate');
  const bitDepth: WavBitDepth = opts.bitDepth ?? 24;
  const numChannels = channels.length;
  const length = Math.max(...channels.map((c) => c.length));
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataBytes = length * blockAlign;
  const isFloat = bitDepth === 32;

  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, isFloat ? 3 : 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeStr(36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  const dither = !!opts.dither && bitDepth === 16;
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const src = channels[ch];
      let s = i < src.length ? src[i] : 0;
      if (!Number.isFinite(s)) s = 0;
      if (isFloat) {
        view.setFloat32(offset, s, true);
      } else if (bitDepth === 16) {
        if (dither) s += (Math.random() - Math.random()) / 32768;
        const v = Math.max(-1, Math.min(1, s));
        view.setInt16(offset, v < 0 ? Math.round(v * 0x8000) : Math.round(v * 0x7fff), true);
      } else {
        const v = Math.max(-1, Math.min(1, s));
        const int = v < 0 ? Math.round(v * 0x800000) : Math.round(v * 0x7fffff);
        view.setUint8(offset, int & 0xff);
        view.setUint8(offset + 1, (int >> 8) & 0xff);
        view.setUint8(offset + 2, (int >> 16) & 0xff);
      }
      offset += bytesPerSample;
    }
  }
  return buffer;
}

export function encodeWavBlob(channels: Float32Array[], sampleRate: number, opts: WavOptions = {}): Blob {
  return new Blob([encodeWav(channels, sampleRate, opts)], { type: 'audio/wav' });
}

export interface WavHeader {
  format: number;
  channels: number;
  sampleRate: number;
  bitDepth: number;
  dataBytes: number;
  frames: number;
}

/** Minimal header reader (used by tests and to sanity-check exports). */
export function readWavHeader(buf: ArrayBuffer): WavHeader {
  const v = new DataView(buf);
  const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a RIFF/WAVE file');
  const format = v.getUint16(20, true);
  const channels = v.getUint16(22, true);
  const sampleRate = v.getUint32(24, true);
  const bitDepth = v.getUint16(34, true);
  const dataBytes = v.getUint32(40, true);
  return { format, channels, sampleRate, bitDepth, dataBytes, frames: dataBytes / (channels * (bitDepth / 8)) };
}
