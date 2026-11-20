/**
 * MIDI learn, pure part: read a Control Change message, name a mapping
 * target, and turn a 0–127 controller value into the parameter value it
 * drives. The Web MIDI wiring lives in useMidiLearn; the maps themselves are
 * stored per project by studio.midi-map-*.
 *
 * Targets (strings stored on the map):
 *   track:<trackId>:volume   fader, −60 … +6 dB (bottom of travel is −∞)
 *   track:<trackId>:pan      −1 (left) … +1 (right)
 *   master:volume            master fader, −60 … +6 dB
 */

import type { DAWProject } from '@/lib/daw/types';

export interface CcMessage { channel: number; controller: number; value: number }

/** A Control Change (status 0xB0–0xBF) with its 0-based channel; anything else is null. */
export function parseCc(data: ArrayLike<number> | null | undefined): CcMessage | null {
  if (!data || data.length < 3) return null;
  const status = data[0] & 0xff;
  if ((status & 0xf0) !== 0xb0) return null;
  const controller = data[1] & 0x7f;
  const value = data[2] & 0x7f;
  return { channel: status & 0x0f, controller, value };
}

export type TargetKind = 'volume' | 'pan';
export interface ParsedTarget { scope: 'track' | 'master'; trackId: string | null; kind: TargetKind }

export function parseTarget(target: string): ParsedTarget | null {
  if (target === 'master:volume') return { scope: 'master', trackId: null, kind: 'volume' };
  const m = /^track:([A-Za-z0-9_-]{1,80}):(volume|pan)$/.exec(target);
  return m ? { scope: 'track', trackId: m[1], kind: m[2] as TargetKind } : null;
}

export function trackTarget(trackId: string, kind: TargetKind): string { return `track:${trackId}:${kind}`; }
export const MASTER_TARGET = 'master:volume';

/** The range a target is learned with (stored on the map so an old map keeps its scale). */
export function defaultRange(kind: TargetKind): { rangeMin: number; rangeMax: number } {
  return kind === 'pan' ? { rangeMin: -1, rangeMax: 1 } : { rangeMin: -60, rangeMax: 6 };
}

/**
 * Controller value → parameter value. Linear across the stored range,
 * rounded to 0.1 dB (faders) or 0.01 (pan). A fader at the bottom of its
 * travel is −∞ dB, as on a console.
 */
export function valueFor(kind: TargetKind, cc: number, rangeMin: number, rangeMax: number): number {
  const t = Math.max(0, Math.min(127, Math.round(cc))) / 127;
  const v = rangeMin + (rangeMax - rangeMin) * t;
  if (kind === 'pan') return Math.max(-1, Math.min(1, Math.round(v * 100) / 100));
  if (cc <= 0 && rangeMin <= -60) return -Infinity;
  return Math.max(-60, Math.min(6, Math.round(v * 10) / 10));
}

/** Human label for a map, read against the open project; null when the track it drove is gone. */
export function targetLabel(target: string, project: DAWProject): string | null {
  const t = parseTarget(target);
  if (!t) return null;
  if (t.scope === 'master') return 'Master fader';
  const track = project.tracks.find((x) => x.id === t.trackId);
  if (!track) return null;
  return `${track.name} ${t.kind === 'pan' ? 'pan' : 'fader'}`;
}
