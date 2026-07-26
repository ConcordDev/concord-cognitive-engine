// server/lib/simulation/degradation-kinetics.js
//
// W1-A — Long-horizon materials degradation engine, pure kinetics layer.
// No FEA here (that's durability-gate.js) — these functions compute the
// TIME EVOLUTION of a degradation state from real, textbook kinetics laws
// (Arrhenius, Paris-Erdogan, Fickian diffusion), reusing this codebase's
// own ODE integrator (server/lib/compute/numerical.js#rk4ODE) rather than
// reimplementing one. Per CLAUDE.md's "compute-don't-guess" doctrine and
// the sibling server/lib/asset-gen/{thermal,aero}-gate.js precedent, this
// module does not touch fea-solver.js, numerical.js, or MATERIAL_LIBRARY.
//
// ── Honest boundary (read before trusting a number this module returns) ─
// Empirical-kinetics engineering practice, not first-principles materials
// physics. Atomistic/molecular-dynamics simulation is out of scope: no
// bond-scale chemistry, no polymer chain-scission mechanism, no
// microstructural evolution. Arrhenius, Paris-Erdogan and Fickian
// diffusion are phenomenological laws whose constants are fitted to
// short-term accelerated tests; this engine extrapolates those fits. No
// 50-year field data is used or claimed. The kinetic-extent → stiffness/
// strength knock-down law is the least-standardised step: there is no
// universal form, the default here is one cited empirical fit, and it is
// caller-overridable precisely because it should be calibrated per
// material system before any result is relied on.
export const HONEST_BOUNDARY =
  'Empirical-kinetics engineering practice, not first-principles materials ' +
  'physics. Atomistic/molecular-dynamics simulation is out of scope: no ' +
  'bond-scale chemistry, no polymer chain-scission mechanism, no ' +
  'microstructural evolution. Arrhenius, Paris-Erdogan and Fickian ' +
  'diffusion are phenomenological laws whose constants are fitted to ' +
  'short-term accelerated tests; this engine extrapolates those fits. No ' +
  '50-year field data is used or claimed. The kinetic-extent → stiffness/ ' +
  'strength knock-down law is the least-standardised step: there is no ' +
  'universal form, the default here is one cited empirical fit, and it is ' +
  'caller-overridable precisely because it should be calibrated per ' +
  'material system before any result is relied on.';

import { rk4ODE } from '../compute/numerical.js';

// CODATA 2018 exact value, J/(mol·K) — same constant used by
// degradation-constants.js's cited activation energies.
export const GAS_CONSTANT_J_PER_MOL_K = 8.314462618;

export const SECONDS_PER_YEAR = 365.25 * 24 * 3600; // Julian year, matches standard engineering-durability convention

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

// ── Arrhenius kinetics ───────────────────────────────────────────────────

/**
 * k = A · exp(-Ea / (R·T)) — the Arrhenius rate constant.
 * @param {{A:number, Ea_J_per_mol:number, temperatureK:number}} opts
 * @returns {number} rate constant, same time-unit as A (e.g. A in s^-1 → k in s^-1)
 */
export function arrheniusRate({ A, Ea_J_per_mol, temperatureK }) {
  return A * Math.exp(-Ea_J_per_mol / (GAS_CONSTANT_J_PER_MOL_K * temperatureK));
}

/**
 * k(T2)/k(T1) = exp[-(Ea/R)·(1/T2 - 1/T1)] — the Arrhenius temperature-
 * ratio correction. Notably independent of the pre-exponential factor A
 * (it cancels), which is why this is the form used to temperature-correct
 * a diffusion coefficient cited only with an Ea (see degradation-
 * constants.js's concrete/cfrp entries, both with arrhenius.A === null).
 * @param {{Ea_J_per_mol:number, T1_K:number, T2_K:number}} opts
 * @returns {number} dimensionless ratio k(T2)/k(T1)
 */
export function arrheniusRatio({ Ea_J_per_mol, T1_K, T2_K }) {
  return Math.exp((-Ea_J_per_mol / GAS_CONSTANT_J_PER_MOL_K) * (1 / T2_K - 1 / T1_K));
}

// ── Paris-Erdogan fatigue crack growth ───────────────────────────────────

