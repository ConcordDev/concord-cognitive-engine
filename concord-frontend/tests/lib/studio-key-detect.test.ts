import { describe, it, expect } from 'vitest';
import { createAudioClip, createMidiClip, createProject, createTrack, normalizeProject, note } from '@/lib/daw/project';
import { scaleMaskFor } from '@/lib/daw/dsp/pitch/core';
import {
  KEY_ANALYSIS_VERSION,
  detectClipKey,
  detectKeyFromAudio,
  detectKeyFromNotes,
  keyCacheId,
  type KeyStore,
} from '@/lib/daw/dsp/pitch/key-detect';

const SR = 48000;

function chord(midis: number[], seconds: number): Float32Array {
  const n = Math.floor(SR * seconds);
  const out = new Float32Array(n);
  for (const midi of midis) {
    const hz = 440 * Math.pow(2, (midi - 69) / 12);
    let phase = 0;
    const inc = (2 * Math.PI * hz) / SR;
    for (let i = 0; i < n; i++) {
      out[i] += Math.sin(phase) / midis.length;
      phase += inc;
      if (phase > Math.PI * 2) phase -= Math.PI * 2;
    }
  }
  return out;
}

function concat(parts: Float32Array[]): Float32Array {
  const n = parts.reduce((s, p) => s + p.length, 0);
  const out = new Float32Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

describe('key detection', () => {
  it('names a C major progression and an A natural-minor progression', () => {
    const cMajor = concat([
      chord([60, 64, 67], 0.6),
      chord([65, 69, 72], 0.6),
      chord([67, 71, 74], 0.6),
      chord([60, 64, 67], 0.6),
    ]);
    const aMinor = concat([
      chord([57, 60, 64], 0.6),
      chord([62, 65, 69], 0.6),
      chord([64, 67, 71], 0.6),
      chord([57, 60, 64], 0.6),
    ]);
    const c = detectKeyFromAudio(cMajor, SR);
    const a = detectKeyFromAudio(aMinor, SR);
    expect(c).toMatchObject({ key: 'C', scale: 'major' });
    expect(a).toMatchObject({ key: 'A', scale: 'minor' });
  });

  it('does not treat a peak thumbnail or noise as a key', () => {
    expect(detectKeyFromAudio(new Float32Array(400), SR)).toBeNull();
    const noise = new Float32Array(SR);
    let s = 1;
    for (let i = 0; i < noise.length; i++) {
      s = (s * 16807) % 2147483647;
      noise[i] = s / 2147483647 * 2 - 1;
    }
    expect(detectKeyFromAudio(noise, SR)).toBeNull();
  });

  it('reads MIDI notes and only returns major or natural minor', () => {
    const notes = [60, 64, 67, 65, 69, 72, 67, 71, 74, 60, 64, 67].map((pitch, i) => (
      { pitch, lengthBeats: 1, velocity: 100, startBeat: i }
    ));
    const found = detectKeyFromNotes(notes);
    expect(found?.key).toBe('C');
    expect(found?.scale === 'major' || found?.scale === 'minor').toBe(true);
    expect(found?.scale).toBe('major');
  });

  it('caches by asset id and analysis version, and ignores a stale entry', async () => {
    expect(keyCacheId('take-1')).toBe(`take-1:key:${KEY_ANALYSIS_VERSION}`);
    const project = createProject('k', 120, 'D', 'dorian');
    const track = createTrack('audio', 0);
    const clip = createAudioClip(track, 0, 4, 'take-1', 'v');
    track.clips = [clip];
    project.tracks = [track];
    const samples = concat([chord([60, 64, 67], 0.7), chord([65, 69, 72], 0.7), chord([67, 71, 74], 0.7)]);
    let reads = 0;
    const saved = new Map<string, { version: number; result: null }>();
    const store: KeyStore = {
      async get(id) { reads += 1; return saved.get(id) ?? null; },
      async set(id, value) { saved.set(id, value as { version: number; result: null }); },
    };
    const audio = new Map([['take-1', { channels: [samples], sampleRate: SR }]]);
    const first = await detectClipKey(project, clip.id, audio, store);
    expect(first).toMatchObject({ ok: true, key: 'C', scale: 'major', fromCache: false });
    const second = await detectClipKey(project, clip.id, audio, store);
    expect(second).toMatchObject({ ok: true, fromCache: true, key: 'C', scale: 'major' });
    expect(reads).toBe(2);
    saved.set(keyCacheId('take-1'), { version: KEY_ANALYSIS_VERSION + 9, result: null });
    const third = await detectClipKey(project, clip.id, audio, store);
    expect(third).toMatchObject({ ok: true, fromCache: false, key: 'C' });
  });

  it('keeps old projects unchanged and stores a custom mask', () => {
    const opened = normalizeProject({ id: 'p', title: 'Old', bpm: 100, key: 'F#', scale: 'dorian', tracks: [] });
    expect(opened.key).toBe('F#');
    expect(opened.scale).toBe('dorian');
    expect(opened.scaleMask).toBeUndefined();
    const custom = normalizeProject({ scale: 'custom', scaleMask: 0b101010110101 });
    expect(custom.scaleMask).toBe(0b101010110101);
    expect(scaleMaskFor(custom.key, custom.scale, custom.scaleMask).known).toBe(true);
    expect(normalizeProject({ scaleMask: 'nope' }).scaleMask).toBeUndefined();
    expect(normalizeProject({ scaleMask: 99999 }).scaleMask).toBe(0xfff);
  });

  it('asks for a clip instead of guessing', async () => {
    const project = createProject();
    const none = await detectClipKey(project, null, new Map());
    expect(none).toEqual({ ok: false, reason: 'Select an audio or MIDI clip first.' });
    const track = createTrack('instrument', 0);
    const clip = createMidiClip(track, 0, 4, [note(60, 0, 1), note(64, 1, 1), note(67, 2, 1), note(60, 3, 1)]);
    track.clips = [clip];
    project.tracks = [track];
    const midi = await detectClipKey(project, clip.id, new Map());
    expect(midi.ok).toBe(true);
  });
});
