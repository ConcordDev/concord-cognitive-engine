/**
 * Saved chains, pure part: a track's real effect chain ↔ the units
 * studio.fx-rack-save stores. Loading always mints fresh device ids, so a
 * chain can be dropped on several tracks. Units that are not Studio devices
 * (old rack types such as the generic "eq") are skipped and counted, never
 * guessed into a different device.
 */

import type { EffectInstance, EffectType } from '@/lib/daw/types';
import { effect } from '@/lib/daw/project';
import type { RackUnit } from './boothApi';

export const STUDIO_DEVICE_TYPES: readonly EffectType[] = [
  'eq3', 'eq8', 'parametricEQ', 'compressor', 'multibandCompressor', 'limiter', 'gate', 'deesser',
  'reverb', 'convolutionReverb', 'delay', 'pingPongDelay', 'distortion', 'overdrive', 'bitcrusher', 'waveshaper',
  'chorus', 'phaser', 'flanger', 'tremolo', 'vibrato', 'filter', 'autoFilter', 'autoWah',
  'stereoWidener', 'pan', 'utility', 'pitchShift', 'frequencyShifter', 'pitchCorrect',
];

export interface SaveUnit { type: string; name: string; bypassed: boolean; wet: number; params: EffectInstance['params'] }

export function chainToUnits(chain: EffectInstance[]): SaveUnit[] {
  return chain.map((fx) => ({ type: fx.type, name: fx.name, bypassed: fx.enabled === false, wet: fx.wet, params: { ...fx.params } }));
}

export function unitsToChain(units: RackUnit[]): { chain: EffectInstance[]; skipped: number } {
  const chain: EffectInstance[] = [];
  let skipped = 0;
  for (const u of units) {
    if (!STUDIO_DEVICE_TYPES.includes(u.type as EffectType)) { skipped++; continue; }
    const fx = effect(u.type as EffectType, u.name || u.type, { ...u.params }, Number.isFinite(u.wet) ? Math.max(0, Math.min(1, u.wet)) : 1);
    chain.push(u.bypassed ? { ...fx, enabled: false } : fx);
  }
  return { chain, skipped };
}