/**
 * ΔK = Δσ · Y · √(π·a) — the stress intensity factor range for a crack of
 * length `a` under a remote stress range Δσ, with dimensionless geometry
 * factor Y (Y=1 for an idealized center/edge crack in an infinite plate;
 * real geometries use a handbook Y — this module does not compute Y, the
 * caller supplies it).
 *
 * UNIT CONVENTION: this function is unit-agnostic — pass deltaSigma in
 * MPa and a in meters to get ΔK directly in MPa·√m, the SAME unit
 * convention the Paris-law constants in degradation-constants.js are
 * fitted in (matching this codebase's existing convention of keeping
 * MATERIAL_LIBRARY's E/yield in MPa at the "raw" table level and only
 * converting to Pa when interfacing with the Pa-based FEA solver — see
 * durability-gate.js).
 * @param {{deltaSigma:number, Y:number, a:number}} opts
 * @returns {number} ΔK, same stress unit as deltaSigma times √(length unit of a)
 */
export function stressIntensityRange({ deltaSigma, Y, a }) {
  return deltaSigma * Y * Math.sqrt(Math.PI * a);
}

/**
 * da/dN = C · ΔK^m — the Paris-regime (Region II) fatigue crack growth
 * rate. `deltaK` must already be in the SAME units the material's `C`
 * was fit in (per-material `units` field in degradation-constants.js —
 * typically MPa·√m).
 * @param {{C:number, m:number, deltaK:number}} opts
 * @returns {number} da/dN, in the length-per-cycle unit `C` was fit in (typically m/cycle)
 */
export function parisGrowthRate({ C, m, deltaK }) {
  return C * Math.pow(deltaK, m);
}

/**
 * Closed-form Paris-law fatigue life via the separable integral:
 *
 *   N = [a_f^(1−m/2) − a_0^(1−m/2)] / [C·(Δσ·Y·√π)^m·(1−m/2)]
 *
 * Derivation: da/dN = C·(Δσ·Y·√(π·a))^m = C·(Δσ·Y·√π)^m · a^(m/2), so
 * a^(-m/2)·da = C·(Δσ·Y·√π)^m·dN; integrating both sides from a0→af and
 * 0→N gives the formula above. Undefined at m=2 (the integral of a^-1 is
 * a natural log, not a power law) — returns an honest
 * `{valid:false, reason:'m_equals_2_requires_log_form'}` rather than
 * silently dividing by zero or returning Infinity/NaN.
 * @param {{C:number, m:number, deltaSigma:number, Y:number, a0:number, af:number}} opts
 * @returns {{valid:boolean, reason?:string, cycles?:number}}
 */
export function parisLifeClosedForm({ C, m, deltaSigma, Y, a0, af }) {
  if (m === 2) {
    return { valid: false, reason: 'm_equals_2_requires_log_form' };
  }
  const deltaKCoeff = deltaSigma * Y * Math.sqrt(Math.PI); // ΔK = deltaKCoeff · √a
  const exponent = 1 - m / 2;
  const cycles =
    (Math.pow(af, exponent) - Math.pow(a0, exponent)) /
    (exponent * C * Math.pow(deltaKCoeff, m));
  return { valid: true, cycles };
}

/**
 * The Paris-law crack-growth ODE rate function da/dN(a), for use with
 * rk4ODE (or any other integrator) to march crack length over CYCLES.
 * Exported so both this module's own integrateDegradation and test code
 * can reuse the exact same rate function the closed-form derivation above
 * was derived from (server/tests/degradation-kinetics.test.js's Paris-
 * closed-form-vs-RK4 cross-check).
 * @param {{C:number, m:number, deltaSigma:number, Y:number}} opts
 * @returns {(N:number, a:number) => number}
 */
export function parisCrackGrowthOde({ C, m, deltaSigma, Y }) {
  return (_N, a) => parisGrowthRate({ C, m, deltaK: stressIntensityRange({ deltaSigma, Y, a }) });
}

// ── Fickian diffusion (Crank / Shen-Springer series) ─────────────────────

