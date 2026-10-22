import { describe, it, expect } from 'vitest';
import { swingBeat } from '@/lib/daw/swing';
import { emptyPattern, patternToNotes } from '@/lib/daw/drum-steps';
import { encodeMidiFile, parseMidiFile } from '@/lib/daw/midi-file';
import { buildSlices, sliceForNote, sliceSpans } from '@/lib/daw/sampler';
import { glideHz } from '@/lib/daw/dsp/instruments';
import { noteFromMidi, sustainFromMidi } from '@/lib/daw/midi-messages';
import { collectEvents } from '@/lib/daw/scheduler';
import { createMidiClip, createTrack, note } from '@/lib/daw/project';

describe('swing', () => {
  it('delays off-eighths only, and 100 is a triplet eighth', () => {
    expect(swingBeat(0, 100)).toBe(0);
    expect(swingBeat(1, 100)).toBe(1);
    expect(swingBeat(0.5, 0)).toBe(0.5);
    expect(swingBeat(0.5, 100)).toBeCloseTo(0.5 + 1 / 6);
    expect(swingBeat(0.25, 100)).toBe(0.25);
    expect(swingBeat(0.5, 50)).toBeCloseTo(0.5 + 1 / 12);
  });
});

describe('drum patterns', () => {
  it('expands steps, skips probability 0, and adds a flam', () => {
    const pattern = emptyPattern('p', 16);
    pattern.tracks[0].steps[0] = { active: true, velocity: 110, probability: 1, flam: true };
    pattern.tracks[0].steps[1] = { active: true, velocity: 80, probability: 0, flam: false };
    pattern.tracks[1].steps[2] = { active: true, velocity: 90, probability: 1, flam: false };
    const notes = patternToNotes(pattern, 0);
    expect(notes.map((n) => n.pitch)).toEqual([36, 36, 38]);
    expect(notes[0].startBeat).toBe(0);
    expect(notes[1].startBeat).toBeCloseTo(0.03);
    expect(notes[1].id.endsWith(':flam')).toBe(true);
    expect(notes[1].velocity).toBe(77);
    expect(notes[2].startBeat).toBeCloseTo(0.5);
    expect(patternToNotes(pattern, 0).map((n) => n.id)).toEqual(notes.map((n) => n.id));
    expect(emptyPattern('q', 32).tracks[0].steps).toHaveLength(32);
  });

  it('replaces drawn notes and swings the off-eighth hit', () => {
    const track = createTrack('drums', 0);
    const clip = createMidiClip(track, 0, 4, [note(60, 0, 1), note(62, 0.25, 0.25)]);
    clip.patternId = 'p';
    const pattern = emptyPattern('p', 16);
    pattern.tracks[0].steps[2] = { active: true, velocity: 100, probability: 1, flam: false };
    const ev = collectEvents(0, 4, {
      tracks: [{ ...track, clips: [clip] }],
      beatsPerBar: 4,
      bpm: 120,
      metronome: false,
      mode: 'arrange',
      swing: 100,
      drumPatterns: { p: pattern },
    }).filter((e) => e.kind === 'note');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ pitch: 36 });
    expect(ev[0].kind === 'note' && ev[0].beat).toBeCloseTo(0.5 + 1 / 6);
  });
});

describe('midi file', () => {
  it('round-trips notes and tempo', () => {
    const bytes = encodeMidiFile([{ pitch: 60, velocity: 100, startBeat: 1, lengthBeats: 1, channel: 0 }], 120);
    const parsed = parseMidiFile(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    expect(parsed.bpm).toBe(120);
    expect(parsed.tracks[0].notes[0]).toMatchObject({ pitch: 60, velocity: 100 });
    expect(parsed.tracks[0].notes[0].startBeat).toBeCloseTo(1);
    expect(parsed.tracks[0].notes[0].lengthBeats).toBeCloseTo(1);
  });
});

describe('sampler slices', () => {
  it('cuts a grid and finds two impulses', () => {
    const sr = 48000;
    const channel = new Float32Array(sr);
    expect(sliceSpans(channel, sr, 'grid', 0.25)).toHaveLength(4);
    const hop = Math.round(0.005 * sr);
    channel.fill(0.8, 0, hop);
    channel.fill(0.8, Math.floor(sr / 2), Math.floor(sr / 2) + hop);
    const spans = buildSlices(channel, sr, 'transient');
    expect(spans.length).toBeGreaterThanOrEqual(2);
    expect(spans[0].start).toBe(0);
    expect(sliceForNote(spans, 36)?.start).toBe(spans[0].start);
    expect(sliceForNote(spans, 38)?.start).toBe(spans[1].start);
  });
});

describe('glide and midi messages', () => {
  it('glides on an exponential curve', () => {
    expect(glideHz(100, 400, 0, 0.1)).toBeCloseTo(100);
    expect(glideHz(100, 400, 0.05, 0.1)).toBeCloseTo(200);
    expect(glideHz(100, 400, 0.1, 0.1)).toBeCloseTo(400);
    expect(glideHz(100, 400, 0.2, 0)).toBeCloseTo(400);
  });

  it('reads note on, note off, and the sustain pedal', () => {
    expect(noteFromMidi([0x90, 60, 100])).toEqual({ kind: 'on', pitch: 60, velocity: 100, channel: 0 });
    expect(noteFromMidi([0x80, 60, 0])).toMatchObject({ kind: 'off', pitch: 60 });
    expect(noteFromMidi([0x90, 60, 0])).toMatchObject({ kind: 'off' });
    expect(sustainFromMidi([0xb0, 64, 127])).toBe(true);
    expect(sustainFromMidi([0xb0, 64, 0])).toBe(false);
    expect(noteFromMidi([0xb0, 1, 10])).toBeNull();
  });
});
