// server/lib/viability/constraint-set.js
//
// Viability / constraint-geometry core (engine #2) — the shared math spine the
// whole engine program imports. This module represents a CONSTRAINT SET: the
// region of state space in which a thing stays viable.
//
// Two constraint kinds:
//   box axis  { axis, lo, hi, scale?, weight? }   — feasible when lo <= x <= hi
//                lo or hi may be null for one-sided (e.g. pressure > 0.006 atm
//                → { axis:'pressure', lo:0.006, hi:null }).
//   general   { name, g:(state)=>number, scale?, weight? } — feasible when g(state) <= 0
//
//   scale  = the axis's characteristic width, used to normalise distance-to-
//            boundary so a 100°C axis and a 0..1 air-quality axis are comparable.
//            Defaults to |hi-lo| for a two-sided box, else 1.
//   weight = how hard a binding axis pulls the viability index down (default 1).
//
// Pure, deterministic, zero-dependency. First stood up minimally in Wave 0 so
// Civic Bonds' escrow-floor (B>=B_min) and funding-gate (T<=capacity) call the
// SAME `isFeasible` the later engines do — pay for the spine once.

function _pos(n, fallback) {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/**
 * Build a frozen constraint set from a flat list of box/general constraints.
 * @returns {{ box: object[], general: object[], axes: Set<string> }}
 */
export function makeConstraintSet(constraints = []) {
  const box = [];
  const general = [];
  const axes = new Set();
  for (const c of constraints || []) {
    if (!c || typeof c !== "object") continue;
    if (typeof c.g === "function") {
      general.push(Object.freeze({
        name: String(c.name ?? "g"),
        g: c.g,
        scale: _pos(c.scale, 1),
        weight: _pos(c.weight, 1),
      }));
    } else if (c.axis != null) {
      const lo = c.lo == null ? null : Number(c.lo);
      const hi = c.hi == null ? null : Number(c.hi);
      const defScale = (lo != null && hi != null) ? (Math.abs(hi - lo) || 1) : 1;
      box.push(Object.freeze({
        axis: String(c.axis),
        lo: lo != null && Number.isFinite(lo) ? lo : null,
        hi: hi != null && Number.isFinite(hi) ? hi : null,
        scale: _pos(c.scale, defScale),
        weight: _pos(c.weight, 1),
      }));
      axes.add(String(c.axis));
    }
  }
  return Object.freeze({ box, general, axes });
}

/**
 * Project a raw state object onto the set's axes, filling unmeasured axes with a
 * neutral default (midpoint of a bounded axis, else the present bound, else 0).
 * "No data → don't penalise" — matches the embodied-signals degrade-graceful
 * convention. Returns a plain { axis: number } map.
 */
export function normalizeState(state = {}, set) {
  const out = {};
  if (!set || !set.box) return out;
  for (const c of set.box) {
    const v = state ? state[c.axis] : undefined;
    if (v != null && Number.isFinite(Number(v))) {
      out[c.axis] = Number(v);
    } else if (c.lo != null && c.hi != null) {
      out[c.axis] = (c.lo + c.hi) / 2;
    } else if (c.lo != null) {
      out[c.axis] = c.lo;
    } else if (c.hi != null) {
      out[c.axis] = c.hi;
    } else {
      out[c.axis] = 0;
    }
  }
  return out;
}
