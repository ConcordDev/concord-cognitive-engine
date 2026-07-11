/**
 * Real PCM decode + edit + re-encode for the Studio AudioEditor.
 *
 * Every function here operates on actual Float32Array sample data — no
 * fabricated waveform/duration/peak numbers. `decodeBlobToDAWBuffer` is the
 * only function that needs a real Web Audio `AudioContext`
 * (`decodeAudioData`); everything else is pure and takes plain arrays, so
 * it's unit-testable without a browser audio stack.
 */

import { getAudioContext } from './engine';
import type { AudioBuffer as DAWAudioBuffer, AudioEditOperation } from './types';

const WAVEFORM_BUCKETS = 200;

/** Downsample real channel data into per-bucket peak (max |sample|) values
 *  for waveform display. Empty input returns an empty peaks array (never a
 *  fabricated placeholder shape). */
export function computeWaveformPeaks(
  channelData: Float32Array[],
  buckets: number = WAVEFORM_BUCKETS
): number[] {
  const length = channelData[0]?.length ?? 0;
  if (length === 0 || buckets <= 0) return [];
  const bucketSize = Math.max(1, Math.floor(length / buckets));
  const peaks: number[] = [];
  for (let b = 0; b < buckets; b++) {
    const start = b * bucketSize;
    const end = b === buckets - 1 ? length : Math.min(length, start + bucketSize);
    let max = 0;
    for (let ch = 0; ch < channelData.length; ch++) {
      const data = channelData[ch];
      for (let i = start; i < end; i++) {
        const v = Math.abs(data[i]);
        if (v > max) max = v;
      }
    }
    peaks.push(Math.min(1, max));
  }
  return peaks;
}

/** Decode a recorded/imported Blob into a real DAWAudioBuffer — duration,
 *  sampleRate, channel count, and waveform peaks all come from the actually
 *  decoded PCM, plus the raw channel data itself so downstream edit
 *  operations have real samples to work with. `ctx` is injectable for
 *  testing; production callers should omit it and get the shared
 *  AudioContext singleton. */
