// concord-frontend/lib/concordia/skill-motion.ts
//
// Part B (B3) — skill-modulated motion. Today a fire slash and an ice slash play
// the identical clip and differ only by particle colour. This maps a skill's
// ELEMENT to (a) a distinct VFX + SFX and (b) a tier BIAS that scales the
// procedural clip's amplitude/anticipation — so fire reads as a big aggressive
// arc, ice as a controlled sharp strike, lightning as a fast snap. Pure +
// data-driven (a table), so it's unit-testable and "adding an element = a row".
//
// The clip engine (buildActionClip / buildBiomechClipMap) already scales motion
// by tier 1..5; we just bias the effective tier by element and swap the VFX.

export interface ElementMotion {
  /** concordia:particle-effect type for this element. */
  vfx: string;
  /** soundscape sfx id. */
  sfx: string;
  /** added to the base tier (clamped 1..5) → bigger/smaller motion. */
  tierBias: number;
}

// element → motion flavour. Unknown/physical → neutral (no override).
const ELEMENT_MOTION: Record<string, ElementMotion> = {
  fire:      { vfx: 'flame',  sfx: 'fire_whoosh',  tierBias: +1 }, // big aggressive arc
  ice:       { vfx: 'frost',  sfx: 'ice_crackle',  tierBias: -1 }, // controlled, sharp + small
  frost:     { vfx: 'frost',  sfx: 'ice_crackle',  tierBias: -1 },
  lightning: { vfx: 'spark',  sfx: 'thunder',      tierBias: +1 }, // fast snap
  water:     { vfx: 'splash', sfx: 'water_surge',  tierBias: 0 },
  poison:    { vfx: 'toxin',  sfx: 'hiss',         tierBias: 0 },
  bio:       { vfx: 'toxin',  sfx: 'hiss',         tierBias: 0 },
  energy:    { vfx: 'arcane', sfx: 'energy_hum',   tierBias: +1 },
  earth:     { vfx: 'rock_debris', sfx: 'stone_grind', tierBias: +1 }, // heavy
};

/** Look up an element's motion flavour (null when none/physical/unknown). */
export function elementMotion(element: string | null | undefined): ElementMotion | null {
  if (!element) return null;
  return ELEMENT_MOTION[String(element).toLowerCase()] ?? null;
}

/** Effective tier after element bias, clamped to the engine's 1..5 range. */
export function effectiveTier(baseTier: number, element: string | null | undefined): number {
  const base = Math.max(1, Math.min(5, Math.floor(Number(baseTier) || 3)));
  const m = elementMotion(element);
  if (!m) return base;
  return Math.max(1, Math.min(5, base + m.tierBias));
}

/** VFX to spawn: the element's (if any) else the descriptor's default. */
export function modulatedVfx(baseVfx: string | undefined, element: string | null | undefined): string | undefined {
  const m = elementMotion(element);
  return m ? m.vfx : baseVfx;
}

/** SFX to play: the element's (if any) else the descriptor's default. */
export function modulatedSfx(baseSfx: string | undefined, element: string | null | undefined): string | undefined {
  const m = elementMotion(element);
  return m ? m.sfx : baseSfx;
}

export const ELEMENT_MOTION_TABLE = ELEMENT_MOTION;
