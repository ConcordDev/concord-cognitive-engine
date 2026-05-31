// server/lib/viability/biome.js
//
// Wave 5 #24 — procedural biome: a location's biome is just "which survival cone
// fits the environment best." This composes the Wave-2 creature-envelope cones
// (#6/#9) over the live environment signals — the same constraint geometry that
// gates creature spawning now LABELS terrain. Pure; no new envelopes invented.
// The classifier reads temperature (°C) + humidity (%) + light; it normalises a
// lux light reading to the 0..1 illumination the cave cone expects so it works
// on the raw signal bundle as well as a pre-normalised one.

import { AFFINITY_ENVELOPES, creatureViability, habitable } from "./adapters/creature-envelope.js";

export const BIOMES = Object.freeze(Object.keys(AFFINITY_ENVELOPES));

/** Normalise a signal bundle for the cones (lux → 0..1 illumination). */
function normalizeSignals(signals = {}) {
  const out = { ...signals };
  const l = Number(signals.light);
  if (Number.isFinite(l) && l > 1) out.light = Math.max(0, Math.min(1, l / 100000));
  return out;
}

/**
 * Classify the dominant biome at a location from its environment signals.
 * @returns {{ biome:string, viability:number, ranked:{affinity:string,V:number,habitable:boolean}[], habitable:string[] }}
 */
export function classifyBiome(signals = {}) {
  const s = normalizeSignals(signals);
  const ranked = BIOMES
    .map((affinity) => ({
      affinity,
      V: creatureViability(affinity, s),
      habitable: habitable(affinity, s).feasible,
    }))
    .sort((a, b) => b.V - a.V || a.affinity.localeCompare(b.affinity));
  const top = ranked[0];
  return {
    biome: top && top.V > 0 ? top.affinity : "barren",
    viability: top ? top.V : 0,
    ranked,
    habitable: ranked.filter((r) => r.habitable).map((r) => r.affinity),
  };
}
