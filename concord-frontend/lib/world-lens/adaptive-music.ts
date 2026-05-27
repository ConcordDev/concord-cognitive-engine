/**
 * Adaptive vertical-layer music state machine.
 *
 * Four stems play simultaneously, each with an independent gain. The
 * caller drives a state (combat, tension, revelation, exploration); the
 * state machine eases the gains toward configured targets per stem
 * per state over a smooth crossfade window.
 *
 * Stems are loaded as AudioBuffers and looped continuously. A stem that
 * isn't loaded plays its procedural Web Audio fallback so the system
 * always produces sound even without authored music. Real authored
 * tracks (community DAW DTUs, Suno/Udio output, etc.) drop in via the
 * `loadStem(name, urlOrBuffer)` API and immediately take over.
 *
 * Crossfades are computed in linear gain space (perceptually that's
 * "equal-power" enough at low gain deltas for 4 layered stems).
 */

export type StemName = 'ambient_bed' | 'tension_pad' | 'combat_drum' | 'revelation_strings';

export interface AdaptiveMusicState {
  combat:      number;   // 0..1
  tension:     number;   // 0..1
  revelation:  number;   // 0..1
  exploration: number;   // 0..1
}

interface StemRuntime {
  bufferSource: AudioBufferSourceNode | null;
  oscFallback:  { node: OscillatorNode; gain: GainNode } | null;
  gainNode:     GainNode;
  buffer:       AudioBuffer | null;
  targetGain:   number;
  currentGain:  number;
}

export interface AdaptiveMusicAPI {
  start(): void;
  stop(): void;
  setState(state: Partial<AdaptiveMusicState>): void;
  loadStem(name: StemName, source: AudioBuffer | string): Promise<void>;
  tick(deltaSec: number): void;
  getCurrentGains(): Record<StemName, number>;
  isRunning(): boolean;
  dispose(): void;
}

/**
 * Per-stem state-to-gain matrix. Each row is a state-vector entry;
 * row × state-vector → target gain for the stem.
 */
const STATE_MATRIX: Record<StemName, AdaptiveMusicState> = {
  ambient_bed:       { combat: 0.55, tension: 0.45, revelation: 0.40, exploration: 0.70 },
  tension_pad:       { combat: 0.40, tension: 0.85, revelation: 0.25, exploration: 0.10 },
  combat_drum:       { combat: 0.85, tension: 0.20, revelation: 0.05, exploration: 0.00 },
  revelation_strings:{ combat: 0.10, tension: 0.30, revelation: 0.90, exploration: 0.15 },
};

/**
 * Procedural fallback for each stem — a slow chord pad keyed by stem.
 * Used until a real authored sample is loadStem'd in.
 */
const STEM_FALLBACK_FREQ: Record<StemName, { freq: number; type: OscillatorType; detune: number }> = {
  ambient_bed:        { freq: 65,  type: 'sine',     detune: 0 },
  tension_pad:        { freq: 110, type: 'triangle', detune: 7 },
  combat_drum:        { freq: 55,  type: 'square',   detune: 0 },
  revelation_strings: { freq: 220, type: 'sawtooth', detune: 4 },
};

/** Compute desired gain for a stem given a state vector. */
export function computeStemTargetGain(stem: StemName, state: AdaptiveMusicState): number {
  const matrix = STATE_MATRIX[stem];
  const s = (matrix.combat * state.combat)
          + (matrix.tension * state.tension)
          + (matrix.revelation * state.revelation)
          + (matrix.exploration * state.exploration);
  // Normalise so a "balanced" state at sum=1 gives ~equal-power gains;
  // clamp 0..1.
  return Math.max(0, Math.min(1, s));
}

