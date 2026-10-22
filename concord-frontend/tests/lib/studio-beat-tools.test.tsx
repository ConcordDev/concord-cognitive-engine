import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { arpeggiate, dispatchControl, midiExtrasFromClip, pitchInScale, stampChord } from '@/lib/daw/beat-tools';
import { encodeMidiFile, parseMidiFile } from '@/lib/daw/midi-file';
import { collectEvents } from '@/lib/daw/scheduler';
import { createMidiClip, createTrack, note } from '@/lib/daw/project';
import { PianoRoll } from '@/components/studio/daw/PianoRoll';

vi.mock('@/lib/daw/playback-engine', () => ({
  getStudioEngine: () => ({ getBeat: () => 0, subscribe: () => () => {}, transportState: 'stopped', launchedClips: {} }),
}));

function source(clipExtras: Record<string, unknown> = {}) {
  const track = createTrack('instrument', 0);
  const clip = { ...createMidiClip(track, 0, 4, [note(60, 0, 2), note(64, 0, 2), note(67, 0, 2)]), ...clipExtras };
  return {
    tracks: [{ ...track, clips: [clip] }],
    beatsPerBar: 4,
    bpm: 120,
    metronome: false,
    mode: 'arrange' as const,
  };
}

describe('scale highlight', () => {
  it('marks C major tones and leaves the others out', () => {
    expect(pitchInScale(60, 'C', 'major')).toBe(true);
    expect(pitchInScale(64, 'C', 'major')).toBe(true);
    expect(pitchInScale(61, 'C', 'major')).toBe(false);
    expect(pitchInScale(62, 'D', 'dorian')).toBe(true);
    expect(pitchInScale(61, 'D', 'dorian')).toBe(false);
  });
});

describe('chord stamp', () => {
  it('stamps a C major triad and the ii chord in C major', () => {
    expect(stampChord('C', 'major', 1, 0, 1).map((n) => n.pitch)).toEqual([60, 64, 67]);
    expect(stampChord('C', 'major', 2, 1, 1).map((n) => n.pitch)).toEqual([62, 65, 69]);
    expect(stampChord('A', 'minor', 1, 0, 1).map((n) => n.pitch % 12)).toEqual([9, 0, 4]);
  });
});

describe('arpeggiator', () => {
  it('walks up, down, and up-down, and a single note crosses octaves', () => {
    const chord = [note(60, 0, 2), note(64, 0, 2), note(67, 0, 2)];
    const up = arpeggiate(chord, { enabled: true, mode: 'up', rate: 0.5, octaves: 1, gate: 1 }, 'seed');
    expect(up.map((n) => n.pitch)).toEqual([60, 64, 67, 60]);
    expect(up[0].lengthBeats).toBeCloseTo(0.5);
    const down = arpeggiate(chord, { enabled: true, mode: 'down', rate: 0.5, octaves: 1, gate: 0.5 }, 'seed');
    expect(down.map((n) => n.pitch)).toEqual([67, 64, 60, 67]);
    expect(down[0].lengthBeats).toBeCloseTo(0.25);
    const both = arpeggiate(chord, { enabled: true, mode: 'up-down', rate: 0.5, octaves: 1, gate: 1 }, 'seed');
    expect(both.map((n) => n.pitch)).toEqual([60, 64, 67, 64]);
    const single = arpeggiate([note(60, 0, 1)], { enabled: true, mode: 'up', rate: 0.25, octaves: 2, gate: 0.5 }, 'seed');
    expect(single.map((n) => n.pitch)).toEqual([60, 72, 60, 72]);
    const random = arpeggiate(chord, { enabled: true, mode: 'random', rate: 0.5, octaves: 1, gate: 1 }, 'same');
    expect(arpeggiate(chord, { enabled: true, mode: 'random', rate: 0.5, octaves: 1, gate: 1 }, 'same').map((n) => n.pitch)).toEqual(random.map((n) => n.pitch));
  });
});

