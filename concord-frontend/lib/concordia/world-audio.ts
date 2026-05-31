// lib/concordia/world-audio.ts
//
// Parametric world audio: the world is fully instrumented (Layer-7 signals,
// combat magnitude/element, structural stress), so world sound is a
// PARAMETERIZATION problem, not a recording one — synthesize it from the state
// the sim already tracks. This is the PURE mapping (world event → a synth
// directive: layer + gain + oscillator hint); the React WorldAudioBridge (behind
// CONCORD_WORLD_AUDIO) routes each directive to SoundscapeEngine's oscillator
// synthesis. A building creaks louder as it nears collapse (timbre by material);
// an explosion's burst scales with magnitude + element. Pure + headless-testable.

export type Waveform = "sine" | "triangle" | "sawtooth" | "square";

export interface AudioDirective {
  layer: "creak" | "explosion" | "ambient-hum";
  gain: number;        // 0..1
  freqHz: number;
  waveform: Waveform;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));

// Material → structural-creak timbre (tougher material = lower, longer groan).
const MATERIAL_VOICE: Record<string, { freqHz: number; waveform: Waveform }> = {
  thatch: { freqHz: 420, waveform: "sawtooth" }, // dry rustle
  wood:   { freqHz: 180, waveform: "triangle" }, // creak
  stone:  { freqHz: 90,  waveform: "square" },   // grind
  steel:  { freqHz: 120, waveform: "sine" },     // groan
};

// Element → explosion-burst timbre.
const ELEMENT_VOICE: Record<string, { freqHz: number; waveform: Waveform }> = {
  fire:      { freqHz: 60,   waveform: "sine" },     // low roar
  lightning: { freqHz: 2000, waveform: "square" },   // crack
  ice:       { freqHz: 1200, waveform: "sawtooth" }, // shatter
  physical:  { freqHz: 100,  waveform: "triangle" }, // thump
};

/**
 * Map a world event to a parametric audio directive (or null when nothing
 * should sound). Pure.
 */
export function worldAudioDirectiveFor(eventName: string, payload: Record<string, unknown> = {}): AudioDirective | null {
  switch (eventName) {
    case "world:building-state": {
      const stress = clamp01(Number(payload.structuralStress));
      if (stress <= 0.05) return null; // a sound building is silent
      const v = MATERIAL_VOICE[String(payload.material)] || MATERIAL_VOICE.wood;
      return { layer: "creak", gain: stress, freqHz: v.freqHz, waveform: v.waveform };
    }
    case "combat:hit":
    case "world:explosion": {
      const magnitude = clamp01(Number(payload.magnitude));
      if (magnitude <= 0) return null;
      const v = ELEMENT_VOICE[String(payload.element)] || ELEMENT_VOICE.physical;
      return { layer: "explosion", gain: magnitude, freqHz: v.freqHz, waveform: v.waveform };
    }
    case "world:ambient": {
      const eco = clamp01(Number(payload.ecosystem));
      // a thriving ecosystem thickens the bug-hum; a dead one is quiet
      return { layer: "ambient-hum", gain: eco * 0.5, freqHz: 220, waveform: "sine" };
    }
    default:
      return null;
  }
}
