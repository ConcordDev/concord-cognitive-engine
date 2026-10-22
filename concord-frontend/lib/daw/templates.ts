/**
 * Starter projects: a playable demo plus music-only templates.
 * Deterministic (no randomness) so they open the same every time.
 */

import type { DAWProject, DAWTrack, MIDINote } from './types';
import { createProject, createTrack, createMidiClip, note, effect } from './project';

export interface StudioTemplate {
  id: string;
  name: string;
  description: string;
  bpm: number;
  build: () => DAWProject;
}

const KICK = 36, SNARE = 38, CLAP = 39, HAT = 42, OHAT = 46;

function drumBar(bar: number, pattern: { kick: number[]; snare?: number[]; clap?: number[]; hat?: number[]; ohat?: number[] }): MIDINote[] {
  const b = bar * 4;
  const out: MIDINote[] = [];
  const add = (pitch: number, steps: number[] | undefined, vel: number) => (steps || []).forEach((s) => out.push(note(pitch, b + s / 4, 0.25, vel)));
  add(KICK, pattern.kick, 118);
  add(SNARE, pattern.snare, 108);
  add(CLAP, pattern.clap, 100);
  add(HAT, pattern.hat, 78);
  add(OHAT, pattern.ohat, 82);
  return out;
}

function drums(bars: number, pattern: Parameters<typeof drumBar>[1]): MIDINote[] {
  const out: MIDINote[] = [];
  for (let i = 0; i < bars; i++) out.push(...drumBar(i, pattern));
  return out;
}

/** Chord tones (MIDI) from a root and intervals. */
const chord = (root: number, ints: number[]) => ints.map((i) => root + i);

function chordClipNotes(progression: Array<{ root: number; ints: number[] }>, beatsEach: number, vel = 84): MIDINote[] {
  const out: MIDINote[] = [];
  progression.forEach((c, i) => chord(c.root, c.ints).forEach((p) => out.push(note(p, i * beatsEach, beatsEach - 0.1, vel))));
  return out;
}

function withClip(t: DAWTrack, startBeat: number, lengthBeats: number, notes: MIDINote[], name?: string): DAWTrack {
  const c = createMidiClip(t, startBeat, lengthBeats, notes);
  if (name) c.name = name;
  return { ...t, clips: [...t.clips, c] };
}

const MIN7 = [0, 3, 7, 10], MAJ7 = [0, 4, 7, 11], MIN = [0, 3, 7], MAJ = [0, 4, 7], ADD9 = [0, 4, 7, 14];

const vocalChain = () => [
  effect('eq3', 'Vocal EQ', { highPass: 90, lowGain: -1, lowFreq: 250, midGain: -1.5, midFreq: 400, midQ: 1, highGain: 2.5, highFreq: 8000 }),
  effect('compressor', 'Vocal Comp', { threshold: -20, ratio: 3, attack: 0.005, release: 0.12, knee: 6, makeup: 3 }),
  effect('reverb', 'Plate', { decay: 1.6, preDelay: 0.02 }, 0.15),
];

