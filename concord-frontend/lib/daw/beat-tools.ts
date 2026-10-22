/**
 * Piano-roll helpers that change what the sequencer plays and what a MIDI
 * file contains: scale membership, diatonic chord stamps, arpeggios, and
 * control-lane dispatch. Playback and export both call these functions.
 */

import type { MIDINote } from './types';
import { scaleMaskFor } from './dsp/pitch/core';
import { hashString, mulberry32 } from './dsp/rng';

export type ArpMode = 'up' | 'down' | 'up-down' | 'random';

export interface ArpSettings {
  enabled: boolean;
  mode: ArpMode;
  /** Beats between arpeggio steps. */
  rate: number;
  /** 1 keeps the written octave. Each extra octave stacks the chord above it. */
  octaves: number;
  /** Fraction of `rate` the step holds. 1 ties steps together. */
  gate: number;
}

export interface ControlPoint {
  beat: number;
  value: number;
}

export interface CcLane {
  cc: number;
  points: ControlPoint[];
}

const ROOTS: Record<string, number> = {
  C: 0, 'B#': 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, Fb: 4, F: 5, 'E#': 5,
  'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11, Cb: 11,
};

export function pitchInScale(pitch: number, key: string, scale: string, customMask?: number): boolean {
  const { mask } = scaleMaskFor(key, scale, customMask);
  const pc = ((Math.round(pitch) % 12) + 12) % 12;
  return ((mask >> pc) & 1) === 1;
}

function scaleClasses(key: string, scale: string, customMask?: number): number[] {
  const { mask } = scaleMaskFor(key, scale, customMask);
  const root = ROOTS[(key || 'C').trim()] ?? 0;
  const classes: number[] = [];
  for (let i = 0; i < 12; i++) {
    const pc = (root + i) % 12;
    if ((mask >> pc) & 1) classes.push(pc);
  }
  return classes.length ? classes : [root];
}

/** Diatonic triad for `degree` (1 = I). Notes land at or above C4 and stack in order. */
export function stampChord(
  key: string,
  scale: string,
  degree: number,
  startBeat: number,
  lengthBeats: number,
  velocity = 100,
  customMask?: number,
): MIDINote[] {
  const classes = scaleClasses(key, scale, customMask);
  const n = classes.length;
  const d = ((Math.round(degree) - 1) % n + n) % n;
  const offsets = n >= 3 ? [0, 2, 4] : classes.map((_, i) => i);
  let prev = 59;
  return offsets.map((off, i) => {
    const pc = classes[(d + off) % n];
    let midi = 60 + pc;
    while (midi <= prev) midi += 12;
    prev = midi;
    return {
      id: `chord-${d + 1}-${i}-${startBeat}`,
      pitch: Math.min(127, midi),
      velocity: Math.max(1, Math.min(127, Math.round(velocity) || 100)),
      startBeat: Math.max(0, startBeat),
      lengthBeats: Math.max(0.05, lengthBeats),
      channel: 0,
    };
  });
}

function clampArp(arp: ArpSettings): { rate: number; octaves: number; gate: number; mode: ArpMode } {
  const modes: ArpMode[] = ['up', 'down', 'up-down', 'random'];
  return {
    rate: Math.max(1 / 32, Math.min(4, Number(arp.rate) || 0.25)),
    octaves: Math.max(1, Math.min(4, Math.round(Number(arp.octaves) || 1))),
    gate: Math.max(0.05, Math.min(1, Number(arp.gate) || 0.5)),
    mode: modes.includes(arp.mode) ? arp.mode : 'up',
  };
}

function clusters(notes: MIDINote[]): Array<{ notes: MIDINote[]; start: number; end: number }> {
  const sorted = [...notes].sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch);
  const groups: Array<{ notes: MIDINote[]; start: number; end: number }> = [];
  for (const n of sorted) {
    const end = n.startBeat + Math.max(0.01, n.lengthBeats);
    const g = groups[groups.length - 1];
    if (g && n.startBeat < g.end - 1e-9) {
      g.notes.push(n);
      g.end = Math.max(g.end, end);
    } else {
      groups.push({ notes: [n], start: n.startBeat, end });
    }
  }
  return groups;
}

