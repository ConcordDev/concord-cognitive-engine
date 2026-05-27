/**
 * Per-terrain footstep audio synthesis.
 *
 * Pre-computed synthesis parameters for 9 ground materials × wet/dry,
 * delivered through the WebAudio API. Designed to be a drop-in addition
 * to the existing SoundscapeEngine SFX synthesizer.
 *
 * Why generated, not sampled: the existing SoundscapeEngine ships zero
 * audio asset files — everything is synthesised. Layering 18 distinct
 * sampled footsteps would bloat the bundle by ~3-6MB; granular noise
 * bursts shaped by an ADSR envelope deliver the same "tactile" feel
 * for free, and the synthesis can be re-tuned per material without
 * re-recording anything.
 */

export type TerrainMaterial =
  | 'grass'
  | 'sand'
  | 'stone'
  | 'wood'
  | 'snow'
  | 'tile'
  | 'mud'
  | 'dirt'
  | 'metal';

export interface FootstepSpec {
  /** Centre frequency of the noise burst. Lower = thumpier. */
  centreFreqHz: number;
  /** Band-pass filter Q. Higher = more tonal, lower = whiter noise. */
  filterQ:      number;
  /** Attack time in seconds. Shorter = sharper. */
  attackSec:    number;
  /** Decay time in seconds. */
  decaySec:     number;
  /** Sustain level [0..1]. 0 = no body, 1 = thick. */
  sustain:      number;
  /** Release time in seconds. */
  releaseSec:   number;
  /** Peak gain [0..1]. */
  peakGain:     number;
  /** "Crunch" — secondary high-frequency tick layered on attack. */
  crunchHz?:    number;
  /** Crunch gain. */
  crunchGain?:  number;
  /** Squelch — low-frequency vibrato modulation on the body (e.g. mud). */
  squelchHz?:   number;
  /** Squelch depth. */
  squelchDepth?: number;
}

export const FOOTSTEP_SPECS: Record<TerrainMaterial, FootstepSpec> = {
  grass: { centreFreqHz: 280, filterQ: 1.2, attackSec: 0.002, decaySec: 0.08, sustain: 0.08, releaseSec: 0.04, peakGain: 0.18, crunchHz: 2100, crunchGain: 0.06 },
  sand:  { centreFreqHz: 180, filterQ: 0.9, attackSec: 0.003, decaySec: 0.13, sustain: 0.04, releaseSec: 0.06, peakGain: 0.16, crunchHz: 950,  crunchGain: 0.07 },
  stone: { centreFreqHz: 420, filterQ: 2.5, attackSec: 0.001, decaySec: 0.05, sustain: 0.05, releaseSec: 0.03, peakGain: 0.24, crunchHz: 3400, crunchGain: 0.10 },
  wood:  { centreFreqHz: 240, filterQ: 4.0, attackSec: 0.001, decaySec: 0.10, sustain: 0.12, releaseSec: 0.04, peakGain: 0.21, crunchHz: 1850, crunchGain: 0.05 },
  snow:  { centreFreqHz: 320, filterQ: 0.7, attackSec: 0.004, decaySec: 0.18, sustain: 0.02, releaseSec: 0.09, peakGain: 0.13, crunchHz: 1400, crunchGain: 0.04 },
  tile:  { centreFreqHz: 560, filterQ: 3.5, attackSec: 0.001, decaySec: 0.04, sustain: 0.04, releaseSec: 0.025, peakGain: 0.26, crunchHz: 4200, crunchGain: 0.12 },
  mud:   { centreFreqHz: 95,  filterQ: 0.6, attackSec: 0.002, decaySec: 0.13, sustain: 0.10, releaseSec: 0.08, peakGain: 0.20, squelchHz: 6,   squelchDepth: 0.35 },
  dirt:  { centreFreqHz: 200, filterQ: 1.5, attackSec: 0.002, decaySec: 0.10, sustain: 0.06, releaseSec: 0.05, peakGain: 0.17, crunchHz: 1200, crunchGain: 0.05 },
  metal: { centreFreqHz: 380, filterQ: 5.0, attackSec: 0.001, decaySec: 0.06, sustain: 0.15, releaseSec: 0.08, peakGain: 0.25, crunchHz: 5800, crunchGain: 0.16 },
};

/** Returns a wet variant of the spec — softer attack, longer decay, lower freq. */
export function withWetVariant(spec: FootstepSpec): FootstepSpec {
  return {
    ...spec,
    centreFreqHz: spec.centreFreqHz * 0.85,
    attackSec: spec.attackSec * 1.5,
    decaySec: spec.decaySec * 1.4,
    sustain: Math.min(0.5, spec.sustain * 1.4),
    squelchHz: spec.squelchHz ?? 8,
    squelchDepth: (spec.squelchDepth ?? 0.0) + 0.15,
  };
}

