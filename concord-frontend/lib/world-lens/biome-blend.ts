// concord-frontend/lib/world-lens/biome-blend.ts
//
// Sprint C / Track B1 — ecotone biome blending.
//
// Returns a weighted mix of biomes for a world-space point so terrain,
// fauna, and signal lookups stop being cliff-edge step functions. Uses
// the existing simplex-noise.ts to perturb sample positions slightly so
// transitions wind around in nature-like swirls instead of straight lines.
//
// Pure module — no Three.js dependency. Callers (TerrainRenderer, signals
// query, fauna spawner via API) consume the Map<BiomeKind, number>.

import { createSimplexNoise2D } from './simplex-noise';

export type BiomeKind =
  | 'plains'
  | 'forest'
  | 'highland'
  | 'mountain'
  | 'water'
  | 'desert'
  | 'tundra'
  | 'swamp';

const BLEND_RADIUS_M = 80;
const SAMPLE_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [BLEND_RADIUS_M / 2, 0], [-BLEND_RADIUS_M / 2, 0],
  [0, BLEND_RADIUS_M / 2], [0, -BLEND_RADIUS_M / 2],
];

const NOISE_AMPLITUDE_M = BLEND_RADIUS_M / 3;
const noiseCache = new Map<number, ReturnType<typeof createSimplexNoise2D>>();

function noiseFor(worldSeed: number) {
  const key = worldSeed | 0;
  let n = noiseCache.get(key);
  if (!n) {
    n = createSimplexNoise2D(key);
    noiseCache.set(key, n);
  }
  return n;
}

/**
 * Compute weights for each biome at point (x,z). Resulting Map values
 * sum to 1.0 (within float epsilon). The `getBiome` callback resolves a
 * single-biome lookup at any world-space point — caller wires it to
 * whatever the world's authoritative biome map is.
 */
export function blendedBiomeWeights(
  x: number,
  z: number,
  worldSeed: number,
  getBiome: (x: number, z: number) => BiomeKind,
): Map<BiomeKind, number> {
  const noise = noiseFor(worldSeed);
  // Perturb sample positions by 2D simplex so transitions are wavy.
  const perturbX = noise(x * 0.005, z * 0.005) * NOISE_AMPLITUDE_M;
  const perturbZ = noise(x * 0.005 + 91.7, z * 0.005 + 47.3) * NOISE_AMPLITUDE_M;

  const out = new Map<BiomeKind, number>();
  for (const [dx, dz] of SAMPLE_OFFSETS) {
    const sampleX = x + dx + perturbX;
    const sampleZ = z + dz + perturbZ;
    const biome = getBiome(sampleX, sampleZ);
    // Weight by 1 / (1 + distance²), so the centre sample dominates and
    // the four cardinal samples blend in proportionally.
    const dist2 = dx * dx + dz * dz;
    const w = 1 / (1 + dist2 / 1600);
    out.set(biome, (out.get(biome) ?? 0) + w);
  }

  // Normalize.
  let total = 0;
  for (const v of out.values()) total += v;
  if (total > 0) {
    for (const [k, v] of out.entries()) out.set(k, v / total);
  }
  return out;
}

/**
 * Convenience: which biome is dominant at this point? Returns the highest-
 * weight entry. Equivalent to a "ticked-toward-realistic" getBiome.
 */
export function dominantBiome(weights: Map<BiomeKind, number>): BiomeKind {
  let bestKind: BiomeKind = 'plains';
  let bestWeight = 0;
  for (const [k, v] of weights.entries()) {
    if (v > bestWeight) { bestWeight = v; bestKind = k; }
  }
  return bestKind;
}

/**
 * Linear interpolation across biomes for a numeric attribute. Used by
 * the terrain renderer for foliage-density / temperature-shader inputs.
 */
export function blendNumeric<K extends BiomeKind>(
  weights: Map<BiomeKind, number>,
  table: Record<K, number>,
): number {
  let v = 0;
  for (const [k, w] of weights.entries()) {
    const tv = (table as Record<string, number | undefined>)[k];
    if (typeof tv === 'number') v += tv * w;
  }
  return v;
}

export const BIOME_BLEND_CONSTANTS = Object.freeze({
  BLEND_RADIUS_M,
  NOISE_AMPLITUDE_M,
});
