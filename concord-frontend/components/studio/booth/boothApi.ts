/**
 * Typed client for the studio macros the Booth drives directly against the
 * open DAW project: song sections (markers-*), MIDI learn (midi-map-*),
 * saved chains (fx-rack-*) and groove templates (groove-list). Every call goes
 * through /api/lens/run → server/domains/studio.js; nothing here invents data.
 */

import { lensRun } from '@/lib/api/client';
import type { EffectInstance } from '@/lib/daw/types';

export interface Envelope<T> { ok: boolean; result?: T; error?: string }

export async function studio<T>(action: string, input: Record<string, unknown> = {}): Promise<Envelope<T>> {
  try {
    const r = await lensRun<T>('studio', action, input);
    const d = r.data;
    if (!d.ok) return { ok: false, error: d.message || d.error || 'The studio backend refused that.' };
    return { ok: true, result: (d.result ?? undefined) as T | undefined };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || 'Request failed' };
  }
}

export interface Section {
  id: string;
  projectId: string;
  name: string;
  timeBeats: number;
  lengthBeats?: number;
  colour: string;
  kind: 'section' | 'cue' | 'loop_start' | 'loop_end';
}

export interface MidiMap {
  id: string;
  projectId: string;
  target: string;
  msgType: 'cc' | 'note' | 'pitchbend' | 'program';
  controller: number;
  channel: number;
  rangeMin: number;
  rangeMax: number;
  deviceName: string;
}

export interface RackUnit { id: string; type: string; name?: string; bypassed: boolean; wet: number; params: EffectInstance['params'] }
export interface Rack { id: string; name: string; units: RackUnit[]; createdAt: string }

export interface Groove { id: string; name: string; swing: number; velAccent: number }

/** Studio projects the DAW has not saved yet live only on this device (id starts with "local_"). */
export const isSavedProject = (id: string) => !!id && !id.startsWith('local_');
