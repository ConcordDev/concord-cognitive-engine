// concord-frontend/components/conkay/conkay-bloom.ts
//
// F8 — selective-bloom honesty mapping (K6b). Framework-free (no
// three/@react-three/postprocessing import) so the honesty contract that makes
// bloom SELECTIVE — a mesh glows because ITS OWN real value is hot, not because
// the whole scene is generally bright — is unit-testable without a GPU.
//
// The pattern: the Bloom pass runs with a `luminanceThreshold` near 1, so
// nothing blooms by default. Only a material whose emissive/HDR brightness is
// pushed ABOVE the normal 0..1 range (with `toneMapped=false`, or tone-mapping
// would clamp it back down) exceeds that threshold and blooms. Here we map the
// scene's already-honest per-frame `glow` value (OrbitalRings' eased target
// glow; LatticeGlobe's `computeLatticeGlobeMotion().glowIntensity`) into that
// emissive-intensity space:
//
//   emissiveIntensity = glow * EMISSIVE_GLOW_SCALE
//
// Both those `glow` values are PURE functions of real backend signals
// (`conkayHudStore.inFlight` + `runDtuRefs.length`) — see
// `orbital-rings-motion.ts` / `lattice-globe-motion.ts`. So the bloom is a
// pure function of real work: glow ∝ real value → emissive ∝ real value →
// bloom ∝ real value. Kill the backend mid-run and the upstream glow decays to
// its idle band, `emissiveIntensityForGlow` drops below `EMISSIVE_BLOOM_THRESHOLD`,
// and the element stops blooming — no fake progress can survive.
//
// The scale + threshold are chosen so the two source components' IDLE bands sit
// safely below the threshold and their WORKING bands safely above it:
//   - OrbitalRings idle target glow = 0            → emissive 0.0   (dark)
//   - LatticeGlobe idle glow ≤ 0.24 (its Math.min-capped ceiling)
//                                                  → emissive ≤ 0.672 (< 1.0)
//   - either component, working, inFlight ≥ 1, glow ≥ 0.53
//                                                  → emissive ≥ 1.48  (> 1.0)
// so idle genuinely does NOT bloom and working genuinely DOES — the honesty
// contract made visually legible. Pinned by conkay-bloom.test.ts.

/** Multiplier from a 0..1 honest `glow` value into emissive-intensity space. */
export const EMISSIVE_GLOW_SCALE = 2.8;

/**
 * The emissive-intensity cutoff the selective Bloom pass effectively catches.
 * Emissive intensity ABOVE this is "hot" (HDR, above the normal 0..1 range) and
 * blooms; at or below it the material stays in-range and does not. This is the
 * emissive-space companion to the Bloom pass's screen-space `luminanceThreshold`
 * (BLOOM_LUMINANCE_THRESHOLD) — the render pushes hot emissive past 1.0 with
 * `toneMapped={false}`, so a > 1.0 emissive maps to > threshold screen luminance.
 */
export const EMISSIVE_BLOOM_THRESHOLD = 1.0;

/**
 * The Bloom pass's screen-space luminance threshold. Near 1 (not the old 0.15)
 * so the pass is SELECTIVE: only the `toneMapped={false}` HDR-emissive elements
 * (OrbitalRings when a macro is in flight, LatticeGlobe when working) exceed it.
 * Every other scene element (particle fields, sprites, holo shell) is
 * tone-mapped (clamped ≤ 1) and stays below this, so it no longer blooms just
 * for being generally bright.
 */
export const BLOOM_LUMINANCE_THRESHOLD = 0.9;

/**
 * Map an honest per-frame `glow` (0..1-ish) into emissive intensity. Pure and
 * defensive: non-finite or negative input clamps to 0 (dark, never NaN).
 */
export function emissiveIntensityForGlow(glow: number): number {
  const g = Number.isFinite(glow) ? Math.max(0, glow) : 0;
  return g * EMISSIVE_GLOW_SCALE;
}

/** True iff this glow level produces a hot-enough emissive to actually bloom. */
export function bloomsAtGlow(glow: number): boolean {
  return emissiveIntensityForGlow(glow) > EMISSIVE_BLOOM_THRESHOLD;
}