export async function decodeBlobToDAWBuffer(
  blob: Blob,
  name: string,
  ctx: AudioContext = getAudioContext()
): Promise<DAWAudioBuffer> {
  const arrayBuffer = await blob.arrayBuffer();
  const decoded = await ctx.decodeAudioData(arrayBuffer);
  const channelData: Float32Array[] = [];
  for (let c = 0; c < decoded.numberOfChannels; c++) {
    channelData.push(Float32Array.from(decoded.getChannelData(c)));
  }
  return {
    id: `audiobuf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    sampleRate: decoded.sampleRate,
    duration: decoded.duration,
    channels: decoded.numberOfChannels,
    waveformPeaks: computeWaveformPeaks(channelData),
    channelData,
  };
}

/** Encode real channel data to a 16-bit PCM WAV Blob — the same encoding
 *  shape as PublishAsAdaptiveMusicDialog's `encodeWavDataUrl`, adapted to
 *  work directly off DAWAudioBuffer.channelData instead of a native
 *  Web Audio AudioBuffer. */
export function encodeDAWBufferToWavBlob(buffer: DAWAudioBuffer): Blob {
  const channelData = buffer.channelData ?? [];
  const numCh = Math.max(1, channelData.length);
  const sampleRate = buffer.sampleRate || 44100;
  const numFrames = channelData[0]?.length ?? 0;
  const bytesPerSample = 2;
  const blockAlign = numCh * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataLen = numFrames * blockAlign;
  const totalLen = 44 + dataLen;
  const bytes = new Uint8Array(totalLen);
  const view = new DataView(bytes.buffer);
  let p = 0;
  const wstr = (s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(p++, s.charCodeAt(i));
  };
  wstr('RIFF'); view.setUint32(p, totalLen - 8, true); p += 4;
  wstr('WAVE');
  wstr('fmt '); view.setUint32(p, 16, true); p += 4;
  view.setUint16(p, 1, true); p += 2; // PCM
  view.setUint16(p, numCh, true); p += 2;
  view.setUint32(p, sampleRate, true); p += 4;
  view.setUint32(p, byteRate, true); p += 4;
  view.setUint16(p, blockAlign, true); p += 2;
  view.setUint16(p, bytesPerSample * 8, true); p += 2;
  wstr('data'); view.setUint32(p, dataLen, true); p += 4;
  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, channelData[c]?.[i] ?? 0));
      view.setInt16(p, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      p += 2;
    }
  }
  return new Blob([bytes], { type: 'audio/wav' });
}

export interface AudioEditResult {
  buffer: DAWAudioBuffer;
  /** Set on copy/cut — the caller should stash this as the clipboard. */
  clipboard?: Float32Array[];
  /** Human-readable description of what actually happened (or why nothing
   *  did) — always describes the real outcome, never a canned success
   *  string. */
  summary: string;
}

interface SampleRange {
  startSample: number;
  endSample: number;
}

function selectionToSamples(
  buffer: DAWAudioBuffer,
  selection: { start: number; end: number } | null
): SampleRange | null {
  const total = buffer.channelData?.[0]?.length ?? 0;
  if (!selection || total === 0) return null;
  const startSample = Math.max(0, Math.min(total, Math.round(selection.start * total)));
  const endSample = Math.max(startSample, Math.min(total, Math.round(selection.end * total)));
  if (endSample <= startSample) return null;
  return { startSample, endSample };
}

/** Apply one real audio-editing operation to a DAWAudioBuffer's actual PCM
 *  data. Returns the SAME buffer reference (no-op) when the operation
 *  can't do anything honest (e.g. cut with no selection, paste with an
 *  empty clipboard) — callers should treat `result.buffer === buffer` as
 *  "nothing changed" and surface `result.summary` to the user rather than
 *  pretending the click did something. */
export function applyAudioEditOperation(
  buffer: DAWAudioBuffer,
  op: AudioEditOperation,
  selection: { start: number; end: number } | null,
  clipboard: Float32Array[] | null,
  insertAtNormalized: number
): AudioEditResult {
  const channelData = buffer.channelData;
  if (!channelData || !channelData.length) {
    return { buffer, summary: 'No decoded audio to edit yet.' };
  }
  const total = channelData[0]?.length ?? 0;
  const sel = selectionToSamples(buffer, selection);

  switch (op.type) {
    case 'copy': {
      if (!sel) return { buffer, summary: 'Select a range to copy first.' };
      const clip = channelData.map((ch) => ch.slice(sel.startSample, sel.endSample));
      return {
        buffer,
        clipboard: clip,
        summary: `Copied ${((sel.endSample - sel.startSample) / buffer.sampleRate).toFixed(2)}s.`,
      };
    }
    case 'cut':
    case 'delete': {
      if (!sel) {
        return { buffer, summary: `Select a range to ${op.type === 'cut' ? 'cut' : 'delete'} first.` };
      }
      const clip = op.type === 'cut'
        ? channelData.map((ch) => ch.slice(sel.startSample, sel.endSample))
        : undefined;
      const newChannels = channelData.map((ch) => {
        const out = new Float32Array(ch.length - (sel.endSample - sel.startSample));
        out.set(ch.subarray(0, sel.startSample), 0);
        out.set(ch.subarray(sel.endSample), sel.startSample);
        return out;
      });
      const newDuration = (newChannels[0]?.length ?? 0) / buffer.sampleRate;
      const next: DAWAudioBuffer = {
        ...buffer,
        channelData: newChannels,
        duration: newDuration,
        waveformPeaks: computeWaveformPeaks(newChannels),
      };
      const removedSec = (sel.endSample - sel.startSample) / buffer.sampleRate;
      return { buffer: next, clipboard: clip, summary: `${op.type === 'cut' ? 'Cut' : 'Deleted'} ${removedSec.toFixed(2)}s.` };
    }
    case 'paste': {
      if (!clipboard || !clipboard.length || !clipboard[0]?.length) {
        return { buffer, summary: 'Clipboard is empty — copy or cut a range first.' };
      }
      const insertSample = Math.max(0, Math.min(total, Math.round(insertAtNormalized * total)));
      const newChannels = channelData.map((ch, i) => {
        const clip = clipboard[i] ?? clipboard[0];
        const out = new Float32Array(ch.length + clip.length);
        out.set(ch.subarray(0, insertSample), 0);
        out.set(clip, insertSample);
        out.set(ch.subarray(insertSample), insertSample + clip.length);
        return out;
      });
      const newDuration = (newChannels[0]?.length ?? 0) / buffer.sampleRate;
      const next: DAWAudioBuffer = {
        ...buffer,
        channelData: newChannels,
        duration: newDuration,
        waveformPeaks: computeWaveformPeaks(newChannels),
      };
      const pastedSec = (clipboard[0]?.length ?? 0) / buffer.sampleRate;
      return { buffer: next, summary: `Pasted ${pastedSec.toFixed(2)}s at ${(insertAtNormalized * buffer.duration).toFixed(2)}s.` };
    }
    case 'fadeIn':
    case 'fadeOut': {
      const range = sel ?? { startSample: 0, endSample: total };
      const span = Math.max(1, range.endSample - range.startSample);
      const newChannels = channelData.map((ch) => {
        const out = Float32Array.from(ch);
        for (let i = range.startSample; i < range.endSample; i++) {
          const t = (i - range.startSample) / span;
          const gain = op.type === 'fadeIn' ? t : 1 - t;
          out[i] = out[i] * gain;
        }
        return out;
      });
      const next: DAWAudioBuffer = { ...buffer, channelData: newChannels, waveformPeaks: computeWaveformPeaks(newChannels) };
      return {
        buffer: next,
        summary: `${op.type === 'fadeIn' ? 'Faded in' : 'Faded out'} over ${(span / buffer.sampleRate).toFixed(2)}s.`,
      };
    }
    case 'normalize': {
      let peak = 0;
      for (const ch of channelData) {
        for (let i = 0; i < ch.length; i++) {
          const v = Math.abs(ch[i]);
          if (v > peak) peak = v;
        }
      }
      if (peak === 0) return { buffer, summary: 'Nothing to normalize — buffer is silent.' };
      const targetPeak = 0.9886; // -0.1 dBFS
      const gain = targetPeak / peak;
      const newChannels = channelData.map((ch) => {
        const out = new Float32Array(ch.length);
        for (let i = 0; i < ch.length; i++) out[i] = ch[i] * gain;
        return out;
      });
      const next: DAWAudioBuffer = { ...buffer, channelData: newChannels, waveformPeaks: computeWaveformPeaks(newChannels) };
      const gainDb = 20 * Math.log10(gain);
      return { buffer: next, summary: `Normalized (${gainDb >= 0 ? '+' : ''}${gainDb.toFixed(1)}dB) to -0.1 dBFS.` };
    }
    case 'reverse': {
      const range = sel ?? { startSample: 0, endSample: total };
      const newChannels = channelData.map((ch) => {
        const out = Float32Array.from(ch);
        out.subarray(range.startSample, range.endSample).reverse();
        return out;
      });
      const next: DAWAudioBuffer = { ...buffer, channelData: newChannels, waveformPeaks: computeWaveformPeaks(newChannels) };
      return {
        buffer: next,
        summary: `Reversed ${((range.endSample - range.startSample) / buffer.sampleRate).toFixed(2)}s.`,
      };
    }
    default:
      return { buffer, summary: `"${op.type}" isn't implemented yet.` };
  }
}
