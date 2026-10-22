/** Drum-pattern expansion. Probability is a stable hash so live and export match. */

import type { DrumPattern, MIDINote } from './types';
import { DRUM_LANES } from './presets';

function keeps(id: string, row: number, step: number, pass: number, probability: number): boolean {
  if (!(probability < 1)) return true;
  if (probability <= 0) return false;
  let h = 0x811c9dc5;
  const text = `${id}:${row}:${step}:${pass}`;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return ((h >>> 0) % 10000) / 10000 < probability;
}

export function patternToNotes(pattern: DrumPattern, pass = 0): MIDINote[] {
  const stepBeats = pattern.resolution > 0 ? pattern.resolution : 0.25;
  const notes: MIDINote[] = [];
  pattern.tracks.forEach((row, rowIndex) => {
    const pitch = DRUM_LANES[rowIndex]?.pitch ?? (36 + rowIndex);
    row.steps.forEach((step, i) => {
      if (!step?.active || !keeps(pattern.id, rowIndex, i, pass, step.probability ?? 1)) return;
      const start = i * stepBeats;
      const velocity = Math.max(1, Math.min(127, Math.round(step.velocity || 100)));
      notes.push({ id: `${pattern.id}:${rowIndex}:${i}:${pass}`, pitch, startBeat: start, lengthBeats: Math.max(0.05, stepBeats * 0.8), velocity, channel: 0 });
      if (step.flam) {
        notes.push({ id: `${pattern.id}:${rowIndex}:${i}:${pass}:flam`, pitch, startBeat: start + 0.03, lengthBeats: Math.max(0.05, stepBeats * 0.5), velocity: Math.max(1, Math.round(velocity * 0.7)), channel: 0 });
      }
    });
  });
  return notes;
}

export function emptyPattern(id: string, steps = 16): DrumPattern {
  return {
    id,
    name: 'Pattern',
    steps,
    resolution: 0.25,
    tracks: DRUM_LANES.map((lane) => ({
      padId: lane.name,
      steps: Array.from({ length: steps }, () => ({ active: false, velocity: 100, probability: 1, flam: false })),
    })),
  };
}