export function createAdaptiveMusic(ctx: AudioContext, opts: { masterGain?: number } = {}): AdaptiveMusicAPI {
  const masterGain = opts.masterGain ?? 0.18;
  const stems: Record<StemName, StemRuntime> = {} as Record<StemName, StemRuntime>;
  let running = false;
  let currentState: AdaptiveMusicState = {
    combat: 0, tension: 0, revelation: 0, exploration: 1,
  };
  // Time-constant for gain easing (seconds). Larger = slower.
  const EASE_TC = 1.2;

  const master = ctx.createGain();
  master.gain.value = masterGain;
  master.connect(ctx.destination);

  function buildStem(_name: StemName): StemRuntime {
    const gainNode = ctx.createGain();
    gainNode.gain.value = 0;
    gainNode.connect(master);
    return {
      bufferSource: null,
      oscFallback: null,
      gainNode,
      buffer: null,
      targetGain: 0,
      currentGain: 0,
    };
  }

  function startStemPlayback(name: StemName) {
    const stem = stems[name];
    if (!stem) return;
    // Stop existing source / oscillator
    try { stem.bufferSource?.stop(); } catch { /* idempotent */ }
    try { stem.oscFallback?.node.stop(); } catch { /* idempotent */ }
    stem.bufferSource = null;
    stem.oscFallback = null;

    if (stem.buffer) {
      const src = ctx.createBufferSource();
      src.buffer = stem.buffer;
      src.loop = true;
      src.connect(stem.gainNode);
      try { src.start(); } catch { /* idempotent */ }
      stem.bufferSource = src;
    } else {
      const fb = STEM_FALLBACK_FREQ[name];
      const osc = ctx.createOscillator();
      osc.type = fb.type;
      osc.frequency.value = fb.freq;
      osc.detune.value = fb.detune;
      const oscGain = ctx.createGain();
      oscGain.gain.value = 0.5;
      osc.connect(oscGain);
      oscGain.connect(stem.gainNode);
      try { osc.start(); } catch { /* idempotent */ }
      stem.oscFallback = { node: osc, gain: oscGain };
    }
  }

  const STEM_NAMES: StemName[] = ['ambient_bed', 'tension_pad', 'combat_drum', 'revelation_strings'];

  return {
    isRunning: () => running,

    start() {
      if (running) return;
      for (const name of STEM_NAMES) {
        if (!stems[name]) stems[name] = buildStem(name);
        startStemPlayback(name);
      }
      running = true;
    },

    stop() {
      if (!running) return;
      for (const name of STEM_NAMES) {
        const stem = stems[name];
        if (!stem) continue;
        try { stem.bufferSource?.stop(); } catch { /* idempotent */ }
        try { stem.oscFallback?.node.stop(); } catch { /* idempotent */ }
        stem.bufferSource = null;
        stem.oscFallback = null;
      }
      running = false;
    },

    setState(partial) {
      currentState = { ...currentState, ...partial };
      for (const name of STEM_NAMES) {
        const stem = stems[name];
        if (!stem) continue;
        stem.targetGain = computeStemTargetGain(name, currentState);
      }
    },

    async loadStem(name, source) {
      if (!stems[name]) stems[name] = buildStem(name);
      const stem = stems[name];
      let buffer: AudioBuffer;
      if (typeof source === 'string') {
        const resp = await fetch(source);
        const arr = await resp.arrayBuffer();
        buffer = await ctx.decodeAudioData(arr);
      } else {
        buffer = source;
      }
      stem.buffer = buffer;
      if (running) startStemPlayback(name);
    },

    tick(deltaSec) {
      if (!running) return;
      const alpha = Math.min(1, deltaSec / EASE_TC);
      for (const name of STEM_NAMES) {
        const stem = stems[name];
        if (!stem) continue;
        stem.currentGain += (stem.targetGain - stem.currentGain) * alpha;
        try {
          stem.gainNode.gain.setValueAtTime(stem.currentGain, ctx.currentTime);
        } catch { /* WebAudio may throw on dispose race */ }
      }
    },

    getCurrentGains() {
      const out: Record<StemName, number> = {
        ambient_bed: 0, tension_pad: 0, combat_drum: 0, revelation_strings: 0,
      };
      for (const name of STEM_NAMES) {
        out[name] = stems[name]?.currentGain ?? 0;
      }
      return out;
    },

    dispose() {
      this.stop();
      for (const name of STEM_NAMES) {
        const stem = stems[name];
        if (!stem) continue;
        try { stem.gainNode.disconnect(); } catch { /* idempotent */ }
      }
      try { master.disconnect(); } catch { /* idempotent */ }
    },
  };
}

export const _testing = { STATE_MATRIX, STEM_FALLBACK_FREQ };