/**
 * Play a single footstep on a WebAudio context. Returns a cleanup
 * function the caller can call early (rarely needed since the chain
 * tears itself down after envelope.releaseSec).
 *
 * `volume` is a 0..1 multiplier on top of peakGain (use for impact
 * weight, fatigue, stealth).
 */
export function playFootstep(
  ctx:      AudioContext,
  material: TerrainMaterial,
  wet:      boolean,
  volume:   number = 1,
): () => void {
  const baseSpec = FOOTSTEP_SPECS[material] ?? FOOTSTEP_SPECS.dirt;
  const spec = wet ? withWetVariant(baseSpec) : baseSpec;

  const now = ctx.currentTime;
  const totalDuration = spec.attackSec + spec.decaySec + spec.releaseSec + 0.05;

  // Buffer of white noise — short, deterministic
  const bufferLen = Math.max(1, Math.floor(ctx.sampleRate * totalDuration));
  const buffer = ctx.createBuffer(1, bufferLen, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = (material.charCodeAt(0) << 8) | (wet ? 1 : 0);
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) | 0;
    return ((seed >>> 0) / 0xffffffff) * 2 - 1;
  };
  for (let i = 0; i < data.length; i++) data[i] = rand();

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = spec.centreFreqHz;
  filter.Q.value = spec.filterQ;

  const gain = ctx.createGain();
  const peakVol = Math.max(0, Math.min(1, spec.peakGain * volume));
  // ADSR
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(peakVol, now + spec.attackSec);
  gain.gain.linearRampToValueAtTime(peakVol * spec.sustain, now + spec.attackSec + spec.decaySec);
  gain.gain.linearRampToValueAtTime(0, now + spec.attackSec + spec.decaySec + spec.releaseSec);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  // Squelch — modulate filter freq with a sub-Hz LFO
  let lfo: OscillatorNode | null = null;
  let lfoGain: GainNode | null = null;
  if (spec.squelchHz && spec.squelchDepth) {
    lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = spec.squelchHz;
    lfoGain = ctx.createGain();
    lfoGain.gain.value = spec.centreFreqHz * spec.squelchDepth;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start(now);
    lfo.stop(now + totalDuration);
  }

  // Crunch — high-pitched click on attack
  let crunchOsc: OscillatorNode | null = null;
  let crunchGain: GainNode | null = null;
  if (spec.crunchHz && spec.crunchGain) {
    crunchOsc = ctx.createOscillator();
    crunchOsc.type = 'sawtooth';
    crunchOsc.frequency.value = spec.crunchHz;
    crunchGain = ctx.createGain();
    crunchGain.gain.setValueAtTime(0, now);
    crunchGain.gain.linearRampToValueAtTime(spec.crunchGain * volume, now + spec.attackSec * 0.5);
    crunchGain.gain.linearRampToValueAtTime(0, now + spec.attackSec + 0.01);
    crunchOsc.connect(crunchGain);
    crunchGain.connect(ctx.destination);
    crunchOsc.start(now);
    crunchOsc.stop(now + spec.attackSec + 0.02);
  }

  source.start(now);

  return () => {
    try { source.stop(); } catch { /* idempotent */ }
    try { lfo?.stop(); } catch { /* idempotent */ }
    try { crunchOsc?.stop(); } catch { /* idempotent */ }
    try { source.disconnect(); filter.disconnect(); gain.disconnect(); } catch { /* idempotent */ }
    try { lfo?.disconnect(); lfoGain?.disconnect(); } catch { /* idempotent */ }
    try { crunchOsc?.disconnect(); crunchGain?.disconnect(); } catch { /* idempotent */ }
  };
}

/**
 * Quick router from a terrain-material identifier (kebab-case, dotted,
 * snake_case, etc.) to the canonical kind. Returns 'dirt' as fallback so
 * callers always get a playable spec.
 */
export function normalizeTerrainMaterial(raw: string | undefined | null): TerrainMaterial {
  if (!raw) return 'dirt';
  const v = String(raw).toLowerCase().trim();
  if (v.includes('grass') || v.includes('turf') || v.includes('meadow')) return 'grass';
  if (v.includes('sand') || v.includes('beach')) return 'sand';
  if (v.includes('stone') || v.includes('rock') || v.includes('cobble')) return 'stone';
  if (v.includes('wood') || v.includes('plank') || v.includes('deck')) return 'wood';
  if (v.includes('snow') || v.includes('ice')) return 'snow';
  if (v.includes('tile') || v.includes('marble') || v.includes('floor')) return 'tile';
  if (v.includes('mud') || v.includes('swamp') || v.includes('bog')) return 'mud';
  if (v.includes('metal') || v.includes('steel') || v.includes('iron')) return 'metal';
  return 'dirt';
}