function nightDrive(): DAWProject {
  const p = createProject('Night Drive (demo)', 92, 'A', 'minor');
  p.genre = 'r&b';
  const bars = 8;
  // Am9 – Fmaj7 – Cmaj7 – G(add9)... 2 bars each? keep 1 bar each, loop twice.
  const prog = [
    { root: 57, ints: MIN7 }, { root: 53, ints: MAJ7 }, { root: 48, ints: MAJ7 }, { root: 55, ints: ADD9 },
  ];
  let d = createTrack('drums', 0, { name: 'Drums', instrumentId: 'drums:808', role: 'drums' });
  d = withClip(d, 0, bars * 4, drums(bars, { kick: [0, 7, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], ohat: [15] }), 'Beat');
  let bass = createTrack('instrument', 1, { name: '808', instrumentId: 'bass-808', role: 'bass' });
  const bassNotes: MIDINote[] = [];
  [33, 29, 24, 31].forEach((r, i) => { bassNotes.push(note(r + 12, i * 4, 1.5, 110), note(r + 12, i * 4 + 1.75, 0.5, 96), note(r + 12, i * 4 + 2.5, 1.25, 104)); });
  bass = withClip(bass, 0, 16, bassNotes, '808 line');
  bass = withClip(bass, 16, 16, bassNotes.map((n) => ({ ...n, id: n.id + 'b' })), '808 line');
  let keys = createTrack('instrument', 2, { name: 'Keys', instrumentId: 'keys-ep', role: 'keys' });
  keys = withClip(keys, 0, 16, chordClipNotes(prog, 4), 'Chords');
  keys = withClip(keys, 16, 16, chordClipNotes(prog, 4), 'Chords');
  keys.effectChain = [effect('reverb', 'Room', { decay: 1.8, preDelay: 0.01 }, 0.2)];
  let lead = createTrack('instrument', 3, { name: 'Lead', instrumentId: 'pluck', role: 'synth' });
  const mel = [76, 74, 72, 69, 72, 74, 76, 79].map((p2, i) => note(p2, i * 2 + (i % 2 ? 0.5 : 0), 1.25, 92));
  lead = withClip(lead, 16, 16, mel, 'Hook');
  lead.effectChain = [effect('delay', 'Eighth Delay', { time: 60 / 92 / 2, feedback: 0.32, tone: 5000 }, 0.22)];
  lead.volume = -4;
  const vox = createTrack('audio', 4, { name: 'Vocal', role: 'vocal' });
  vox.effectChain = vocalChain();
  bass.duck = { sourceTrackId: d.id, depthDb: 5, releaseMs: 140, pitches: [KICK] };
  p.tracks = [d, bass, keys, lead, vox];
  p.arrangement.lengthBars = 16;
  p.transport.loopEnd = 32;
  return p;
}

function beatTemplate(): DAWProject {
  const p = createProject('New Beat', 140, 'F', 'minor');
  let d = createTrack('drums', 0, { name: 'Drums', instrumentId: 'drums:808', role: 'drums' });
  d = withClip(d, 0, 16, drums(4, { kick: [0, 10], snare: [8], hat: [0, 2, 4, 6, 8, 10, 12, 13, 14, 15] }), 'Trap beat');
  let bass = createTrack('instrument', 1, { name: '808', instrumentId: 'bass-808', role: 'bass' });
  bass = withClip(bass, 0, 16, [note(29, 0, 2.5, 110), note(29, 10 / 4, 1, 100), note(32, 8, 2, 108), note(27, 12, 3.5, 104)], '808');
  bass.duck = { sourceTrackId: d.id, depthDb: 6, releaseMs: 120, pitches: [KICK] };
  let keys = createTrack('instrument', 2, { name: 'Keys', instrumentId: 'keys-ep', role: 'keys' });
  keys = withClip(keys, 0, 16, chordClipNotes([{ root: 53, ints: MIN7 }, { root: 56, ints: MAJ7 }, { root: 51, ints: MAJ }, { root: 49, ints: MAJ7 }], 4, 72), 'Chords');
  const melody = createTrack('instrument', 3, { name: 'Melody', instrumentId: 'pluck', role: 'synth' });
  p.tracks = [d, bass, keys, melody];
  p.transport.loopEnabled = true;
  p.transport.loopStart = 0;
  p.transport.loopEnd = 16;
  return p;
}

function vocalTemplate(): DAWProject {
  const p = createProject('Vocal Session', 90, 'C', 'major');
  let beat = createTrack('drums', 0, { name: 'Beat', instrumentId: 'drums:acoustic', role: 'drums' });
  beat = withClip(beat, 0, 32, drums(8, { kick: [0, 8, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14] }), 'Groove');
  let keys = createTrack('instrument', 1, { name: 'Piano', instrumentId: 'keys-ep', role: 'keys' });
  keys = withClip(keys, 0, 32, chordClipNotes([{ root: 48, ints: MAJ }, { root: 55, ints: MAJ }, { root: 57, ints: MIN }, { root: 53, ints: MAJ }, { root: 48, ints: MAJ }, { root: 55, ints: MAJ }, { root: 57, ints: MIN }, { root: 53, ints: MAJ }], 4, 70), 'Chords');
  const lead = { ...createTrack('audio', 2, { name: 'Lead Vocal', role: 'vocal' }), armed: true, effectChain: vocalChain() };
  const dbl = { ...createTrack('audio', 3, { name: 'Double', role: 'vocal' }), effectChain: vocalChain(), pan: -0.25, volume: -6 };
  const adlib = { ...createTrack('audio', 4, { name: 'Ad-libs', role: 'vocal' }), effectChain: vocalChain(), pan: 0.3, volume: -8 };
  p.tracks = [beat, keys, lead, dbl, adlib];
  p.transport.metronome = false;
  return p;
}

