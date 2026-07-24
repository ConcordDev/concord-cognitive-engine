// server/lib/simulation/non-newtonian-flow.js
//
// Non-Newtonian internal pipe flow — quasi-1D, fully-developed, laminar.
// Sibling to server/lib/simulation/fea-solver.js (structural) and
// server/lib/simulation/circuit-solver.js (electrical): this module is the
// FLUID side of Wave W1-B's fluid-structure interaction gate
// (server/lib/asset-gen/fsi-gate.js), but it is a complete, standalone
// primitive on its own — usable anywhere a real non-Newtonian pipe-flow
// number is needed.
//
// ── Honest boundary (verbatim — also stamped on every FSI result) ───────
// Quasi-1D fully-developed laminar internal flow with a real non-Newtonian
// constitutive model, coupled to Euler-Bernoulli beam walls by fixed-point
// iteration. Full 3D Navier-Stokes, DNS, LES and any turbulence model are
// out of scope — the solver refuses above Re ≈ 2300 rather than
// extrapolating. Steady-state only: no inertia, no added-mass, no flutter,
// no transient FSI. Walls bend in one plane and must lie along global X
// (the underlying solver silently reports zero deflection for other
// orientations, so those are refused up front). Picard coupling is not
// unconditionally stable; above a critical wall compliance it diverges,
// and this module reports that as `coupling_diverged` rather than
// returning the last iterate as an answer.
export const HONEST_BOUNDARY =
  "Quasi-1D fully-developed laminar internal flow with a real non-Newtonian " +
  "constitutive model, coupled to Euler-Bernoulli beam walls by fixed-point " +
  "iteration. Full 3D Navier-Stokes, DNS, LES and any turbulence model are " +
  "out of scope — the solver refuses above Re ≈ 2300 rather than " +
  "extrapolating. Steady-state only: no inertia, no added-mass, no flutter, " +
  "no transient FSI. Walls bend in one plane and must lie along global X " +
  "(the underlying solver silently reports zero deflection for other " +
  "orientations, so those are refused up front). Picard coupling is not " +
  "unconditionally stable; above a critical wall compliance it diverges, " +
  "and this module reports that as `coupling_diverged` rather than " +
  "returning the last iterate as an answer.";

// ── Reuse — do NOT reimplement ───────────────────────────────────────────
// bisection: shear-rate inversion (τ(γ̇) is monotone for a physically
// admissible viscosity model, so bisection cannot diverge — it already
// returns an honest `converged:false` on exhaustion, unlike Newton-Raphson
// which can diverge or hit a zero-derivative case for this class of curve).
// adaptiveQuadrature: the flow-rate integral for the Carreau model, which
// has no closed form.
// reynoldsNumber / pipeFlow: the codebase's single existing Reynolds
// classification + Hagen-Poiseuille oracle — composed with, never
// duplicated (see generalisedReynolds below, and the Carreau/power-law
// tests, which check against pipeFlow as the n=1 / λ=0 closed-form limit).
import { bisection, adaptiveQuadrature } from "../compute/numerical.js";
import { reynoldsNumber, pipeFlow } from "../compute/physics-compute.js";

// ─────────────────────────────────────────────────────────────────────────
// Viscosity models
// ─────────────────────────────────────────────────────────────────────────

/**
 * Ostwald-de Waele power-law apparent viscosity: μ_app = K · γ̇^(n-1).
 * n<1 shear-thinning, n=1 Newtonian (μ_app ≡ K), n>1 shear-thickening.
 * A shear-thinning fluid (n<1) evaluated at exactly γ̇=0 is a genuine
 * power-law model SINGULARITY (μ_app → ∞) — a documented feature of the
 * model, not a bug in this function; callers computing a flow rate never
 * hit this because they integrate γ̇ over a stress boundary condition, not
 * evaluate viscosity at a bare zero shear rate.
 * @param {{K:number, n:number, shearRate:number}} p
 * @returns {number} Pa·s
 */
export function powerLawViscosity({ K, n, shearRate }) {
  return K * Math.pow(shearRate, n - 1);
}

/**
 * Carreau viscosity model: μ = μ_∞ + (μ_0−μ_∞)·[1+(λγ̇)²]^((n−1)/2).
 * Bounded between μ_0 (zero-shear plateau) and μ_∞ (infinite-shear
 * plateau) for any finite γ̇ ≥ 0 when μ_0 ≥ μ_∞ ≥ 0 — unlike the power
 * law, this model has no zero-shear singularity.
 * @param {{mu0:number, muInf:number, lambda:number, n:number, shearRate:number}} p
 * @returns {number} Pa·s
 */
export function carreauViscosity({ mu0, muInf, lambda, n, shearRate }) {
  const term = Math.pow(1 + Math.pow(lambda * shearRate, 2), (n - 1) / 2);
  return muInf + (mu0 - muInf) * term;
}

// ─────────────────────────────────────────────────────────────────────────
// Power-law pipe flow — Rabinowitsch-Mooney closed form
// ─────────────────────────────────────────────────────────────────────────