// Number of odd-mode series terms used both by fickianUptakeFraction and
// its exact term-by-term time-derivative (fickianRatePerSecond) below.
// Fixed (not caller-tunable) so the closed-form value and its derivative
// always stay mutually consistent — the whole point of deriving one from
// the other analytically rather than approximating separately.
//
// Why 100, not fewer: this series converges SLOWLY for small Dt/h² — the
// exponential decay of term j only kicks in once (2j+1)²·π²·Dt/h² is
// O(1), so small Dt/h² needs many terms before truncation error is
// negligible (a real, well-known property of this series representation,
// which is exactly why the literature also derives the complementary
// short-time √t approximation this module cross-checks against). Verified
// empirically: 16 terms gives ~5% relative error vs the short-time
// approximation at Dt/h²=1e-4; 100 terms converges to <1e-13 relative
// error across Dt/h² from 1e-4 up through 50 (see server/tests/
// degradation-kinetics.test.js).
const FICKIAN_SERIES_TERMS = 100;

// Below this Dt/h² threshold, the short-time √t approximation is treated
// as valid (see fickianUptakeFraction's `shortTimeValid` flag). The
// literature short-time approximation is generally accurate to a few
// percent up to Mt/M∞ ≈ 0.5-0.6 (Crank, "The Mathematics of Diffusion");
// this module gates conservatively tighter, at Dt/h² ≤ 0.01, matching the
// <1e-5 relative-error tolerance server/tests/degradation-kinetics.test.js
// checks the approximation against in that regime.
export const SHORT_TIME_VALIDITY_THRESHOLD = 0.01;

/**
 * Fractional moisture/ionic uptake M(t)/M∞ for 1D Fickian diffusion into
 * a slab of full thickness `h`, diffusing symmetrically from both faces
 * (the Crank / Shen-Springer series solution used throughout composite
 * moisture-absorption and concrete chloride-ingress literature):
 *
 *   M(t)/M∞ = 1 − (8/π²)·Σ_{j=0}^{∞} [1/(2j+1)²]·exp(−(2j+1)²·π²·D·t/h²)
 *
 * truncated to FICKIAN_SERIES_TERMS terms (negligible error — each term's
 * weight falls off as 1/(2j+1)² AND its own exponential decays faster for
 * higher j, so 16 terms is comfortably converged for any t>0).
 *
 * Also returns the standard short-time approximation
 * `4/h · √(D·t/π)` (Crank, valid for small Dt/h² — see
 * SHORT_TIME_VALIDITY_THRESHOLD) and an honest `shortTimeValid` flag so a
 * caller never silently uses the short-time formula outside its validity
 * range.
 * @param {number} t seconds
 * @param {number} D diffusion coefficient, m^2/s
 * @param {number} h slab full thickness, m
 * @returns {{value:number, shortTimeApprox:number, shortTimeValid:boolean, dtOverHSquared:number}}
 */
export function fickianUptakeFraction(t, D, h) {
  if (!(t >= 0) || !(D >= 0) || !(h > 0)) {
    return { value: NaN, shortTimeApprox: NaN, shortTimeValid: false, dtOverHSquared: NaN };
  }
  let series = 0;
  for (let j = 0; j < FICKIAN_SERIES_TERMS; j++) {
    const n = 2 * j + 1;
    series += Math.exp(-(n * n) * Math.PI * Math.PI * D * t / (h * h)) / (n * n);
  }
  const value = t === 0 ? 0 : 1 - (8 / (Math.PI * Math.PI)) * series;
  const dtOverHSquared = (D * t) / (h * h);
  const shortTimeApprox = (4 / h) * Math.sqrt((D * t) / Math.PI);
  // Relative epsilon guard against floating-point round-trip noise right
  // at the boundary (a caller computing t from a target Dt/h² ratio can
  // land a hair above the threshold purely from double-precision
  // rounding) — not a loosening of the honest threshold itself.
  const shortTimeValid = dtOverHSquared <= SHORT_TIME_VALIDITY_THRESHOLD * (1 + 1e-9);
  return { value, shortTimeApprox, shortTimeValid, dtOverHSquared };
}

