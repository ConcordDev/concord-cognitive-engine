// server/lib/viability/cook-chemistry.js
//
// Engine N8 (chemistry/reactions) × cooking/alchemy. A cook is a reaction
// reaching equilibrium: raw ⇌ cooked, with the forward rate rising with heat
// (more heat → more conversion) and the backward/loss rate spiking at extreme
// heat (burning ruins the dish — Le Chatelier the wrong way). So doneness is a
// CURVE: undercooked when cold, optimal at moderate-high heat, burnt when too
// hot. Composes the shipped N8 reversibleEquilibrium. Pure; ready for cook-engine
// to derive a quality multiplier from station heat.

import { reversibleEquilibrium } from "../chemistry/reactions.js";

/**
 * Equilibrium cooked fraction for a given heat (0..1) + ingredient spoilage
 * tendency (0..1).
 * @returns {{ cookedFraction:number, raw:number, cooked:number, K:number, regime:string }}
 */
export function cookYield({ rawAmount = 1, heat = 0.5, spoilage = 0.2 } = {}) {
  const h = Math.max(0, Math.min(1, Number(heat) || 0));
  const sp = Math.max(0, Math.min(1, Number(spoilage) || 0));
  const total = Math.max(0, Number(rawAmount) || 0);
  const kf = 0.2 + 2 * h;                               // cooking accelerates with heat
  const kb = 0.1 + sp + Math.max(0, h - 0.8) * 3;       // base loss + spoilage + burning past 0.8
  const { A, B, K } = reversibleEquilibrium(kf, kb, total);
  const cookedFraction = total > 0 ? B / total : 0;
  const regime = h < 0.3 ? "undercooked" : h > 0.85 ? "burnt" : "cooked";
  return { cookedFraction, raw: A, cooked: B, K, regime };
}

/**
 * Map a cook to a quality multiplier the craft/cook pipeline can apply
 * (peak-doneness → best multiplier). Bounded [0.5, 1.5].
 */
export function cookQualityMultiplier(opts = {}) {
  const { cookedFraction } = cookYield(opts);
  return 0.5 + cookedFraction; // 0 → 0.5×, ~1 → ~1.5×
}