describe('sequencer and MIDI file', () => {
  it('plays the arpeggio and the control lanes instead of the held chord', () => {
    const ev = collectEvents(0, 2, source({
      arp: { enabled: true, mode: 'up', rate: 0.5, octaves: 1, gate: 1 },
      ccLanes: [{ cc: 1, points: [{ beat: 0.5, value: 127 }] }],
      pitchBend: [{ beat: 1, value: 0.5 }],
    }));
    const notes = ev.filter((e) => e.kind === 'note');
    expect(notes.map((e) => e.kind === 'note' && e.pitch)).toEqual([60, 64, 67, 60]);
    expect(notes[0].kind === 'note' && notes[0].beat).toBeCloseTo(0);
    const cc = ev.find((e) => e.kind === 'cc');
    const bend = ev.find((e) => e.kind === 'pitchBend');
    expect(cc).toMatchObject({ cc: 1, value: 127, beat: 0.5 });
    expect(bend).toMatchObject({ value: 0.5, beat: 1 });
  });

  it('round-trips controller and pitch-bend bytes with the notes', () => {
    const notes = [{ pitch: 60, velocity: 100, startBeat: 0, lengthBeats: 1, channel: 0 }];
    const extras = {
      cc: [{ beat: 0.5, cc: 1, value: 90, channel: 0 }, { beat: 1, cc: 11, value: 40, channel: 0 }],
      bend: [{ beat: 0.25, value: 0.5, channel: 0 }, { beat: 0.75, value: 0, channel: 0 }],
    };
    const bytes = encodeMidiFile(notes, 100, 480, extras);
    const parsed = parseMidiFile(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    expect(parsed.bpm).toBe(100);
    expect(parsed.tracks[0].notes[0]).toMatchObject({ pitch: 60, velocity: 100 });
    expect(parsed.tracks[0].cc.map((e) => e.cc)).toEqual([1, 11]);
    expect(parsed.tracks[0].cc[0].value).toBe(90);
    expect(parsed.tracks[0].cc[0].beat).toBeCloseTo(0.5);
    expect(parsed.tracks[0].pitchBend[0].value).toBeCloseTo(0.5, 2);
    expect(parsed.tracks[0].pitchBend[1].value).toBeCloseTo(0, 2);
    expect(midiExtrasFromClip({
      ccLanes: [{ cc: 1, points: [{ beat: 0.5, value: 90 }] }],
      pitchBend: [{ beat: 0.25, value: 0.5 }],
    }).cc[0]).toMatchObject({ cc: 1, value: 90 });
  });
});

describe('synth control dispatch', () => {
  it('bends by semitones and opens the filter from the mod wheel', () => {
    const bends: number[] = [];
    const mods: number[] = [];
    const voice = {
      bend: (semitones: number) => { bends.push(semitones); },
      modulate: (amount: number) => { mods.push(amount); },
    };
    dispatchControl([voice], { kind: 'pitchBend', value: 0.5 }, 1.25);
    dispatchControl([voice], { kind: 'cc', cc: 1, value: 127 }, 1.5);
    dispatchControl([voice], { kind: 'cc', cc: 11, value: 10 }, 1.6);
    expect(bends).toEqual([1]);
    expect(mods).toEqual([1]);
  });
});

describe('piano roll controls', () => {
  it('dims out-of-scale rows and stamps a chord into the clip', () => {
    const track = createTrack('instrument', 0);
    const clip = createMidiClip(track, 0, 4, []);
    const changes: number[][] = [];
    render(
      <PianoRoll
        track={track}
        clip={clip}
        songKey="C"
        songScale="major"
        onChange={(notes) => { changes.push(notes.map((n) => n.pitch)); }}
        onClipChange={() => {}}
        onAudition={() => {}}
      />,
    );
    const c = screen.getAllByRole('button').find((el) => el.getAttribute('data-scale') === 'in' && el.textContent === 'C4');
    const db = screen.getAllByRole('button').find((el) => el.textContent === '' && el.getAttribute('data-scale') === 'out');
    expect(c).toBeTruthy();
    expect(db).toBeTruthy();
    fireEvent.click(screen.getByTestId('stamp-chord'));
    expect(changes[0]).toEqual([60, 64, 67]);
  });
});