/**
 * Exact term-by-term time-derivative of fickianUptakeFraction's series —
 * d/dt[M(t)/M∞]. Derivation: differentiating the series above term-by-
 * term, the 1/(2j+1)² weight cancels EXACTLY against the chain-rule factor
 * from differentiating exp(-(2j+1)²π²Dt/h²), leaving:
 *
 *   dM/dt = (8D/h²) · Σ_{j=0}^{∞} exp(−(2j+1)²·π²·D·t/h²)
 *
 * (no 1/(2j+1)² weight in the derivative — every term contributes equally
 * at the derivative level). Uses the SAME FICKIAN_SERIES_TERMS truncation
 * as fickianUptakeFraction so the two stay analytically consistent.
 *
 * Honest caveat: exactly at t=0 the true (infinite-term) series diverges
 * — a real, known feature of the idealized step-boundary-condition
 * Fickian model (the surface flux is nominally infinite the instant a dry
 * slab first contacts a saturated environment; real materials have a
 * boundary layer that prevents this). With a FINITE term count this
 * function returns a large-but-finite value at t=0 instead — an
 * approximation artifact of the truncation, not a modeling claim that the
 * initial flux is actually finite. This function is used only internally
 * by integrateDegradation's ODE march (which takes a finite first step
 * away from t=0); it is not presented as an oracle-grade result on its
 * own.
 * @param {number} t seconds
 * @param {number} D diffusion coefficient, m^2/s
 * @param {number} h slab full thickness, m
 * @returns {number} d(M/M∞)/dt, per second
 */
export function fickianRatePerSecond(t, D, h) {
  let series = 0;
  for (let j = 0; j < FICKIAN_SERIES_TERMS; j++) {
    const n = 2 * j + 1;
    series += Math.exp(-(n * n) * Math.PI * Math.PI * D * t / (h * h));
  }
  return (8 * D / (h * h)) * series;
}

// ── Multi-mechanism time-domain integration ──────────────────────────────

// An engineering ASSUMPTION for how many load cycles a structure sees per
// year — in the same spirit as fea-gate.js's DEFAULT_TIP_LOAD_N: a
// placeholder "moderate" figure (roughly one significant cyclic event per
// working day), NOT a measured value for any specific structure or duty
// cycle. Override via fatigue.cyclesPerYear.
export const DEFAULT_CYCLES_PER_YEAR = 300;

/**
 * March a 3-channel degradation state — [a_crack, thermalExtent,
 * leachFraction] — forward in time via rk4ODE (server/lib/compute/
 * numerical.js), from t=0 to `years`, at `dtYears`-year steps. Each
 * channel is driven ONLY when its mechanism is requested AND its
 * constants are genuinely available (see degradation-constants.js#
 * mechanismAvailable) — an unrequested or uncited channel's rate is
 * identically zero, so its state stays at its initial value for the
 * whole integration (an honest, testable degrade-to-baseline case).
 *
 * Channel rate laws (all cited/derived above in this file):
 *   - a_crack:        da/dt = cyclesPerYear · parisGrowthRate(...) — the
 *                      Paris law with real per-year cycle-count scaling.
 *                      Genuine state feedback: ΔK depends on the CURRENT
 *                      a, so this reproduces the Paris closed form when
 *                      integrated (see server/tests/degradation-kinetics.
 *                      test.js).
 *   - thermalExtent:  dθ/dt = k(T)·(1−θ), a standard first-order
 *                      saturating extent-of-reaction kinetics form (the
 *                      textbook solution to an irreversible first-order
 *                      process, θ(t)=1−e^(−kt)), with k(T) the Arrhenius
 *                      rate constant. NEVER actually driven for any
 *                      material shipped in degradation-constants.js (none
 *                      carries an absolute A) — requesting 'thermal'
 *                      always refuses honestly (see integrateDegradation's
 *                      precondition check below).
 *   - leachFraction:  dM/dt = fickianRatePerSecond(...), the exact
 *                      derivative of the same Fickian series
 *                      fickianUptakeFraction uses, so integrating this
 *                      channel converges to the SAME closed-form uptake
 *                      fraction as t grows (never an independently-
 *                      approximated curve).
 *
 * Refuses `{ok:false, reason:'crack_exceeds_section'}` the instant the
 * marched a_crack reaches or exceeds `fatigue.thickness` — rather than
 * continuing to march (and later report) a crack state past the point
 * where the beam-section idealization itself is no longer meaningful.
 *
 * @param {object} opts
 * @param {string[]} opts.mechanisms subset of ['fatigue','thermal','moisture']
 * @param {object|null} opts.constants a getDegradationConstants() result (or null)
 * @param {{deltaSigma:number, Y:number, a0?:number, thickness:number, cyclesPerYear?:number}} [opts.fatigue]
 * @param {{temperatureK:number}} [opts.thermal]
 * @param {{h:number}} [opts.moisture] (temperature-correction of D is the caller's job via arrheniusRatio, applied before calling this — see durability-gate.js)
 * @param {number} [opts.years=50]
 * @param {number} [opts.dtYears=0.05]
 * @returns {{ok:boolean, reason?:string, failureYear?:number, t?:number, a_crack?:number, thermalExtent?:number, leachFraction?:number, honestBoundary:string}}
 */
