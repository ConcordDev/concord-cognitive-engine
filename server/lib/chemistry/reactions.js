// server/lib/chemistry/reactions.js
//
// Engine N8 — chemistry = reaction equilibria as FIXED POINTS (the same shape as
// the economics market price + the materials stress balance). Law of mass action
// gives reaction rates; a reversible reaction settles at the equilibrium ratio
// K = kf/kb; the system advances to a fixed point where net rate ≈ 0. The math
// behind craft-resolve affinity blending, the steam/brine evaluateCombos
// (water+fire→steam), and cooking transforms. Pure, deterministic, zero-dep.
//
// A reaction: { reactants:{species:stoich}, products:{species:stoich}, k,
//               catalyst?:species } — a catalyst multiplies k without depletion.

/** Law of mass action: rate = k · Π [reactant]^stoich (× catalyst conc if any). */
export function massActionRate(reaction, state) {
  let rate = Number(reaction.k) || 0;
  for (const [sp, n] of Object.entries(reaction.reactants || {})) {
    rate *= Math.pow(Math.max(0, Number(state[sp]) || 0), n);
  }
  if (reaction.catalyst) rate *= Math.max(0, Number(state[reaction.catalyst]) || 0);
  return rate;
}

/** Advance all reactions one Euler timestep; returns a new clamped state. */
export function stepConcentrations(state, reactions, dt = 0.01) {
  const next = { ...state };
  for (const rxn of reactions) {
    const flux = massActionRate(rxn, state) * dt;
    for (const [sp, n] of Object.entries(rxn.reactants || {})) next[sp] = (next[sp] ?? 0) - n * flux;
    for (const [sp, n] of Object.entries(rxn.products || {})) next[sp] = (next[sp] ?? 0) + n * flux;
  }
  for (const k of Object.keys(next)) next[k] = Math.max(0, next[k]);
  return next;
}

/** Run to the fixed point (equilibrium = net rate ≈ 0). Returns { state, trajectory, settled }. */
export function simulateToEquilibrium(state, reactions, { steps = 5000, dt = 0.01, tol = 1e-6 } = {}) {
  let s = { ...state };
  const trajectory = [{ ...s }];
  let settled = false;
  for (let i = 0; i < steps; i++) {
    const nextS = stepConcentrations(s, reactions, dt);
    let maxDelta = 0;
    for (const k of Object.keys(nextS)) maxDelta = Math.max(maxDelta, Math.abs(nextS[k] - (s[k] ?? 0)));
    s = nextS;
    if (i % 50 === 0) trajectory.push({ ...s });
    if (maxDelta < tol) { settled = true; break; }
  }
  return { state: s, trajectory, settled };
}

/**
 * Closed-form equilibrium of a reversible A ⇌ B with forward/backward rate
 * constants. At equilibrium kf·[A] = kb·[B] → [B]/[A] = kf/kb = K, with
 * [A]+[B] = total conserved. Returns { A, B, K }.
 */
export function reversibleEquilibrium(kf, kb, total) {
  const K = kf / kb;                 // [B]/[A]
  const A = total / (1 + K);
  const B = total - A;
  return { A, B, K };
}
