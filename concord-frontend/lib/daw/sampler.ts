/** Slice points for the sampler. Playback uses these as buffer offsets. */

import { transientSamples } from './dsp/stretch';
import { DRUM_LANES } from './presets';
import type { Voice } from './dsp/instruments';
import type { DAWTrack } from './types';

export interface SampleSlice {
  start: number;
  end: number;
  pitch: number;
  reverse: boolean;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

export interface SliceSpan { start: number; end: number }

export function sliceSpans(channel: Float32Array, sampleRate: number, mode: 'transient' | 'grid', gridSec = 0.25): SliceSpan[] {
  if (!channel.length || !(sampleRate > 0)) return [];
  const total = channel.length / sampleRate;
  if (mode === 'grid') {
    const out: SliceSpan[] = [];
    for (let t = 0; t < total - 0.01; t += gridSec) out.push({ start: t, end: Math.min(total, t + gridSec) });
    return out;
  }
  const hits = transientSamples(channel, sampleRate);
  const points = hits.length ? hits : [0];
  if (points[0] > sampleRate * 0.01) points.unshift(0);
  const out: SliceSpan[] = [];
  for (let i = 0; i < points.length; i++) {
    const start = points[i] / sampleRate;
    const end = (i + 1 < points.length ? points[i + 1] : channel.length) / sampleRate;
    if (end - start >= 0.02) out.push({ start, end });
  }
  return out;
}

export const DEFAULT_SLICE_ENV = { attack: 0.005, decay: 0.1, sustain: 0.8, release: 0.05 };

export function trackSampleChannel(track: { clips: Array<{ audioBufferId?: string }> } | null, audio: Map<string, { channels: Float32Array[]; sampleRate: number }>): { channel: Float32Array; sampleRate: number } | null {
  const id = track?.clips.find((c) => c.audioBufferId)?.audioBufferId;
  const hit = id ? audio.get(id) : undefined;
  return hit?.channels[0] ? { channel: hit.channels[0], sampleRate: hit.sampleRate } : null;
}

export function buildSlices(channel: Float32Array, sampleRate: number, mode: 'transient' | 'grid'): SampleSlice[] {
  return sliceSpans(channel, sampleRate, mode).map((span) => ({ ...span, pitch: 0, reverse: false, ...DEFAULT_SLICE_ENV }));
}

/** Lane order first, then MIDI note minus 36. Pitch on the slice is a semitone offset, not the trigger. */
export function sliceForNote(slices: DAWTrack['slices'], pitch: number): SampleSlice | undefined {
  if (!slices?.length) return undefined;
  const lane = DRUM_LANES.findIndex((l) => l.pitch === pitch);
  const index = lane >= 0 ? lane : pitch - 36;
  const hit = slices[index];
  return hit ? { ...DEFAULT_SLICE_ENV, ...hit } : undefined;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** One slice. Reverse copies that region; the source buffer stays unchanged. Pitch changes rate and length. */
export function playSlice(ctx: BaseAudioContext, dest: AudioNode, buffer: AudioBuffer, slice: SampleSlice, velocity: number, time: number): Voice {
  const rate = 2 ** (clamp(slice.pitch || 0, -24, 24) / 12);
  const a0 = Math.max(0, Math.floor(slice.start * buffer.sampleRate));
  const b0 = Math.min(buffer.length, Math.ceil(slice.end * buffer.sampleRate));
  const frames = Math.max(0, b0 - a0);
  if (frames < 2) return { stop() { /* empty slice */ } };
  let playBuf = buffer;
  let offset = slice.start;
  if (slice.reverse) {
    const rev = ctx.createBuffer(buffer.numberOfChannels, frames, buffer.sampleRate);
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const src = buffer.getChannelData(ch);
      const dst = rev.getChannelData(ch);
      for (let i = 0; i < frames; i++) dst[i] = src[b0 - 1 - i];
    }
    playBuf = rev;
    offset = 0;
  }
  const sourceDur = Math.max(0.01, slice.reverse ? frames / buffer.sampleRate : Math.max(0.01, slice.end - slice.start));
  const wall = sourceDur / rate;
  const src = ctx.createBufferSource();
  src.buffer = playBuf;
  src.playbackRate.value = rate;
  const amp = ctx.createGain();
  const vel = Math.max(0.05, Math.min(1, velocity / 127));
  const attack = clamp(slice.attack, 0.001, 2);
  const decay = clamp(slice.decay, 0.001, 2);
  const sustain = clamp(slice.sustain, 0, 1);
  const release = clamp(slice.release, 0.001, 2);
  amp.gain.setValueAtTime(0.0001, time);
  amp.gain.linearRampToValueAtTime(vel, time + attack);
  amp.gain.linearRampToValueAtTime(Math.max(0.0001, vel * sustain), time + attack + decay);
  const hold = Math.max(time + attack + decay, time + wall);
  amp.gain.setValueAtTime(Math.max(0.0001, vel * sustain), hold);
  amp.gain.linearRampToValueAtTime(0.0001, hold + release);
  src.connect(amp).connect(dest);
  const startOffset = slice.reverse ? 0 : Math.max(0, Math.min(Math.max(0, playBuf.duration - sourceDur), offset));
  src.start(time, startOffset, sourceDur);
  src.stop(time + wall + release + 0.05);
  return {
    stop(at?: number) {
      const t = at ?? 0;
      try { src.stop(t); } catch { /* already stopped */ }
    },
  };
}
