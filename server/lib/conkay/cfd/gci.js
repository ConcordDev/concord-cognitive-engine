// server/lib/conkay/cfd/gci.js
//
// Grid Convergence Index, the five-step procedure of
//   Celik, Ghia, Roache, Freitas, Coleman & Raad, "Procedure for Estimation and Reporting of
//   Uncertainty Due to Discretization in CFD Applications", J. Fluids Eng. 130(7):078001 (2008).
// Equation numbers below are the paper's (as printed in the ASME JFE editorial-policy PDF
// JFENumAccuracy.pdf, whose Table 1 tests/conkay-cfd-gci.test.js reproduces).
//
// Pure functions. Invalid input throws. A series the procedure cannot honestly turn into an
// uncertainty (oscillatory, divergent, a zero difference, a non-converging order iteration)
// returns status NOT_COMPUTED with the reason and NO gciFine21: never a number.
//
// What this is not: GCI estimates discretization error of the solutions it is given. It says
// nothing about turbulence-model error, iterative error, or whether the grids are in the
// asymptotic range beyond the asymptoticRatio it reports.

export const GCI_VERSION = "1.0.0";
export const GCI_SAFETY_FACTOR = 1.25; // Fs for a three-grid study (the paper, after Eq. 7)
export const MIN_REFINEMENT_RATIO = 1.3; // "desirable ... r greater than 1.3" (Step 2); experience, not derivation

const MAX_ITER = 1000;
const TOL = 1e-12;

function finite(x, name) {
  if (typeof x !== "number" || !Number.isFinite(x)) throw new Error(`gci: ${name} must be a finite number, got ${x}`);
  return x;
}

/** Representative cell size h = (V / N)^(1/dim) (Eq. 1 for dim 3, Eq. 2 for dim 2), for a uniform-volume basis. */
export function representativeH(cells, domainSize, dim = 3) {
  finite(cells, "cells"); finite(domainSize, "domainSize");
  if (!(cells > 0)) throw new Error("gci: cells must be > 0");
  if (!(domainSize > 0)) throw new Error("gci: domainSize must be > 0");
  if (dim !== 2 && dim !== 3) throw new Error("gci: dim must be 2 or 3");
  return (domainSize / cells) ** (1 / dim);
}

/**
 * gci({ phi: [phi1, phi2, phi3], h: [h1, h2, h3] }, { allowOscillatory = false })
 * Index 1 is the finest grid. h must be strictly increasing. Returns
 *   { status, convergence, r21, r32, epsilon21, epsilon32, p, phiExt21, phiExt32, ea21, eext21,
 *     gciFine21, gciCoarse32, asymptoticRatio, notes[], reason? }
 * with relative errors as fractions (0.015 = 1.5 %).
 * convergence: "monotonic" | "oscillatory" | "divergent" | "indeterminate".
 * Oscillatory series are NOT_COMPUTED unless allowOscillatory (the paper still prints a number for them,
 * Table 1 column 3; this module does not report one by default).
 */
