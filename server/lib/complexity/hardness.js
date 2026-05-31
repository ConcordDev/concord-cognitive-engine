// server/lib/complexity/hardness.js
//
// Wave 5 #31 — computational hardness. The canonical result: random k-SAT has a
// sharp difficulty PHASE TRANSITION at a critical clause/variable ratio
// (3-SAT αc ≈ 4.267). Under-constrained instances are trivially satisfiable,
// over-constrained ones are trivially UNSAT, and the genuinely-HARD instances
// cluster right at the threshold where satisfiability flips. This gives a
// principled difficulty model — used to derive a procedural puzzle's difficulty
// from its structure instead of a hand-set 1..5. Pure, zero-dep.

export const SAT_3_CRITICAL_RATIO = 4.267;

/**
 * Random-3-SAT instance hardness 0..1, peaking at the critical clause/variable
 * ratio and decaying on both sides (a Gaussian bump in ratio space — the
 * hardness cliff). 1 at the threshold, →0 for trivially-easy (low α) or
 * trivially-UNSAT (high α) instances.
 */
export function satHardness(numClauses, numVars, { critical = SAT_3_CRITICAL_RATIO, width = 1.5 } = {}) {
  const v = Math.max(1, Number(numVars) || 0);
  const c = Math.max(0, Number(numClauses) || 0);
  const alpha = c / v;
  if (alpha <= 0) return 0;
  const d = (alpha - critical) / Math.max(1e-6, width);
  return Math.exp(-0.5 * d * d);
}

/** The clause count that puts an n-variable instance at the hardness threshold. */
export function criticalClauses(numVars, critical = SAT_3_CRITICAL_RATIO) {
  return Math.round(Math.max(1, Number(numVars) || 0) * critical);
}

/** Map a 0..1 hardness score to a 1..5 difficulty tier. */
export function tierFromScore(score) {
  const s = Math.max(0, Math.min(1, Number(score) || 0));
  return Math.max(1, Math.min(5, Math.floor(s * 5) + 1));
}

/**
 * Derive a programming puzzle's difficulty from its structure — the number of
 * test cases it must satisfy (constraints), the optimal program size (search
 * depth), and the optimal cycle count (runtime complexity). Monotone: more of
 * any signal → harder. Returns { score 0..1, tier 1..5, regime }.
 */
export function puzzleHardness({ optimalCycles = 0, optimalSize = 0, testCases = 0 } = {}) {
  const cases = Math.max(0, Number(testCases) || 0);
  const size = Math.max(0, Number(optimalSize) || 0);
  const cycles = Math.max(0, Number(optimalCycles) || 0);
  const score = Math.min(1, (cases / 12) * 0.4 + (size / 30) * 0.35 + (cycles / 200) * 0.25);
  const regime = score < 0.33 ? "gentle" : score < 0.66 ? "moderate" : "steep";
  return { score, tier: tierFromScore(score), regime };
}
