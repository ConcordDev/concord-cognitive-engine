/**
 * render-song.ts offline-render test. A minimal OfflineAudioContext stand-in
 * records what the real Concord Studio engines schedule, so we can check the
 * notes and the looped drum pattern, and that a real WAV Blob comes out.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderSongToWav } from '@/lib/daw/render-song';
import type { ComposedSong } from '@/lib/daw/render-song';

type Rec = { kind: string; start: number; freq?: number };
let recs: Rec[] = [];
let ctxArgs: number[] = [];

function param(v = 0) {
  const p = { value: v, setValueAtTime: () => p, linearRampToValueAtTime: () => p, exponentialRampToValueAtTime: () => p, cancelScheduledValues: () => p };
  return p;
}
function node(extra: Record<string, unknown> = {}) {
  return { connect: (n: unknown) => n, disconnect: () => {}, ...extra };
}

class FakeOfflineCtx {
  sampleRate: number; length: number; numberOfChannels: number;
  currentTime = 0;
  destination = node();
  constructor(ch: number, len: number, rate: number) {
    this.numberOfChannels = ch; this.length = len; this.sampleRate = rate;
    ctxArgs = [ch, len, rate];
  }
  createGain() { return node({ gain: param(1) }); }
  createBiquadFilter() { return node({ type: 'lowpass', frequency: param(1000), Q: param(1) }); }
  createOscillator() {
    const o = node({ type: 'sine', frequency: param(440), detune: param(0), stop: () => {} }) as Record<string, unknown>;
    o.start = (t: number) => recs.push({ kind: 'osc', start: t, freq: (o.frequency as { value: number }).value });
    return o;
  }
  createBuffer(ch: number, len: number, rate: number) {
    return { numberOfChannels: ch, length: len, sampleRate: rate, duration: len / rate, getChannelData: () => new Float32Array(len) };
  }
  createBufferSource() {
    return node({ buffer: null, stop: () => {}, start: (t: number) => recs.push({ kind: 'buf', start: t }) });
  }
  async startRendering() {
    const len = this.length, ch = this.numberOfChannels, rate = this.sampleRate;
    return { numberOfChannels: ch, length: len, sampleRate: rate, duration: len / rate,
      getChannelData: () => { const d = new Float32Array(len); for (let i = 0; i < len; i++) d[i] = 0.1 * Math.sin(i / 50); return d; } };
  }
}

beforeEach(() => {
  recs = []; ctxArgs = [];
  (globalThis as unknown as { OfflineAudioContext: unknown }).OfflineAudioContext = FakeOfflineCtx;
});

const base = (o: Partial<ComposedSong> = {}): ComposedSong => ({
  title: 'T', genre: 'lofi', bpm: 120, key: 'C', scale: 'major', bars: 2, durationSec: 4,
  tracks: [], drums: { steps: 16, stepBeats: 0.25, lanes: [] }, ...o,
});

describe('renderSongToWav', () => {
  it('produces a real PCM WAV blob of the song length plus tail', async () => {
    const { blob, buffer, durationSec } = await renderSongToWav(base());
    expect(blob.type).toBe('audio/wav');
    const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
    expect(String.fromCharCode(...head.slice(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...head.slice(8, 12))).toBe('WAVE');
    expect(durationSec).toBe(4);
    expect(buffer.duration).toBeCloseTo(5, 1);
    expect(ctxArgs).toEqual([2, 44100 * 5, 44100]);
  });

  it('schedules each note at its beat time with the right pitch', async () => {
    await renderSongToWav(base({
      tracks: [{ name: 'Lead', role: 'melody', preset: 'saw-lead', notes: [
        { pitch: 69, startBeat: 0, durationBeats: 1, velocity: 100 },
        { pitch: 81, startBeat: 2, durationBeats: 1, velocity: 100 },
      ] }],
    }));
    const starts = recs.filter(r => r.kind === 'osc');
    expect(starts.some(r => r.start === 0 && Math.round(r.freq!) === 440)).toBe(true);
    expect(starts.some(r => r.start === 1 && Math.round(r.freq!) === 880)).toBe(true); // beat 2 @120bpm = 1s
  });

  it('accepts the studio.compose note shape (lengthBeats) and never schedules non-finite times', async () => {
    const times: number[] = [];
    const orig = FakeOfflineCtx.prototype.createGain;
    FakeOfflineCtx.prototype.createGain = function () {
      const g = orig.call(this) as { gain: Record<string, unknown> };
      const rec = (_v: number, t: number) => { times.push(t); return g.gain; };
      g.gain.setValueAtTime = rec; g.gain.linearRampToValueAtTime = rec;
      return g as never;
    };
    try {
      await renderSongToWav(base({
        tracks: [{ name: 'Bass', role: 'bass', preset: 'sub-bass', notes: [
          { pitch: 36, startBeat: 0, lengthBeats: 0.5, velocity: 100 },
          { pitch: 36, startBeat: 1, velocity: 100 } as never, // malformed: skipped
        ] }],
      }));
    } finally {
      FakeOfflineCtx.prototype.createGain = orig;
    }
    const osc = recs.filter(r => r.kind === 'osc');
    expect(osc.length).toBeGreaterThan(0);
    expect(osc.every(r => r.start === 0)).toBe(true);
    expect(times.length).toBeGreaterThan(0);
    expect(times.every(Number.isFinite)).toBe(true);
  });

  it('loops the one-bar drum pattern across every bar', async () => {
    await renderSongToWav(base({ drums: { steps: 16, stepBeats: 0.25, lanes: [{ pad: 'kick', hits: [0, 8] }] } }));
    const kicks = recs.filter(r => r.kind === 'osc').map(r => r.start).sort((a, b) => a - b);
    expect(kicks).toEqual([0, 1, 2, 3]); // 2 bars x 2 kicks, 0.5s per beat
  });

  it('supports a compact mono render for saving', async () => {
    await renderSongToWav(base(), { sampleRate: 22050, channels: 1 });
    expect(ctxArgs[0]).toBe(1);
    expect(ctxArgs[2]).toBe(22050);
  });
});
