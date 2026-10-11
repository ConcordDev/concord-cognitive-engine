// server/lib/conkay/knowledge/rule-of-mixtures.js
//
// Rule-of-mixtures density of a mixture from its constituents' densities.
//
//   mass basis:    1/ρ = Σ w_i / ρ_i     (w = mass fractions)
//   volume basis:    ρ = Σ φ_i · ρ_i     (φ = volume fractions)
//
// Both assume additive volumes and NO voids (a compounded composite usually
// has some porosity, which lowers the real density), so the result is an
// ESTIMATE and is labelled so. It is only computed when every constituent has
// a cited density; a single unknown constituent density makes the result
// unknown, and the receipt says which input is missing.
//
// Ranges: the composition ranges and the density intervals are both
// propagated. With fractions constrained to Σ = 100 % inside their ranges,
// the extreme densities are found exactly by a greedy fill (the objective is
// linear in the fractions: specific volume on mass basis, density on volume
// basis): start every ingredient at its minimum, then give the remaining
// percentage to the ingredients that move the result furthest, in order.

import crypto from "node:crypto";

export const SOLVER = { id: "rule-of-mixtures-density", version: "1.0.0" };

const canon = (o) => JSON.stringify(o, (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v));

/** Point density (kg/m³) for fractions f (0..1 summing to 1) and densities rho (kg/m³). */
export function mixtureDensity(f, rho, basis) {
  if (basis === "mass") return 1 / f.reduce((a, w, i) => a + w / rho[i], 0);
  if (basis === "volume") return f.reduce((a, p, i) => a + p * rho[i], 0);
  throw new Error(`basis must be mass or volume (got ${basis})`);
}

/** Fractions (0..1) within [min,max] % summing to 100 % that extremise a linear objective with coefficient c_i. */
function greedy(ranges, coeff, maximize) {
  const f = ranges.map((r) => r.min);
  let rest = 100 - f.reduce((a, b) => a + b, 0);
  const order = ranges.map((_, i) => i).sort((a, b) => (maximize ? coeff[b] - coeff[a] : coeff[a] - coeff[b]) || a - b);
  for (const i of order) {
    const add = Math.min(rest, ranges[i].max - ranges[i].min);
    f[i] += add;
    rest -= add;
  }
  return f.map((x) => x / 100);
}

/**
 * inputs: [{ id, fractionPct | {min,max} (percent), density: { lo, hi } kg/m³ | null, claimRef }]
 * basis: "mass" | "volume"
 * Returns { ok, status, value, range, receipt } or { ok:false, status:"unknown", missing, receipt }.
 */
export function ruleOfMixturesDensity({ inputs, basis, pointFractions, assumptions = [], label }) {
  const missing = inputs.filter((x) => !x.density || !(x.density.lo > 0 && x.density.hi >= x.density.lo)).map((x) => x.id);
  const receiptBase = {
    solver: SOLVER.id,
    solverVersion: SOLVER.version,
    formula: basis === "mass" ? "1/ρ = Σ w_i/ρ_i (mass fractions; additive volumes, no voids)" : "ρ = Σ φ_i·ρ_i (volume fractions; no voids)",
    basis,
    inputs: inputs.map((x) => ({ id: x.id, fraction: x.fraction, density: x.density, claimRef: x.claimRef || null })),
    assumptions,
  };
  if (missing.length) {
    const receipt = { ...receiptBase, outputs: null, result: "not computed", reason: `no cited density for: ${missing.join(", ")}` };
    receipt.id = `receipt:${SOLVER.id}:${sha(receipt).slice(0, 16)}`;
    return { ok: false, status: "unknown", missing, receipt };
  }
  const ranges = inputs.map((x) => x.fraction);
  // coefficient of the linear objective per percent: specific volume (mass) or density (volume)
  const coefHi = inputs.map((x) => (basis === "mass" ? 1 / x.density.hi : x.density.hi));
  const coefLo = inputs.map((x) => (basis === "mass" ? 1 / x.density.lo : x.density.lo));
  const rhoHi = inputs.map((x) => x.density.hi);
  const rhoLo = inputs.map((x) => x.density.lo);
  // highest density: densest-possible constituents, fill the densest first
  const fHi = greedy(ranges, coefHi, basis !== "mass");
  const fLo = greedy(ranges, coefLo, basis === "mass");
  const high = mixtureDensity(fHi, rhoHi, basis);
  const low = mixtureDensity(fLo, rhoLo, basis);
  let point = null;
  if (pointFractions) {
    const mid = inputs.map((x) => (x.density.lo + x.density.hi) / 2);
    point = mixtureDensity(pointFractions.map((p) => p / 100), mid, basis);
  }
  const outputs = {
    densityKgM3: { low, high, nominal: point },
    extremeCompositions: {
      low: Object.fromEntries(inputs.map((x, i) => [x.id, round(fLo[i] * 100, 6)])),
      high: Object.fromEntries(inputs.map((x, i) => [x.id, round(fHi[i] * 100, 6)])),
    },
    nominalNote: point == null ? null : "nominal = proposed-version fractions with each constituent at its interval midpoint",
  };
  const receipt = { ...receiptBase, outputs, result: "computed", label: label || null };
  receipt.id = `receipt:${SOLVER.id}:${sha(receipt).slice(0, 16)}`;
  return { ok: true, status: "estimated", value: point, range: { min: low, max: high }, receipt };
}

function sha(o) { return crypto.createHash("sha256").update(canon(o)).digest("hex"); }
function round(x, d) { const k = 10 ** d; return Math.round(x * k) / k; }