function stepIndexes(count: number, tones: number, mode: ArpMode, rnd: () => number): number[] {
  if (tones <= 1) return Array.from({ length: count }, () => 0);
  if (mode === 'down') return Array.from({ length: count }, (_, i) => tones - 1 - (i % tones));
  if (mode === 'random') return Array.from({ length: count }, () => Math.floor(rnd() * tones));
  if (mode === 'up-down') {
    const cycle: number[] = [];
    for (let i = 0; i < tones; i++) cycle.push(i);
    for (let i = tones - 2; i >= 1; i--) cycle.push(i);
    return Array.from({ length: count }, (_, i) => cycle[i % cycle.length]);
  }
  return Array.from({ length: count }, (_, i) => i % tones);
}

/** Replace held notes with stepped tones. A single note walks its octaves. */
export function arpeggiate(notes: MIDINote[], arp: ArpSettings | undefined, seed = 'arp'): MIDINote[] {
  if (!arp?.enabled || !notes.length) return notes;
  const { rate, octaves, gate, mode } = clampArp(arp);
  const stepLen = Math.max(0.01, rate * gate);
  const out: MIDINote[] = [];
  for (const group of clusters(notes)) {
    const base = [...new Set(group.notes.map((n) => Math.max(0, Math.min(127, Math.round(n.pitch)))))].sort((a, b) => a - b);
    const tones: number[] = [];
    for (let oct = 0; oct < octaves; oct++) {
      for (const pitch of base) {
        const midi = pitch + oct * 12;
        if (midi <= 127) tones.push(midi);
      }
    }
    if (!tones.length) continue;
    const span = Math.max(rate, group.end - group.start);
    const count = Math.max(1, Math.floor(span / rate + 1e-9));
    const rnd = mulberry32(hashString(`${seed}:${group.start}:${group.notes[0]?.id || ''}`));
    const order = stepIndexes(count, tones.length, mode, rnd);
    const vel = group.notes[0]?.velocity || 100;
    const channel = group.notes[0]?.channel || 0;
    for (let i = 0; i < count; i++) {
      const startBeat = group.start + i * rate;
      if (startBeat >= group.end - 1e-9) break;
      out.push({
        id: `${group.notes[0].id}:arp:${i}`,
        pitch: tones[order[i]],
        velocity: vel,
        startBeat,
        lengthBeats: Math.min(stepLen, group.end - startBeat),
        channel,
      });
    }
  }
  return out;
}

export interface ControlVoice {
  bend?(semitones: number, at?: number): void;
  modulate?(amount01: number, at?: number): void;
  level?(amount01: number, at?: number): void;
}

export type ControlEvent =
  | { kind: 'cc'; cc: number; value: number }
  | { kind: 'pitchBend'; value: number };

/** CC 1 opens the filter. CC 11 scales the voice level. Pitch bend is ±2 semitones across -1..1. */
export function dispatchControl(voices: ControlVoice[], ev: ControlEvent, time?: number): void {
  if (ev.kind === 'pitchBend') {
    const semis = Math.max(-1, Math.min(1, Number(ev.value) || 0)) * 2;
    for (const voice of voices) voice.bend?.(semis, time);
    return;
  }
  const amount = Math.max(0, Math.min(1, (Number(ev.value) || 0) / 127));
  if (ev.cc === 1) {
    for (const voice of voices) voice.modulate?.(amount, time);
  } else if (ev.cc === 11) {
    for (const voice of voices) voice.level?.(amount, time);
  }
}

export function midiExtrasFromClip(clip: { ccLanes?: CcLane[]; pitchBend?: ControlPoint[] }): {
  cc: Array<{ beat: number; cc: number; value: number; channel?: number }>;
  bend: Array<{ beat: number; value: number; channel?: number }>;
} {
  const cc = [];
  for (const lane of clip.ccLanes || []) {
    const controller = Math.max(0, Math.min(127, Math.round(lane.cc)));
    for (const point of lane.points || []) {
      cc.push({
        beat: point.beat,
        cc: controller,
        value: Math.max(0, Math.min(127, Math.round(point.value))),
        channel: 0,
      });
    }
  }
  const bend = (clip.pitchBend || []).map((point) => ({
    beat: point.beat,
    value: Math.max(-1, Math.min(1, Number(point.value) || 0)),
    channel: 0,
  }));
  return { cc, bend };
}
