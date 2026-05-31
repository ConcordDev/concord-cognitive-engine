// lib/concordia/evo-sound.ts
//
// Evo-sound: sound as an evo-asset class. The EvoAsset engine refines MESHES
// through interaction-selection; make SOUND a kind of evo-asset and the world's
// most-experienced sounds become its richest — through the same fitness-gated
// pipeline. The mesh's Loop-subdivision passes become bounded AUDIO passes, each
// adding one layer of richness so a sound can't over-cook: 1 sub-layer · 2
// transient · 3 harmonic/chorus · 4 reverb tail · 5 procedural variation. This
// is the PURE progression (level → enrichment applied to a base synth directive);
// the backend evo_assets 'sound' kind + interaction-fitness is the integration
// tail. The steam-drake doesn't just look like itself the more it's met — it
// learns to sound like itself. Composes world-audio.ts. Behind CONCORD_EVO_SOUND.

import type { AudioDirective } from "./world-audio";

export const MAX_AUDIO_PASS = 5;

export const AUDIO_PASSES = Object.freeze([
  { level: 1, enrichment: "sub_layer",     desc: "add a weight sub-layer" },
  { level: 2, enrichment: "transient",     desc: "add the attack transient that sells impact" },
  { level: 3, enrichment: "harmonic",      desc: "harmonic richness / detune chorus" },
  { level: 4, enrichment: "reverb_tail",   desc: "spatial reverb tail" },
  { level: 5, enrichment: "variation_set", desc: "procedural variation set (never identical twice)" },
]);

export interface EnrichedDirective extends AudioDirective {
  subLayer?: boolean;
  transient?: boolean;
  harmonics?: number;     // detune-chorus voice count
  reverbTailMs?: number;
  variationSeed?: number; // present → render picks a fresh variation each play
}

const clampLevel = (lvl: number) => Math.max(0, Math.min(MAX_AUDIO_PASS, Math.floor(Number(lvl) || 0)));

/**
 * Apply the cumulative audio refinement passes for an evo level (0..5) on top of
 * a base synth directive. Bounded — level beyond 5 is identical to 5 (can't
 * over-cook). Level 0 returns the base unchanged (off == today for a brand-new,
 * never-interacted sound).
 */
export function enrichDirective(base: AudioDirective, level: number): EnrichedDirective {
  const lvl = clampLevel(level);
  const out: EnrichedDirective = { ...base };
  if (lvl >= 1) out.subLayer = true;
  if (lvl >= 2) out.transient = true;
  if (lvl >= 3) out.harmonics = 3;
  if (lvl >= 4) out.reverbTailMs = 600;
  if (lvl >= 5) out.variationSeed = 1; // caller reseeds per play
  return out;
}

/** The enrichment descriptors applied up to `level` (for HUD / debugging). */
export function passesUpTo(level: number): string[] {
  const lvl = clampLevel(level);
  return AUDIO_PASSES.filter((p) => p.level <= lvl).map((p) => p.enrichment);
}

/**
 * Interaction-fitness for a sound asset — the same selection pressure the mesh
 * pipeline uses: recent interactions decay (2-week half-life) so unused sounds
 * fall behind and the most-experienced climb. Returns a score; the pipeline
 * promotes the top sounds one pass at a time.
 */
export function soundFitness(interactions: { at: number; weight?: number }[] = [], nowMs = Date.now()): number {
  const HALF_LIFE_MS = 14 * 24 * 3600 * 1000;
  let score = 0;
  for (const it of interactions) {
    const age = Math.max(0, nowMs - Number(it.at || 0));
    score += (Number(it.weight) || 1) * Math.pow(0.5, age / HALF_LIFE_MS);
  }
  return score;
}
