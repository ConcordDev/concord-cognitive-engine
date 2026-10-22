import { describe, expect, it } from 'vitest';
import { createAudioClip, createProject, createTrack } from '@/lib/daw/project';
import { crossfadeOverlaps, followTempoStretch, nudgeClip, rippleDelete, slipClip, splitClip, trimClipStart } from '@/lib/daw/clip-edit';
import { beatsPerBar } from '@/lib/daw/tempo-map';
import { renderChannel, resampleMono, reverseMono, stretchMono, tempoFromHits, transientSamples } from '@/lib/daw/dsp/stretch';
import { yinDetect } from '@/lib/daw/dsp/pitch/core';
import { collectEvents } from '@/lib/daw/scheduler';

const SR = 48000;

function sine(hz: number, n: number): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.sin((2 * Math.PI * hz * i) / SR);
  return out;
}

function projectWith(clipPatch: Partial<ReturnType<typeof createAudioClip>> = {}) {
  const track = createTrack('audio', 0, { name: 'Vox' });
  const clip = { ...createAudioClip(track, 0, 8, 'buf', 'take'), ...clipPatch, trackId: track.id };
  const project = createProject('Song');
  project.tracks = [{ ...track, clips: [clip] }];
  return { project, clip, track };
}

describe('clip edits', () => {
  it('splits, trims, slips, and ripples without touching the asset id', () => {
    const { project, clip } = projectWith();
    const split = splitClip(project, clip.id, 2, 0.5);
    const parts = split.tracks[0].clips;
    expect(parts).toHaveLength(2);
    expect(parts[0].lengthBeats).toBeCloseTo(2);
    expect(parts[1].startBeat).toBeCloseTo(2);
    expect(parts[1].offset).toBeCloseTo(1);
    expect(parts[0].audioBufferId).toBe('buf');
    const trimmed = trimClipStart(split, parts[0].id, 1, 0.5);
    const left = trimmed.tracks[0].clips.find((c) => c.id === parts[0].id)!;
    expect(left.startBeat).toBeCloseTo(1);
    expect(left.lengthBeats).toBeCloseTo(1);
    expect(left.offset).toBeCloseTo(0.5);
    const slipped = slipClip(trimmed, left.id, 0.25);
    expect(slipped.tracks[0].clips.find((c) => c.id === left.id)!.offset).toBeCloseTo(0.75);
    const nudged = nudgeClip(slipped, parts[1].id, 1);
    const moved = nudged.tracks[0].clips.find((c) => c.id === parts[1].id)!;
    expect(moved.startBeat).toBeCloseTo(3);
    const ripped = rippleDelete(nudged, left.id);
    const rest = ripped.tracks[0].clips;
    expect(rest).toHaveLength(1);
    expect(rest[0].startBeat).toBeCloseTo(2);
  });

  it('writes equal-power fades over an overlap and leaves a gap alone', () => {
    const track = createTrack('audio', 0);
    const a = createAudioClip(track, 0, 4, 'a', 'A');
    const b = { ...createAudioClip(track, 3, 4, 'b', 'B'), id: 'b' };
    const c = { ...createAudioClip(track, 10, 2, 'c', 'C'), id: 'c' };
    const project = { ...createProject('Song'), tracks: [{ ...track, clips: [a, b, c] }] };
    const next = crossfadeOverlaps(project, track.id);
    const clips = next.tracks[0].clips;
    expect(clips.find((x) => x.id === a.id)!.fadeOut).toBeCloseTo(1);
    expect(clips.find((x) => x.id === 'b')!.fadeIn).toBeCloseTo(1);
    expect(clips.find((x) => x.id === 'b')!.fadeShape).toBe('equalPower');
    expect(clips.find((x) => x.id === 'c')!.fadeIn).toBe(0);
  });

  it('counts 6/8 as three timeline beats and keeps 4/4', () => {
    expect(beatsPerBar([4, 4])).toBe(4);
    expect(beatsPerBar([6, 8])).toBe(3);
    expect(beatsPerBar([3, 4])).toBe(3);
    expect(followTempoStretch(2, 4, 120)).toBeCloseTo(1);
    expect(followTempoStretch(2, 8, 120)).toBeCloseTo(2);
  });
});

describe('stretch and onsets', () => {
  it('reverses, stretches length, and shifts pitch while keeping length', () => {
    const n = SR;
    const src = sine(440, n);
    const rev = reverseMono(src);
    expect(rev[0]).toBeCloseTo(src[n - 1], 5);
    const longer = stretchMono(src, 2);
    expect(longer.length).toBeGreaterThan(src.length * 1.9);
    expect(longer.length).toBeLessThan(src.length * 2.1);
    const pitched = renderChannel(src, SR, { reverse: false, semitones: 12, stretch: 1 });
    expect(Math.abs(pitched.length - src.length) / src.length).toBeLessThan(0.05);
    const frame = pitched.subarray(SR / 4, SR / 4 + 4096);
    const hit = yinDetect(frame, SR, 80, 2000);
    expect(hit.confidence).toBeGreaterThan(0.5);
    expect(Math.abs(1200 * Math.log2(hit.hz / 880))).toBeLessThan(30);
  });

  it('finds synthetic clicks and their tempo', () => {
    const n = SR * 2;
    const buf = new Float32Array(n);
    const at = [0.2, 0.7, 1.2, 1.7].map((t) => Math.round(t * SR));
    for (const i of at) buf[i] = 1;
    const hits = transientSamples(buf, SR);
    expect(hits.length).toBe(at.length);
    hits.forEach((h, i) => expect(Math.abs(h - at[i])).toBeLessThan(SR * 0.02));
    expect(tempoFromHits(hits, SR)).toBeCloseTo(120, 0);
  });

  it('resample shortens by the step', () => {
    const out = resampleMono(sine(440, 1000), 2);
    expect(out.length).toBe(500);
  });
});

describe('fade shape reaches the scheduler', () => {
  it('copies equal-power onto the audio event', () => {
    const { project, clip } = projectWith({ fadeShape: 'equalPower', fadeIn: 0.5 });
    const events = collectEvents(0, 4, {
      tracks: project.tracks,
      beatsPerBar: 4,
      bpm: 120,
      metronome: false,
      mode: 'arrange',
    });
    const audio = events.find((e) => e.kind === 'audio' && e.clipId === clip.id);
    expect(audio && audio.kind === 'audio' && audio.fadeShape).toBe('equalPower');
  });
});
