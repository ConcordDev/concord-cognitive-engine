// server/lib/viability/viability-index.js
//
// Engine #8 — the single "how close to collapse" scalar, 0..1.
//   V = 0 on or past the nearest binding boundary; V → 1 deep in the interior.
// Built on slacks() from feasibility.js — one normalized distance-to-boundary
// per constraint, weighted (a high-weight axis pulls V down faster), then the
// tightest one governs. This is the number the ETCC index, longevity index,
// creature cones, ecosystem health, etc. all read once the adapters land.

import { slacks } from "./feasibility.js";

/**
 * Viability index in [0,1]. opts.saturationScale (default 1) sets "how far is
 * safe" — at the tightest normalized/weight slack == saturationScale, V == 1.
 */
export function viabilityIndex(state, set, opts = {}) {
  const sat = Number(opts.saturationScale) > 0 ? Number(opts.saturationScale) : 1;
  const s = slacks(state, set);
  if (s.length === 0) return 1; // nothing constrains it → fully viable
  let min = Infinity;
  for (const o of s) {
    if (!Number.isFinite(o.normalized)) continue; // unmeasured/unconstrained axis
    const eff = o.normalized / (o.weight > 0 ? o.weight : 1);
    if (eff < min) min = eff;
  }
  if (!Number.isFinite(min)) return 1; // every constraint was non-binding
  return Math.max(0, Math.min(1, min / sat));
}

/** The constraint about to break (tightest normalized slack) + how close. */
export function nearestBinding(state, set) {
  const s = slacks(state, set);
  if (s.length === 0) return null;
  let best = null;
  for (const o of s) {
    if (!Number.isFinite(o.normalized)) continue;
    if (!best || o.normalized < best.normalized) best = o;
  }
  if (!best) return null;
  return { id: best.id, which: best.which, slack: best.normalized, weight: best.weight };
}

/**
 * One-pass diagnostic bundle — the canonical entry for the dynamics layer + HUD.
 * { V, feasible, hasInterior, nearest, slacks, constraints }
 */
export function viabilityReport(state, set, opts = {}) {
  const sat = Number(opts.saturationScale) > 0 ? Number(opts.saturationScale) : 1;
  const s = slacks(state, set);
  let min = Infinity;
  let nearest = null;
  let feasible = true;
  let hasInterior = true;
  const eps = Number(opts.eps) || 0;
  for (const o of s) {
    if (o.normalized < 0) feasible = false;
    if (o.normalized <= eps) hasInterior = false;
    if (!Number.isFinite(o.normalized)) continue;
    if (!nearest || o.normalized < nearest.normalized) nearest = o;
    const eff = o.normalized / (o.weight > 0 ? o.weight : 1);
    if (eff < min) min = eff;
  }
  const V = !Number.isFinite(min) ? 1 : Math.max(0, Math.min(1, min / sat));
  return {
    V,
    feasible,
    hasInterior,
    nearest: nearest ? { id: nearest.id, which: nearest.which, slack: nearest.normalized } : null,
    slacks: s,
    constraints: s.length,
  };
}