/**
 * Q = (πn/(3n+1))·R³·(ΔP·R/(2KL))^(1/n) — the closed-form Rabinowitsch-
 * Mooney volumetric flow rate for a power-law fluid in fully-developed
 * laminar circular-pipe flow. At n=1, K=μ this is IDENTICAL (not merely
 * approximately equal) to Hagen-Poiseuille — see this file's test suite
 * for the hand-verified <1e-12 relative agreement against
 * physics-compute.js#pipeFlow, the oracle for that limit.
 * Same parameter names as physics-compute.js#pipeFlow (diameter, lengthM,
 * pressureDropPa) plus the power-law pair (K, n), so the two are directly
 * comparable/interchangeable at n=1.
 * @param {{K:number, n:number, diameter:number, lengthM:number, pressureDropPa:number}} p
 * @returns {number} m³/s (sign follows pressureDropPa — a negative drop
 *   yields reverse flow, an honest generalization, not a special case)
 */
export function powerLawPipeFlow({ K, n, diameter, lengthM, pressureDropPa }) {
  const R = diameter / 2;
  const sign = Math.sign(pressureDropPa) || 0;
  if (sign === 0) return 0;
  const magnitude =
    ((Math.PI * n) / (3 * n + 1)) *
    Math.pow(R, 3) *
    Math.pow((Math.abs(pressureDropPa) * R) / (2 * K * lengthM), 1 / n);
  return sign * magnitude;
}

// ─────────────────────────────────────────────────────────────────────────
// Carreau pipe flow — no closed form: bisection (per-radius shear-rate
// inversion) + adaptiveQuadrature (the flow-rate integral)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Invert τ = μ(γ̇)·γ̇ for γ̇ given a target wall/local shear stress τ, via
 * bisection (τ(γ̇) is monotone increasing for any physically admissible
 * viscosity model bounded between finite plateaus, so bisection cannot
 * diverge). τ=0 short-circuits to γ̇=0 exactly (the centerline of the
 * pipe, r=0) without invoking bisection at all — an exact, not
 * approximated, degenerate case.
 * Bracket expansion: starts at hi=1 and doubles until f(hi) ≥ 0 (τ(γ̇) is
 * unbounded as γ̇→∞ whenever μ_∞>0, or grows like γ̇^n whenever μ_∞=0 and
 * n>0 — either way a bracket exists and is found in a bounded number of
 * doublings for any physically reasonable input).
 * @param {number} tau target shear stress, Pa
 * @param {(gammaDot:number)=>number} viscosityFn
 * @param {{tolerance?:number, maxIter?:number, maxDoublings?:number}} [opts]
 * @returns {{gammaDot:number, converged:boolean, iterations:number}}
 */
export function invertShearRate(tau, viscosityFn, opts = {}) {
  const { tolerance = 1e-10, maxIter = 200, maxDoublings = 200 } = opts;
  if (tau === 0) return { gammaDot: 0, converged: true, iterations: 0 };
  const sign = Math.sign(tau);
  const absTau = Math.abs(tau);
  const f = (g) => viscosityFn(g) * g - absTau;
  let hi = 1;
  let doublings = 0;
  while (f(hi) < 0 && doublings < maxDoublings) {
    hi *= 2;
    doublings++;
  }
  const res = bisection(f, 0, hi, { tolerance, maxIter });
  return { gammaDot: sign * res.root, converged: res.converged, iterations: res.iterations };
}

/**
 * Carreau-model volumetric flow rate in fully-developed laminar circular-
 * pipe flow. No closed form exists (unlike the power law), so this
 * function does the real numeric work: for each radial station r ∈ [0,R],
 * the local shear stress τ(r) = ΔP·r/(2L) is inverted for the local shear
 * rate γ̇(r) via `invertShearRate` (bisection), then the flow rate is the
 * SINGLE exact integral Q = π·∫₀^R r²·γ̇(r) dr (the standard
 * integration-by-parts reduction of ∫v·2πr dr using dv/dr=-γ̇(r) and
 * v(R)=0 — not a re-derived approximation), evaluated via
 * adaptiveQuadrature.
 * At λ=0 (or n=1) the Carreau model collapses to a constant viscosity
 * μ_0, and the FULL bisection+quadrature path here must reproduce
 * Hagen-Poiseuille to <1e-10 — see this file's test suite. This exercises
 * every piece of the numeric machinery at once, so a transposed sign or a
 * wrong integrand cannot hide behind a shortcut.
 * @param {{mu0:number, muInf:number, lambda:number, n:number, diameter:number, lengthM:number, pressureDropPa:number}} p
 * @param {{tolerance?:number, shearRateOpts?:object}} [opts]
 * @returns {number} m³/s
 */
