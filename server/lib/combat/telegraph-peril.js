// server/lib/combat/telegraph-peril.js
//
// A1 / F1.3 — typed attack telegraphs. A committed (heavy) attack broadcasts a
// PERIL KIND the defender must read and answer with the right counter, instead
// of a generic light/heavy windup. Souls/Sekiro "perilous attack" grammar:
//   thrust → step/dodge to the side (a block eats it)
//   sweep  → jump or hop (a low block fails)
//   grab   → break/dodge (a block does NOT stop a grab)
// Pure + deterministic so the resolver is testable; the combat route emits it
// and the dodge/block path can gate negation on the right counter.

// style/weapon token → peril kind. Only committed (heavy) attacks are perilous;
// light attacks return null (generic windup).
const PERIL_BY_TOKEN = [
  ["grapple", "grab"], ["clinch", "grab"], ["grab", "grab"], ["throw", "grab"],
  ["spear", "thrust"], ["rapier", "thrust"], ["lance", "thrust"], ["pierce", "thrust"], ["lunge", "thrust"],
  ["axe", "sweep"], ["scythe", "sweep"], ["greatsword", "sweep"], ["maul", "sweep"], ["hammer", "sweep"], ["sweep", "sweep"],
];

// peril kind → the defense action that negates it (others fail).
export const PERIL_COUNTER = Object.freeze({
  thrust: "dodge",   // step off-line
  sweep:  "jump",    // hop over
  grab:   "break",   // break/dodge — block does not stop a grab
});

/**
 * Resolve the peril kind + required counter for an attack. Returns
 * { perilKind, counter } or { perilKind: null } for a non-perilous (light) hit.
 */
export function perilFor({ style = null, weapon = null, kind = null, heavy = false } = {}) {
  if (!heavy) return { perilKind: null, counter: null };
  const hay = `${style || ""} ${weapon || ""} ${kind || ""}`.toLowerCase();
  for (const [token, peril] of PERIL_BY_TOKEN) {
    if (hay.includes(token)) return { perilKind: peril, counter: PERIL_COUNTER[peril] };
  }
  // A committed attack with no specific weapon reads as a heavy sweep.
  return { perilKind: "sweep", counter: PERIL_COUNTER.sweep };
}

/**
 * Does the defender's action negate this peril? `defenseAction` is one of
 * dodge | jump | block | parry | break. The right counter fully negates;
 * a parry counts as a universal (skill-timed) answer; everything else fails.
 */
export function counterNegates(perilKind, defenseAction) {
  if (!perilKind) return false;
  if (defenseAction === "parry") return true; // a frame-perfect parry beats any peril
  return defenseAction === PERIL_COUNTER[perilKind];
}
