// server/lib/probability/stochastic.js
//
// Engine N6 — probability = stochastic viability. Risk is a first-class object:
// risk = P(exit the viability set). Bayesian updating (beliefs from evidence),
// Markov chains (state evolution), and Monte-Carlo exit probability (the
// stochastic tie to the viability spine — a value random-walks; what's the
// chance it crosses a boundary in the horizon). Pure; cascades take an injectable
// rng. Upgrades forward-sim/prediction + every "chance" in the game.

function _normObj(o) {
  const sum = Object.values(o).reduce((a, b) => a + Math.max(0, b), 0);
  if (sum <= 0) return o;
  const out = {};
  for (const k of Object.keys(o)) out[k] = Math.max(0, o[k]) / sum;
  return out;
}

/** Bayesian update: posterior[h] ∝ prior[h]·likelihood[h], normalized. */
export function bayesUpdate(prior, likelihood) {
  const out = {};
  for (const h of Object.keys(prior)) out[h] = Math.max(0, prior[h]) * Math.max(0, likelihood[h] ?? 0);
  return _normObj(out);
}

/** Expected value of outcomes under a probability vector (arrays of equal length). */
export function expectedValue(outcomes, probs) {
  let e = 0;
  for (let i = 0; i < outcomes.length; i++) e += Number(outcomes[i]) * Number(probs[i] || 0);
  return e;
}

/** One Markov step: nextDist[j] = Σ_i dist[i]·P[i][j]. dist + P are arrays. */
export function markovStep(dist, P) {
  const n = dist.length;
  const next = new Array(n).fill(0);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) next[j] += dist[i] * (P[i]?.[j] || 0);
  return next;
}

/** Long-run stationary distribution via power iteration. */
export function stationaryDistribution(P, { iters = 200, start } = {}) {
  const n = P.length;
  let dist = start ? start.slice() : new Array(n).fill(1 / n);
  for (let k = 0; k < iters; k++) dist = markovStep(dist, P);
  const s = dist.reduce((a, b) => a + b, 0);
  return s > 0 ? dist.map((x) => x / s) : dist;
}

/**
 * Monte-Carlo probability that a value exits the viability band [lo, hi] within
 * `horizon` steps, under a random walk with `drift` per step + Gaussian
 * `volatility`. THIS is risk = P(exit the set) — the stochastic spine tie.
 * Deterministic with an injected rng (uniform 0..1). Returns a fraction 0..1.
 */
export function monteCarloExit(value, { drift = 0, volatility = 1, lo = -Infinity, hi = Infinity, horizon = 20, samples = 500, rng = Math.random } = {}) {
  if (volatility <= 0 && drift === 0) return (value < lo || value > hi) ? 1 : 0;
  let exits = 0;
  for (let s = 0; s < samples; s++) {
    let x = value;
    for (let t = 0; t < horizon; t++) {
      // Box-Muller-ish: two uniforms → an approx-normal shock.
      const u1 = Math.max(1e-12, rng()), u2 = rng();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      x += drift + volatility * z;
      if (x < lo || x > hi) { exits++; break; }
    }
  }
  return exits / samples;
}
