// server/lib/conkay/knowledge/micromechanics.js
//
// Blend D brief item 3: stiffness and strength SCREENING models for a
// polymer with fillers. Pure functions, SI units, no defaults: every input is
// given or the caller reports NOT_COMPUTED.
//
//   Voigt / Reuss — the iso-strain / iso-stress bounds, any number of phases.
//   Halpin–Tsai — E_c/E_m = (1 + ξηφ)/(1 − ηφ), η = (E_f/E_m − 1)/(E_f/E_m + ξ).
//     Short fibres: ξ_L = 2·l/d (longitudinal), ξ_T = 2 (transverse); random in
//     plane by Tsai–Pagano E = 3/8·E11 + 5/8·E22 (Serra-Parareda et al.,
//     Polymers 2021, 13(4), 619, eqs. 6–10). Platelets: ξ = 2·D/t parallel to
//     the load and ξ = 2 across it (Tarani et al., Polymers 2020, 12(8), 1719,
//     §3, "ξ can be taken as 2 l/t"). Spheres: ξ = 2.
//   Mori–Tanaka — spherical isotropic inclusions only (the closed form for
//     bulk and shear moduli; for a filler stiffer than the matrix it equals
//     the Hashin–Shtrikman lower bound).
//   Kelly–Tyson (modified, Bowyer–Bader form) — short-fibre strength:
//     σ_c = χ1·(X + Y) + Z, X = Σ τ·l·V_l/d (l < l_c), Y = Σ σ_f·V_l·(1 − σ_f·d/(4τl))
//     (l ≥ l_c), Z = (1 − V_f)·σ_m*, l_c = d·σ_f/(2τ) (Del Rey et al.,
//     Polymers 2017, 9(8), 377, §3.2 eqs. 2–5 and 9).
//
// Every model here assumes a perfect bond and no voids; Halpin–Tsai and
// Mori–Tanaka assume dilute-to-moderate loading. Results are screening
// numbers, not properties of record.

const finitePos = (v) => Number.isFinite(v) && v > 0;
const frac = (v) => Number.isFinite(v) && v >= 0 && v <= 1;

function need(cond, msg) {
  if (!cond) throw new RangeError(msg);
}

/** Iso-strain (upper) bound: Σ φ_i E_i. phases: [{ phi, E }]. */
export function voigt(phases) {
  need(Array.isArray(phases) && phases.length >= 2, "at least two phases");
  for (const p of phases) { need(frac(p.phi), "every φ in [0, 1]"); need(finitePos(p.E), "every modulus > 0"); }
  need(Math.abs(phases.reduce((a, p) => a + p.phi, 0) - 1) < 1e-9, "volume fractions must sum to 1");
  return phases.reduce((a, p) => a + p.phi * p.E, 0);
}

/** Iso-stress (lower) bound: 1 / Σ (φ_i / E_i). */
export function reuss(phases) {
  need(Array.isArray(phases) && phases.length >= 2, "at least two phases");
  for (const p of phases) { need(frac(p.phi), "every φ in [0, 1]"); need(finitePos(p.E), "every modulus > 0"); }
  need(Math.abs(phases.reduce((a, p) => a + p.phi, 0) - 1) < 1e-9, "volume fractions must sum to 1");
  return 1 / phases.reduce((a, p) => a + p.phi / p.E, 0);
}

/** Halpin–Tsai for one filler: E_c = E_m (1 + ξηφ)/(1 − ηφ). */
export function halpinTsai({ Em, Ef, phi, xi }) {
  need(finitePos(Em) && finitePos(Ef), "moduli must be > 0");
  need(frac(phi), "φ in [0, 1]");
  need(Number.isFinite(xi) && xi >= 0, "ξ ≥ 0");
  const r = Ef / Em;
  const eta = (r - 1) / (r + xi);
  return (Em * (1 + xi * eta * phi)) / (1 - eta * phi);
}

/**
 * Short fibres (aspect l/d) or platelets (aspect D/t): the longitudinal (load along the fibre / in the
 * platelet plane), the transverse value, and the Tsai–Pagano random-in-plane estimate.
 */
export function halpinTsaiOriented({ Em, Ef, phi, aspect }) {
  need(finitePos(aspect), "aspect ratio > 0");
  const E11 = halpinTsai({ Em, Ef, phi, xi: 2 * aspect });
  const E22 = halpinTsai({ Em, Ef, phi, xi: 2 });
  return { E11, E22, randomInPlane: (3 / 8) * E11 + (5 / 8) * E22 };
}

/** E, ν → K, G (isotropic). */
export function bulkShear(E, nu) {
  need(finitePos(E), "E > 0");
  need(Number.isFinite(nu) && nu > -1 && nu < 0.5, "−1 < ν < 0.5");
  return { K: E / (3 * (1 - 2 * nu)), G: E / (2 * (1 + nu)) };
}

/** Mori–Tanaka, spherical isotropic inclusions: { E, nu, K, G } of the composite. */
export function moriTanakaSpheres({ Em, num, Ef, nuf, phi }) {
  need(frac(phi), "φ in [0, 1]");
  const m = bulkShear(Em, num), f = bulkShear(Ef, nuf);
  const K = m.K + (phi * (f.K - m.K)) / (1 + ((1 - phi) * (f.K - m.K)) / (m.K + (4 / 3) * m.G));
  const fm = (m.G * (9 * m.K + 8 * m.G)) / (6 * (m.K + 2 * m.G));
  const G = m.G + (phi * (f.G - m.G)) / (1 + ((1 - phi) * (f.G - m.G)) / (m.G + fm));
  return { K, G, E: (9 * K * G) / (3 * K + G), nu: (3 * K - 2 * G) / (2 * (3 * K + G)) };
}

/** Critical fibre length l_c = d·σ_f/(2τ). */
export function criticalLength({ d, sigmaF, tau }) {
  need(finitePos(d) && finitePos(sigmaF) && finitePos(tau), "d, σ_f and τ must be > 0");
  return (d * sigmaF) / (2 * tau);
}

/**
 * Modified Kelly–Tyson strength: fibres given as a length distribution [{ l, V }] (V = volume fraction of
 * fibres of that length, Σ V = V_f), orientation factor χ1 in (0, 1], matrix stress at composite failure σ_m*.
 */
export function kellyTyson({ fibres, d, sigmaF, tau, sigmaMStar, chi1 }) {
  need(Array.isArray(fibres) && fibres.length > 0, "at least one fibre length");
  for (const f of fibres) { need(finitePos(f.l), "every fibre length > 0"); need(frac(f.V), "every fibre fraction in [0, 1]"); }
  need(Number.isFinite(sigmaMStar) && sigmaMStar >= 0, "σ_m* ≥ 0");
  need(Number.isFinite(chi1) && chi1 > 0 && chi1 <= 1, "0 < χ1 ≤ 1");
  const lc = criticalLength({ d, sigmaF, tau });
  const Vf = fibres.reduce((a, f) => a + f.V, 0);
  need(Vf <= 1, "Σ V ≤ 1");
  let X = 0, Y = 0;
  for (const f of fibres) {
    if (f.l < lc) X += (tau * f.l * f.V) / d;
    else Y += sigmaF * f.V * (1 - (sigmaF * d) / (4 * tau * f.l));
  }
  const Z = (1 - Vf) * sigmaMStar;
  return { sigmaC: chi1 * (X + Y) + Z, lc, X, Y, Z, Vf };
}