export function gci(input, { allowOscillatory = false } = {}) {
  if (!input || !Array.isArray(input.phi) || !Array.isArray(input.h)) throw new Error("gci: need { phi: [..3], h: [..3] }");
  if (input.phi.length !== 3 || input.h.length !== 3) throw new Error("gci: exactly three solutions and three cell sizes are required");
  const [f1, f2, f3] = input.phi.map((v, i) => finite(v, `phi[${i}]`));
  const [h1, h2, h3] = input.h.map((v, i) => finite(v, `h[${i}]`));
  if (!(h1 > 0)) throw new Error("gci: h must be positive");
  if (!(h1 < h2 && h2 < h3)) throw new Error("gci: h must be strictly increasing (h1 finest < h2 < h3 coarsest)");

  const r21 = h2 / h1, r32 = h3 / h2;
  const e21 = f2 - f1, e32 = f3 - f2;
  const out = { status: "NOT_COMPUTED", convergence: "indeterminate", r21, r32, epsilon21: e21, epsilon32: e32, p: null, phiExt21: null, phiExt32: null, ea21: null, eext21: null, gciFine21: null, gciCoarse32: null, asymptoticRatio: null, notes: [] };
  const scale = Math.max(Math.abs(f1), Math.abs(f2), Math.abs(f3));
  const tiny = 1e-12 * (scale || 1);
  if (r21 < MIN_REFINEMENT_RATIO || r32 < MIN_REFINEMENT_RATIO) {
    out.notes.push(`refinement ratio r21 ${r21.toFixed(3)} / r32 ${r32.toFixed(3)} is below ${MIN_REFINEMENT_RATIO} (the paper's "desirable" minimum)`);
  }
  if (Math.abs(e21) <= tiny || Math.abs(e32) <= tiny) {
    out.reason = "a successive difference is zero (to rounding): the paper's procedure does not apply (Step 3); refine further";
    return out;
  }
  const ratio = e32 / e21;
  const s = ratio > 0 ? 1 : -1; // Eq. 3c
  out.convergence = s < 0 ? "oscillatory" : "monotonic";
  if (s < 0 && !allowOscillatory) {
    out.reason = "oscillatory convergence (epsilon32/epsilon21 < 0): the solution does not approach a limit monotonically, so no GCI is reported";
    return out;
  }

  // Eq. 3 by fixed-point iteration from the first term. Signed for s = +1 so that a series whose
  // coarse pair differs LESS than its fine pair (error growing as h shrinks) comes out p <= 0 and
  // is reported divergent; the paper's absolute value would turn that into a positive order.
  const lnr21 = Math.log(r21);
  const base = Math.log(Math.abs(ratio));
  const lead = s > 0 ? base : Math.abs(base);
  let p = lead / lnr21;
  let converged = false;
  for (let i = 0; i < MAX_ITER; i++) {
    const a = r21 ** p - s, b = r32 ** p - s;
    if (!(a / b > 0) || !Number.isFinite(a / b)) { out.reason = "the order iteration (Eq. 3b) left its domain; no apparent order"; return out; }
    const q = Math.log(a / b);
    const pn = (s > 0 ? base + q : Math.abs(base + q)) / lnr21;
    if (!Number.isFinite(pn)) { out.reason = "the order iteration produced a non-finite value"; return out; }
    if (Math.abs(pn - p) < TOL * Math.max(1, Math.abs(p))) { p = pn; converged = true; break; }
    p = pn;
  }
  if (!converged) { out.reason = `the apparent-order fixed-point iteration (Eq. 3) did not converge in ${MAX_ITER} steps`; return out; }
  if (s > 0 && !(p > 0)) {
    out.convergence = "divergent";
    out.p = p;
    out.reason = `apparent order ${p.toFixed(3)} <= 0: the difference between solutions grows as the grid is refined (divergent), so no GCI is reported`;
    return out;
  }
  if (!(p > 0)) { out.reason = "non-positive apparent order"; return out; }

  const rp21 = r21 ** p, rp32 = r32 ** p;
  const ext21 = (rp21 * f1 - f2) / (rp21 - 1); // Eq. 4
  const ext32 = (rp32 * f2 - f3) / (rp32 - 1);
  if (f1 === 0) { out.reason = "phi1 is zero: the relative errors (Eqs. 5-6) are undefined"; return out; }
  if (ext21 === 0) { out.reason = "the extrapolated value is zero: the extrapolated relative error (Eq. 6) is undefined"; return out; }
  const ea21 = Math.abs((f1 - f2) / f1); // Eq. 5
  const eext21 = Math.abs((ext21 - f1) / ext21); // Eq. 6
  const gciFine21 = (GCI_SAFETY_FACTOR * ea21) / (rp21 - 1); // Eq. 7
  const ea32 = Math.abs((f2 - f3) / f2);
  const gciCoarse32 = f2 === 0 ? null : (GCI_SAFETY_FACTOR * ea32) / (rp32 - 1);
  Object.assign(out, {
    status: "COMPUTED", p, phiExt21: ext21, phiExt32: ext32, ea21, eext21, gciFine21, gciCoarse32,
    // ~1 when the three grids are in the asymptotic range (Celik 2008, after Eq. 7 / Roache 1998)
    asymptoticRatio: gciCoarse32 === null ? null : gciCoarse32 / (rp21 * gciFine21),
  });
  if (s < 0) out.notes.push("oscillatory series evaluated only because allowOscillatory was set; treat as indicative");
  return out;
}