export function integrateDegradation(opts = {}) {
  const {
    mechanisms = [],
    constants = null,
    fatigue,
    thermal,
    moisture,
    years = 50,
    dtYears = 0.05,
  } = opts;

  const wantFatigue = mechanisms.includes('fatigue');
  const wantThermal = mechanisms.includes('thermal');
  const wantMoisture = mechanisms.includes('moisture');

  if (wantFatigue && (!constants?.paris || !fatigue || !Number.isFinite(fatigue.thickness))) {
    return { ok: false, reason: 'missing_degradation_constants', mechanism: 'fatigue', honestBoundary: HONEST_BOUNDARY };
  }
  if (wantThermal && (!constants?.arrhenius || !Number.isFinite(constants.arrhenius.A) || !thermal)) {
    return { ok: false, reason: 'missing_degradation_constants', mechanism: 'thermal', honestBoundary: HONEST_BOUNDARY };
  }
  if (wantMoisture && (!constants?.diffusion || !moisture)) {
    return { ok: false, reason: 'missing_degradation_constants', mechanism: 'moisture', honestBoundary: HONEST_BOUNDARY };
  }

  const a0 = wantFatigue ? (fatigue.a0 ?? 0) : 0;
  const y0 = [a0, 0, 0];

  const rate = (tYears, y) => {
    const [a] = y;
    let daDt = 0, dThetaDt = 0, dMDt = 0;

    if (wantFatigue) {
      const cyclesPerYear = fatigue.cyclesPerYear ?? DEFAULT_CYCLES_PER_YEAR;
      const deltaK = stressIntensityRange({ deltaSigma: fatigue.deltaSigma, Y: fatigue.Y, a });
      daDt = parisGrowthRate({ C: constants.paris.C, m: constants.paris.m, deltaK }) * cyclesPerYear;
    }
    if (wantThermal) {
      const kPerSecond = arrheniusRate({
        A: constants.arrhenius.A,
        Ea_J_per_mol: constants.arrhenius.Ea_J_per_mol,
        temperatureK: thermal.temperatureK,
      });
      const kPerYear = kPerSecond * SECONDS_PER_YEAR;
      dThetaDt = kPerYear * (1 - y[1]);
    }
    if (wantMoisture) {
      const tSeconds = tYears * SECONDS_PER_YEAR;
      const ratePerSecond = fickianRatePerSecond(tSeconds, constants.diffusion.D_m2_s, moisture.h);
      dMDt = ratePerSecond * SECONDS_PER_YEAR;
    }
    return [daDt, dThetaDt, dMDt];
  };

  const trace = rk4ODE(rate, y0, 0, years, dtYears);

  if (wantFatigue) {
    for (const step of trace) {
      if (step.y[0] >= fatigue.thickness) {
        return {
          ok: false,
          reason: 'crack_exceeds_section',
          failureYear: step.t,
          honestBoundary: HONEST_BOUNDARY,
        };
      }
    }
  }

  const final = trace[trace.length - 1];
  return {
    ok: true,
    t: final.t,
    a_crack: final.y[0],
    thermalExtent: clamp01(final.y[1]),
    leachFraction: clamp01(final.y[2]),
    honestBoundary: HONEST_BOUNDARY,
  };
}
