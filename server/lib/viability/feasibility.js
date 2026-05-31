// server/lib/viability/feasibility.js
//
// Engine #2 — Slater-style feasibility over a constraint set. Answers: is this
// state inside its viability region, how much margin to the nearest boundary,
// and (Slater's condition) does the region have a strict interior point here.
//
//   slack          — normalised signed margin for ONE constraint
//                    (>0 interior, 0 on boundary, <0 violated).
//   slacks         — per-constraint margins + which one is binding (tightest).
//   isFeasible     — { feasible, hasInterior, violations[] }.
//
// Pure, deterministic, zero-dep. Civic Bonds' fundBond gate calls isFeasible;
// Wave-1 viability-index builds on slacks(). Unmeasured box axes are treated as
// non-penalising (slack +Infinity) so a world without a reading isn't "collapsed".

import { normalizeState } from "./constraint-set.js";

// Distance to the nearest box boundary, in axis units (signed).
function _evalBox(x, c) {
  let raw = Infinity;
  let which = null;
  if (c.lo != null) {
    const d = x - c.lo;
    if (d < raw) { raw = d; which = "lo"; }
  }
  if (c.hi != null) {
    const d = c.hi - x;
    if (d < raw) { raw = d; which = "hi"; }
  }
  if (which == null) { raw = Infinity; } // unconstrained axis
  return { raw, which };
}

/** Normalised signed margin for a single constraint. >0 interior, <0 violated. */
export function slack(state, constraint) {
  if (!constraint) return Infinity;
  if (typeof constraint.g === "function") {
    const scale = Number.isFinite(constraint.scale) && constraint.scale > 0 ? constraint.scale : 1;
    const gv = Number(constraint.g(state));
    return Number.isFinite(gv) ? -gv / scale : Infinity;
  }
  const x = Number(state ? state[constraint.axis] : NaN);
  if (!Number.isFinite(x)) return Infinity; // unmeasured → don't penalise
  const defScale = (constraint.lo != null && constraint.hi != null)
    ? (Math.abs(constraint.hi - constraint.lo) || 1) : 1;
  const scale = Number.isFinite(constraint.scale) && constraint.scale > 0 ? constraint.scale : defScale;
  const { raw } = _evalBox(x, constraint);
  return raw === Infinity ? Infinity : raw / scale;
}

/**
 * Per-constraint margins. Each entry: { id, raw, normalized, which, weight,
 * binding }. `binding` flags the single tightest constraint (min normalized).
 */
export function slacks(state, set) {
  if (!set) return [];
  const ns = normalizeState(state, set);
  const out = [];
  for (const c of set.box) {
    const { raw, which } = _evalBox(ns[c.axis], c);
    out.push({
      id: c.axis,
      raw,
      normalized: raw === Infinity ? Infinity : raw / c.scale,
      which,
      weight: c.weight,
      binding: false,
    });
  }
  for (const c of set.general) {
    const gv = Number(c.g(state));
    const raw = Number.isFinite(gv) ? -gv : Infinity;
    out.push({
      id: c.name,
      raw,
      normalized: raw === Infinity ? Infinity : raw / c.scale,
      which: "g",
      weight: c.weight,
      binding: false,
    });
  }
  if (out.length) {
    let min = Infinity;
    for (const o of out) if (o.normalized < min) min = o.normalized;
    for (const o of out) o.binding = o.normalized === min;
  }
  return out;
}

/**
 * Slater feasibility. feasible = every constraint satisfied (normalized >= 0).
 * hasInterior = strict interior (every normalized > eps) — Slater's condition.
 * violations names what failed and by how much (positive magnitude).
 */
export function isFeasible(state, set, eps = 0) {
  const s = slacks(state, set);
  const violations = [];
  let hasInterior = true;
  for (const o of s) {
    if (o.normalized < 0) violations.push({ id: o.id, by: o.raw === Infinity ? Infinity : -o.raw });
    if (o.normalized <= eps) hasInterior = false;
  }
  return { feasible: violations.length === 0, hasInterior, violations };
}
