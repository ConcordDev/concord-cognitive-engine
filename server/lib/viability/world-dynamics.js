// server/lib/viability/world-dynamics.js
//
// Wave 3 — the dynamics on top of the spine: corpus engines #3 (constraint
// phase-transition / collapse), #7 (cone-collapse / saturation), #26 (ecosystem
// repair-vs-damage). Pure decision math the viability-cycle heartbeat runs each
// pass:
//   classifyCollapse — V crossing the collapse floor fires a crisis (hysteresis
//     so it doesn't flap); recovery when it climbs back. The principled trigger
//     that replaces world-crisis.js's fixed 72h timers.
//   detectSaturation — when a binding axis bottoms out across enough cells, a
//     cascade is underway (#7).
//   logisticRegrow — carrying-capacity regrowth toward a cap (#26): a depleted-
//     but-not-extinct stock recovers, fastest at mid-stock.
// Pure, deterministic, zero-dep.

/** #26 — logistic (carrying-capacity) regrowth one step toward `capacity`. */
export function logisticRegrow(stock, capacity, rate) {
  const s = Math.max(0, Number(stock) || 0);
  const c = Math.max(1e-9, Number(capacity) || 1);
  const r = Number(rate) || 0;
  return Math.max(0, Math.min(c, s + r * s * (1 - s / c)));
}

/**
 * #3 — classify which subsystems entered or left collapse this pass. readings =
 * [{id, V}]. priorInCrisis = Set of ids already in crisis. Hysteresis: enter at
 * V≤crisisAt, only recover at V≥recoverAt (recoverAt > crisisAt) so it can't
 * flap on the boundary. Returns { entered, recovered, inCrisis }.
 */
export function classifyCollapse(readings, priorInCrisis = new Set(), { crisisAt = 0.05, recoverAt = 0.25 } = {}) {
  const entered = [];
  const recovered = [];
  const inCrisis = new Set(priorInCrisis);
  for (const { id, V } of readings || []) {
    const wasIn = inCrisis.has(id);
    if (!wasIn && V <= crisisAt) { entered.push(id); inCrisis.add(id); }
    else if (wasIn && V >= recoverAt) { recovered.push(id); inCrisis.delete(id); }
  }
  return { entered, recovered, inCrisis };
}

/** #7 — a saturation cascade is underway when ≥fracThreshold of cells are at the floor. */
export function detectSaturation(cellVs, { fracThreshold = 0.5, vFloor = 0.02 } = {}) {
  const arr = cellVs || [];
  if (arr.length === 0) return { saturated: false, fraction: 0 };
  const at = arr.filter((v) => (Number(v) || 0) <= vFloor).length;
  const fraction = at / arr.length;
  return { saturated: fraction >= fracThreshold, fraction };
}