export function carreauPipeFlow(
  { mu0, muInf, lambda, n, diameter, lengthM, pressureDropPa },
  opts = {}
) {
  const { tolerance = 1e-10, shearRateOpts } = opts;
  const R = diameter / 2;
  if (pressureDropPa === 0) return 0;
  const sign = Math.sign(pressureDropPa);
  const absDP = Math.abs(pressureDropPa);
  const viscosityFn = (gammaDot) => carreauViscosity({ mu0, muInf, lambda, n, shearRate: gammaDot });
  const integrand = (r) => {
    if (r <= 0) return 0;
    const tau = (absDP * r) / (2 * lengthM);
    const { gammaDot } = invertShearRate(tau, viscosityFn, shearRateOpts);
    return r * r * gammaDot;
  };
  const magnitude = Math.PI * adaptiveQuadrature(integrand, 0, R, tolerance);
  return sign * magnitude;
}

// ─────────────────────────────────────────────────────────────────────────
// Generalized Reynolds number (Metzner-Reed) — composes with, does not
// duplicate, physics-compute.js#reynoldsNumber
// ─────────────────────────────────────────────────────────────────────────

/**
 * Metzner-Reed apparent viscosity: the value that, fed into the ORDINARY
 * Newtonian Reynolds number Re=ρvD/μ, reproduces the standard generalized
 * Reynolds number for power-law pipe flow:
 *   Re_MR = ρ·v^(2-n)·D^n / [8^(n-1) · K · ((3n+1)/(4n))^n]
 * Algebraically solving Re = ρvD/μ_app = Re_MR for μ_app gives the closed
 * form used here:
 *   μ_app = K · ((3n+1)/(4n))^n · (8v/D)^(n-1)
 * (Chhabra & Richardson, "Non-Newtonian Flow and Applied Rheology" — the
 * standard textbook generalized-Reynolds construction for power-law pipe
 * flow.) At n=1 this reduces to μ_app=K exactly, the Newtonian case.
 * @param {{K:number, n:number, velocity:number, diameter:number}} p
 * @returns {number} Pa·s
 */
export function apparentViscosityMetznerReed({ K, n, velocity, diameter }) {
  return K * Math.pow((3 * n + 1) / (4 * n), n) * Math.pow((8 * Math.abs(velocity)) / diameter, n - 1);
}

/**
 * Generalized (Metzner-Reed) Reynolds number for a power-law fluid in
 * pipe flow, computed by feeding the apparent wall viscosity into the
 * SAME existing physics-compute.js#reynoldsNumber the rest of the
 * codebase already uses — so the laminar/transitional/turbulent
 * classification (`regime`) is the codebase's one existing bucketing,
 * never a second copy of the 2300/4000 thresholds.
 * v=0 short-circuits to Re=0 exactly (bypassing the apparent-viscosity
 * formula entirely, which has a genuine 0^(n-1) singularity at v=0 for
 * n<1 — a known power-law-model feature, not a computation this function
 * needs to perform when the answer is trivially zero).
 * @param {{K:number, n:number, density:number, velocity:number, diameter:number}} p
 * @returns {{value:number, unit:string, formula:string, inputs:object, regime:string, apparentViscosity:number}}
 */
export function generalisedReynolds({ K, n, density, velocity, diameter }) {
  if (velocity === 0) {
    const res = reynoldsNumber({ velocity: 0, length: diameter, density, viscosity: 1 });
    return { ...res, apparentViscosity: null, method: "metzner-reed" };
  }
  const muApp = apparentViscosityMetznerReed({ K, n, velocity, diameter });
  const res = reynoldsNumber({ velocity, length: diameter, density, viscosity: muApp });
  return { ...res, apparentViscosity: muApp, method: "metzner-reed" };
}

// Standard laminar/transitional/turbulent cutoff for internal pipe flow —
// the SAME threshold physics-compute.js#reynoldsNumber already buckets on
// (Re>2300 transitional, Re>4000 turbulent). Not re-derived here; only
// read back off the `regime` field so there is exactly one copy of the
// thresholds in the codebase.
export const LAMINAR_REGIME = "laminar";

/**
 * Hard precondition: refuse to proceed above the laminar regime rather
 * than extrapolate a fully-developed laminar closed form into a
 * transitional/turbulent flow it does not model. Reads the `regime`
 * field an existing reynoldsNumber()/generalisedReynolds() result already
 * carries — does not recompute or re-threshold Re itself.
 * @param {{value:number, regime:string}} reynoldsResult output of
 *   reynoldsNumber() or generalisedReynolds()
 * @returns {{ok:boolean, reason?:string, Re?:number, regime?:string}}
 */
export function assertLaminar(reynoldsResult) {
  if (
    !reynoldsResult ||
    typeof reynoldsResult.value !== "number" ||
    !Number.isFinite(reynoldsResult.value) ||
    typeof reynoldsResult.regime !== "string"
  ) {
    return { ok: false, reason: "invalid_reynolds_input" };
  }
  const { value: Re, regime } = reynoldsResult;
  if (regime !== LAMINAR_REGIME) {
    return { ok: false, reason: "non_laminar_regime_unsupported", Re, regime };
  }
  return { ok: true, Re, regime };
}

// Re-exported for callers that want the Newtonian oracle without a second
// import — never duplicated, just surfaced.
export { pipeFlow as newtonianPipeFlowOracle };
