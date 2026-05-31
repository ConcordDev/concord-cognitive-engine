// concord-frontend/lib/concordia/screen-trauma.ts
//
// Track 1 — trauma-based screenshake (the Squirrel Eiserloh GDC model), replacing
// the old `Math.random()` / CSS-keyframe shake. Why this shape:
//   • trauma 0–1 accumulates per event and DECAYS LINEARLY — many small bumps add,
//     a kill spikes it; it settles smoothly instead of snapping.
//   • offset = maxAmount × trauma² × COHERENT noise — the square makes small bumps
//     subtle and big hits dramatic; coherent (Simplex) noise (not random) is smooth
//     frame-to-frame and SURVIVES slow-mo + replays (random() would re-jitter every
//     frame and look harsh / non-deterministic under timeScale).
//   • per-axis incl. rotation — translation alone reads flat; a little roll sells it.
//
// Pure + framework-agnostic: it returns an offset; the consumer applies it to a CSS
// transform or a camera. Reuses the existing seeded Simplex noise.

import { createSimplexNoise2D } from '@/lib/world-lens/simplex-noise';

export interface TraumaConfig {
  maxTranslatePx?: number; // peak translation at trauma=1 (px)
  maxRotateRad?: number;   // peak roll at trauma=1 (rad)
  decayPerSec?: number;    // linear trauma decay
  frequency?: number;      // noise sample speed (higher = busier shake)
  power?: number;          // trauma exponent (2 = Eiserloh's square)
}

export interface ShakeOffset { x: number; y: number; rot: number }

export interface TraumaShake {
  addTrauma(amount: number): void;
  getTrauma(): number;
  update(dt: number): ShakeOffset;
  reset(): void;
}

export function createTraumaShake(cfg: TraumaConfig = {}): TraumaShake {
  const maxT = cfg.maxTranslatePx ?? 18;
  const maxR = cfg.maxRotateRad ?? 0.05;
  const decay = cfg.decayPerSec ?? 1.2;
  const freq = cfg.frequency ?? 18;
  const power = cfg.power ?? 2;

  // Three independent coherent channels (distinct seeds + distinct y-lanes so no
  // two axes ever sample the same lattice line / a shared zero).
  const nx = createSimplexNoise2D(1013);
  const ny = createSimplexNoise2D(2027);
  const nr = createSimplexNoise2D(3041);

  let trauma = 0;
  let t = 0;

  return {
    addTrauma(amount: number) {
      trauma = Math.max(0, Math.min(1, trauma + (Number(amount) || 0)));
    },
    getTrauma() { return trauma; },
    update(dt: number): ShakeOffset {
      const d = Math.max(0, Number(dt) || 0);
      t += d;
      if (trauma > 0) trauma = Math.max(0, trauma - decay * d);
      const shake = Math.pow(trauma, power);
      if (shake <= 0) return { x: 0, y: 0, rot: 0 };
      return {
        x: maxT * shake * nx(t * freq, 0.5),
        y: maxT * shake * ny(t * freq, 11.5),
        rot: maxR * shake * nr(t * freq, 23.5),
      };
    },
    reset() { trauma = 0; t = 0; },
  };
}

/**
 * Map a combat:impact poise-severity (or a legacy juice trigger / event kind) to a
 * trauma ADD — the per-event spike. ~0.3 hit, ~0.5 crit/rocked, ~0.9 kill/knockdown,
 * 1.0 disaster/explosion (matches the brief's "0.3–0.5 hit, 0.8–1.0 kill" targets).
 */
export function traumaForSeverity(severity: string | null | undefined): number {
  switch (String(severity || '').toLowerCase()) {
    case 'disaster':
    case 'explosion':
      return 1.0;
    case 'knockdown':
    case 'kill':
    case 'combat-kill':
      return 0.9;
    case 'rocked':
    case 'crit':
    case 'combat-crit':
      return 0.5;
    case 'flinch':
    case 'hit':
    case 'combat-hit':
      return 0.32;
    case 'none':
      return 0;
    default:
      return 0.25;
  }
}
