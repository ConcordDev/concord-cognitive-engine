/**
 * Instrument presets for Concord Studio tracks.
 *
 * A track's `instrumentId` names what plays its MIDI:
 *   - a synth preset id ('sub-bass', 'keys-ep', ...) from the factory list or
 *     the project's own `synthPresets`
 *   - 'drums:<kit>' for a drum rack (pitch → pad, GM-style mapping)
 */

import { DEFAULT_SYNTH_PRESETS } from './engine';
import type { SynthPreset } from './types';

const base = {
  type: 'subtractive' as const,
  lfo: [],
  effects: [],
  polyphony: 16,
  portamento: 0,
  unison: 1,
  unisonDetune: 0,
};

/** Extra factory instruments so every template has a sensible sound. */
export const EXTRA_SYNTH_PRESETS: SynthPreset[] = [
  {
    ...base, id: 'keys-ep', name: 'Electric Piano', category: 'keys', tags: ['keys', 'warm', 'chords'],
    oscillators: [
      { shape: 'sine', detune: 0, octave: 0, level: 0.7, phase: 0 },
      { shape: 'triangle', detune: 3, octave: 1, level: 0.18, phase: 0 },
    ],
    filter: { type: 'lowpass', frequency: 4200, resonance: 0.7, envelope: 0.3, keyTrack: 0.4 },
    ampEnvelope: { attack: 0.005, decay: 1.1, sustain: 0.35, release: 0.45 },
    filterEnvelope: { attack: 0.005, decay: 0.6, sustain: 0.3, release: 0.4 },
  },
  {
    ...base, id: 'bass-808', name: '808 Bass', category: 'bass', tags: ['bass', '808', 'trap'],
    oscillators: [{ shape: 'sine', detune: 0, octave: -1, level: 0.95, phase: 0 }, { shape: 'triangle', detune: 0, octave: 0, level: 0.12, phase: 0 }],
    filter: { type: 'lowpass', frequency: 900, resonance: 0.5, envelope: 0.1, keyTrack: 0 },
    ampEnvelope: { attack: 0.003, decay: 1.6, sustain: 0.6, release: 0.35 },
    filterEnvelope: { attack: 0.003, decay: 0.3, sustain: 0.5, release: 0.3 },
    polyphony: 1,
  },
  {
    ...base, id: 'organ', name: 'Soft Organ', category: 'keys', tags: ['keys', 'organ', 'gospel'],
    oscillators: [
      { shape: 'sine', detune: 0, octave: 0, level: 0.5, phase: 0 },
      { shape: 'sine', detune: 0, octave: 1, level: 0.3, phase: 0 },
      { shape: 'sine', detune: 2, octave: 2, level: 0.12, phase: 0 },
    ],
    filter: { type: 'lowpass', frequency: 6000, resonance: 0.5, envelope: 0, keyTrack: 0 },
    ampEnvelope: { attack: 0.01, decay: 0.1, sustain: 0.9, release: 0.12 },
    filterEnvelope: { attack: 0.01, decay: 0.1, sustain: 1, release: 0.1 },
  },
];

export interface InstrumentOption {
  id: string;
  name: string;
  category: string;
  kind: 'synth' | 'drums';
}

export const DRUM_KITS: InstrumentOption[] = [
  { id: 'drums:808', name: '808 Kit', category: 'drums', kind: 'drums' },
  { id: 'drums:acoustic', name: 'Studio Kit', category: 'drums', kind: 'drums' },
];

/** Keep the first preset for each id (and drop entries without an id). Order preserved. */
export function dedupePresets(list: ReadonlyArray<SynthPreset | null | undefined>): SynthPreset[] {
  const seen = new Set<string>();
  const out: SynthPreset[] = [];
  for (const p of list) {
    if (!p || !p.id || seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

/** Factory presets + project presets, de-duplicated (project copies of a factory id are edits and win). */
export function allSynthPresets(projectPresets: Record<string, SynthPreset> | SynthPreset[] | undefined): SynthPreset[] {
  const own = Array.isArray(projectPresets) ? projectPresets : Object.values(projectPresets || {});
  return dedupePresets([...own, ...DEFAULT_SYNTH_PRESETS, ...EXTRA_SYNTH_PRESETS]);
}

export function isDrumInstrument(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith('drums:');
}

/** The synth preset a track plays. Unknown ids fall back to the first factory preset. */
export function resolveTrackPreset(
  instrumentId: string | null | undefined,
  projectPresets?: Record<string, SynthPreset> | SynthPreset[],
): SynthPreset {
  const all = allSynthPresets(projectPresets);
  return all.find((p) => p.id === instrumentId) || all[0];
}

export function instrumentOptions(projectPresets?: Record<string, SynthPreset> | SynthPreset[]): InstrumentOption[] {
  return [
    ...allSynthPresets(projectPresets).map((p) => ({ id: p.id, name: p.name, category: p.category, kind: 'synth' as const })),
    ...DRUM_KITS,
  ];
}

/** GM-style drum map used by drum tracks and the step sequencer (top row first). */
export const DRUM_LANES: Array<{ pitch: number; name: string }> = [
  { pitch: 36, name: 'Kick' },
  { pitch: 38, name: 'Snare' },
  { pitch: 39, name: 'Clap' },
  { pitch: 42, name: 'Closed Hat' },
  { pitch: 46, name: 'Open Hat' },
  { pitch: 45, name: 'Low Tom' },
  { pitch: 50, name: 'High Tom' },
  { pitch: 49, name: 'Crash' },
];
