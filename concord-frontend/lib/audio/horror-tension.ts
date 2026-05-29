// concord-frontend/lib/audio/horror-tension.ts
//
// E2 — pure mapping from the server's `horror:tension` state to audio params.
// Kept separate from SoundscapeEngine so it's unit-testable headless: the
// engine just applies these numbers to Web Audio nodes.

export type TensionBand = 'calm' | 'tension' | 'terror';

export interface TensionStemParams {
  /** Target gain of the dissonant tension drone, 0..1. */
  gain: number;
  /** Lowpass cutoff (Hz) — opens up as terror rises so the drone bites. */
  filterHz: number;
  /** Tritone dissonance amount 0..1 — how detuned the second voice is. */
  dissonance: number;
  /** Whether the stem should be audible at all. */
  active: boolean;
}

/**
 * Map the tension band + dread (0..1) to the tension-stem audio params.
 * calm → silent; tension → a low uneasy drone; terror → loud + dissonant +
 * brighter so it cuts through the district bed.
 */
export function tensionStemParams(band: TensionBand, dread: number): TensionStemParams {
  const d = Math.max(0, Math.min(1, dread || 0));
  if (band === 'calm') {
    return { gain: 0, filterHz: 300, dissonance: 0, active: false };
  }
  if (band === 'tension') {
    // 0.35..0.75 dread → a soft, dark drone.
    return { gain: 0.06 + d * 0.10, filterHz: 500 + d * 400, dissonance: 0.2 + d * 0.2, active: true };
  }
  // terror — spikes with dread, brightens, full tritone.
  return { gain: 0.16 + d * 0.16, filterHz: 900 + d * 1600, dissonance: 0.6 + d * 0.4, active: true };
}

export interface GhostStepParams {
  /** Whether the ghost's footstep cue should play this tick. */
  shouldPlay: boolean;
  /** Footstep cadence (ms) — faster as the ghost closes in. */
  intervalMs: number;
  /** Spatial SFX volume scalar 0..1. */
  volume: number;
}

/**
 * Footstep cue cadence/volume from the ghost distance. Beyond the audible
 * radius the cue is silent; up close it's a fast, loud stalk.
 */
export function ghostStepParams(pursuerDistance: number | null, audibleRadiusM = 24): GhostStepParams {
  if (pursuerDistance == null || !Number.isFinite(pursuerDistance) || pursuerDistance > audibleRadiusM) {
    return { shouldPlay: false, intervalMs: 0, volume: 0 };
  }
  const t = 1 - pursuerDistance / audibleRadiusM; // 0 at edge, 1 at contact
  // 900ms far → 280ms close.
  const intervalMs = Math.round(900 - t * 620);
  const volume = Math.max(0.1, Math.min(1, 0.2 + t * 0.8));
  return { shouldPlay: true, intervalMs, volume };
}

/**
 * Given a listener position+facing and the ghost world position, return the
 * world coords to spatialise the footstep at (pass-through; the HRTF panner
 * handles the actual direction). Returns null if either is missing.
 */
export function ghostStepWorldPos(
  ghostPos: { x: number; y: number; z: number } | null | undefined,
): { x: number; y: number; z: number } | null {
  if (!ghostPos || !Number.isFinite(ghostPos.x)) return null;
  return { x: ghostPos.x, y: ghostPos.y || 0, z: ghostPos.z || 0 };
}