function songwriterTemplate(): DAWProject {
  const p = createProject('Song Idea', 76, 'G', 'major');
  let keys = createTrack('instrument', 0, { name: 'Piano', instrumentId: 'keys-ep', role: 'keys' });
  keys = withClip(keys, 0, 16, chordClipNotes([{ root: 55, ints: MAJ }, { root: 50, ints: MAJ }, { root: 52, ints: MIN }, { root: 48, ints: MAJ }], 4, 76), 'Verse chords');
  let pad = createTrack('instrument', 1, { name: 'Pad', instrumentId: 'pad-warm', role: 'pad' });
  pad = withClip(pad, 16, 16, chordClipNotes([{ root: 55, ints: MAJ }, { root: 50, ints: MAJ }, { root: 52, ints: MIN }, { root: 48, ints: MAJ }], 4, 60), 'Chorus pad');
  pad.volume = -8;
  const vox = { ...createTrack('audio', 2, { name: 'Vocal', role: 'vocal' as const }), armed: true, effectChain: vocalChain() };
  const gtr = createTrack('audio', 3, { name: 'Guitar', role: 'guitar' });
  gtr.effectChain = [effect('eq3', 'Guitar EQ', { highPass: 80, lowGain: 0, midGain: 0, highGain: 1.5 })];
  p.tracks = [keys, pad, vox, gtr];
  return p;
}

function lofiTemplate(): DAWProject {
  const p = createProject('Lo-fi Loop', 82, 'D', 'minor');
  let d = createTrack('drums', 0, { name: 'Drums', instrumentId: 'drums:acoustic', role: 'drums' });
  d = withClip(d, 0, 16, drums(4, { kick: [0, 7, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14] }), 'Dusty beat');
  d.effectChain = [effect('filter', 'Tape LP', { type: 'lowpass', frequency: 7000, resonance: 0.7 })];
  let keys = createTrack('instrument', 1, { name: 'Keys', instrumentId: 'keys-ep', role: 'keys' });
  keys = withClip(keys, 0, 16, chordClipNotes([{ root: 50, ints: MIN7 }, { root: 55, ints: [0, 4, 7, 10] }, { root: 48, ints: MAJ7 }, { root: 57, ints: MIN7 }], 4, 70), 'Chords');
  keys.effectChain = [effect('chorus', 'Wobble', { rate: 0.6, depth: 0.6, delay: 0.012 }, 0.35), effect('reverb', 'Room', { decay: 2.2, preDelay: 0.02 }, 0.25)];
  let bass = createTrack('instrument', 2, { name: 'Bass', instrumentId: 'sub-bass', role: 'bass' });
  bass = withClip(bass, 0, 16, [note(38, 0, 3.5), note(43, 4, 3.5), note(36, 8, 3.5), note(45, 12, 3.5)], 'Bass');
  p.tracks = [d, keys, bass];
  p.transport.loopEnabled = true;
  p.transport.loopEnd = 16;
  return p;
}

export const STUDIO_TEMPLATES: StudioTemplate[] = [
  { id: 'demo', name: 'Demo song: Night Drive', description: 'A finished 16-bar idea with drums, 808, keys and a hook. Press play.', bpm: 92, build: nightDrive },
  { id: 'beat', name: 'Beat', description: 'Drums, 808 and chords, looping. Start cooking.', bpm: 140, build: beatTemplate },
  { id: 'vocal', name: 'Vocal recording', description: 'Beat + piano with three vocal tracks ready to record (lead armed).', bpm: 90, build: vocalTemplate },
  { id: 'songwriter', name: 'Songwriter', description: 'Piano chords, pad, a vocal and a guitar track.', bpm: 76, build: songwriterTemplate },
  { id: 'lofi', name: 'Lo-fi loop', description: 'Dusty drums, wobbly keys and bass.', bpm: 82, build: lofiTemplate },
  { id: 'empty', name: 'Empty project', description: 'Nothing but a blank timeline.', bpm: 120, build: () => createProject('Untitled Song', 120, 'C', 'minor') },
];

export function buildTemplate(id: string): DAWProject {
  const t = STUDIO_TEMPLATES.find((x) => x.id === id) || STUDIO_TEMPLATES[STUDIO_TEMPLATES.length - 1];
  return t.build();
}
