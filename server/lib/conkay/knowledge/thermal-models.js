// server/lib/conkay/knowledge/thermal-models.js
//
// Blend D brief item 4: thermal SCREENING models for a polymer with fillers.
// Pure functions, SI units, no defaults.
//
//   Maxwell (Maxwell–Garnett / Maxwell–Eucken), spheres:
//     k_c/k_m = (k_f + 2k_m + 2φ(k_f − k_m)) / (k_f + 2k_m − φ(k_f − k_m))
//   Lewis–Nielsen: k_c/k_m = (1 + A·B·φ)/(1 − B·Ψ·φ), B = (k_f/k_m − 1)/(k_f/k_m + A),
//     Ψ = 1 + φ(1 − φ_max)/φ_max²  (A, φ_max from the filler's shape and packing).
//   Both forms as stated in Bleija et al., Sci. Rep. 2024, 14, 13629, Table 3.
//   Neither has an interfacial (Kapitza) resistance: with it unknown, the result is
//   an upper estimate for a perfectly bonded filler, and the solvers say so.
//
//   CTE, two isotropic phases:
//     Turner: α = Σ φ_i α_i K_i / Σ φ_i K_i
//     Schapery: α = α_m + (α_f − α_m)(1/K − 1/K_m)/(1/K_f − 1/K_m), with K at the
//       Hashin–Shtrikman bulk-modulus bounds: two CTE bounds.

const finitePos = (v) => Number.isFinite(v) && v > 0;
const frac = (v) => Number.isFinite(v) && v >= 0 && v <= 1;
function need(c, m) { if (!c) throw new RangeError(m); }

export function maxwellK({ km, kf, phi }) {
  need(finitePos(km) && finitePos(kf), "conductivities must be > 0");
  need(frac(phi), "φ in [0, 1]");
  return (km * (kf + 2 * km + 2 * phi * (kf - km))) / (kf + 2 * km - phi * (kf - km));
}

export function lewisNielsenK({ km, kf, phi, A, phiMax }) {
  need(finitePos(km) && finitePos(kf), "conductivities must be > 0");
  need(frac(phi), "φ in [0, 1]");
  need(finitePos(A), "A > 0");
  need(Number.isFinite(phiMax) && phiMax > 0 && phiMax <= 1, "0 < φ_max ≤ 1");
  need(phi < phiMax, "φ must be below φ_max (the packing limit)");
  const r = kf / km;
  const B = (r - 1) / (r + A);
  const psi = 1 + (phi * (1 - phiMax)) / (phiMax * phiMax);
  const den = 1 - B * psi * phi;
  need(den > 0, "outside the model's range (1 − BΨφ ≤ 0)");
  return (km * (1 + A * B * phi)) / den;
}

export function cteTurner(phases) {
  need(Array.isArray(phases) && phases.length >= 2, "at least two phases");
  for (const p of phases) { need(frac(p.phi), "every φ in [0, 1]"); need(Number.isFinite(p.alpha), "every α finite"); need(finitePos(p.K), "every K > 0"); }
  need(Math.abs(phases.reduce((a, p) => a + p.phi, 0) - 1) < 1e-9, "volume fractions must sum to 1");
  return phases.reduce((a, p) => a + p.phi * p.alpha * p.K, 0) / phases.reduce((a, p) => a + p.phi * p.K, 0);
}

/** Hashin–Shtrikman bulk-modulus bounds for two isotropic phases. */
export function hsBulkBounds({ Km, Gm, Kf, Gf, phi }) {
  need([Km, Gm, Kf, Gf].every(finitePos), "moduli must be > 0");
  need(frac(phi), "φ in [0, 1]");
  const at = (K1, G1, K2, f2) => K1 + f2 / (1 / (K2 - K1) + (3 * (1 - f2)) / (3 * K1 + 4 * G1));
  const a = Kf >= Km ? at(Km, Gm, Kf, phi) : at(Kf, Gf, Km, 1 - phi);
  const b = Kf >= Km ? at(Kf, Gf, Km, 1 - phi) : at(Km, Gm, Kf, phi);
  return { lower: Math.min(a, b), upper: Math.max(a, b) };
}

export function cteSchapery({ alphaM, alphaF, Km, Gm, Kf, Gf, phi }) {
  need(Number.isFinite(alphaM) && Number.isFinite(alphaF), "α finite");
  need(Km !== Kf, "Schapery needs K_f ≠ K_m");
  const { lower, upper } = hsBulkBounds({ Km, Gm, Kf, Gf, phi });
  const at = (K) => alphaM + ((alphaF - alphaM) * (1 / K - 1 / Km)) / (1 / Kf - 1 / Km);
  const x = at(lower), y = at(upper);
  return { low: Math.min(x, y), high: Math.max(x, y) };
}
