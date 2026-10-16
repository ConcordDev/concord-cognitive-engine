// server/lib/conkay/knowledge/viscoelastic-composite.js
//
// Dynamic moduli of a filled viscoelastic compound (any recipe) by the elastic–viscoelastic correspondence
// principle: the multi-phase Mori–Tanaka with randomly oriented spheroids (multiphase-elasticity.js), evaluated
// with complex moduli at one frequency. The matrix's complex Young's modulus comes from its Prony series
// (E′ + iE″, viscoelastic.js); its Poisson's ratio is held constant (an assumption, stated on every result),
// which keeps the Eshelby tensor real. Fillers are elastic.

import { eshelbyMandel, kgFromENu, isotropicPart } from "./multiphase-elasticity.js";
import { dynamicModuli } from "./viscoelastic.js";

// ---- complex arithmetic ----
const c = (re, im = 0) => ({ re, im });
const cadd = (a, b) => c(a.re + b.re, a.im + b.im);
const csub = (a, b) => c(a.re - b.re, a.im - b.im);
const cmul = (a, b) => c(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const cdiv = (a, b) => { const d = b.re * b.re + b.im * b.im; return c((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d); };
const cabs = (a) => Math.hypot(a.re, a.im);
const cscale = (a, s) => c(a.re * s, a.im * s);

const Z6 = () => Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => c(0)));
function cIsoMandel(K, G) {
  const M = Z6(), l = csub(K, cscale(G, 2 / 3));
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M[i][j] = i === j ? cadd(l, cscale(G, 2)) : l;
  for (let i = 3; i < 6; i++) M[i][i] = cscale(G, 2);
  return M;
}
const cmm = (A, B) => A.map((r) => B[0].map((_, j) => r.reduce((s, v, k) => cadd(s, cmul(v, B[k][j])), c(0))));
const rToC = (A) => A.map((r) => r.map((v) => c(v)));
function cinv(A) {
  const n = 6, M = A.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => c(i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    let p = col;
    for (let r = col + 1; r < n; r++) if (cabs(M[r][col]) > cabs(M[p][col])) p = r;
    if (cabs(M[p][col]) < 1e-300) throw new RangeError("singular tensor");
    [M[col], M[p]] = [M[p], M[col]];
    const d = M[col][col];
    for (let j = 0; j < 2 * n; j++) M[col][j] = cdiv(M[col][j], d);
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      for (let j = 0; j < 2 * n; j++) M[r][j] = csub(M[r][j], cmul(f, M[col][j]));
    }
  }
  return M.map((r) => r.slice(n));
}
function cIsotropicPart(T) {
  let iijj = c(0), tr = c(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) iijj = cadd(iijj, T[i][j]);
  for (let i = 0; i < 6; i++) tr = cadd(tr, T[i][i]);
  const a = cscale(iijj, 1 / 3);
  return { a, b: cscale(csub(tr, a), 1 / 5) };
}

/**
 * Complex Mori–Tanaka, random spheroids. matrix: { K, G } complex; inclusions: [{ phi, K, G, aspect }] real.
 * nu0: the matrix's (real, constant) Poisson's ratio for the Eshelby tensor.
 */
export function moriTanakaComplex(matrix, nu0, inclusions) {
  const fm = 1 - inclusions.reduce((a, p) => a + p.phi, 0);
  if (!(fm > 0)) throw new RangeError("inclusion fractions must sum below 1");
  const C0 = cIsoMandel(matrix.K, matrix.G), C0inv = cinv(C0);
  let nK = cscale(matrix.K, fm), dK = c(fm), nG = cscale(matrix.G, fm), dG = c(fm);
  for (const p of inclusions) {
    const S = rToC(eshelbyMandel(p.aspect, nu0));
    const Cr = cIsoMandel(c(p.K), c(p.G));
    const D = Cr.map((r, i) => r.map((v, j) => csub(v, C0[i][j])));
    const X = cmm(cmm(S, C0inv), D);
    const T = cinv(X.map((r, i) => r.map((v, j) => (i === j ? cadd(v, c(1)) : v))));
    const { a, b } = cIsotropicPart(T);
    nK = cadd(nK, cscale(cmul(c(p.K), a), p.phi)); dK = cadd(dK, cscale(a, p.phi));
    nG = cadd(nG, cscale(cmul(c(p.G), b), p.phi)); dG = cadd(dG, cscale(b, p.phi));
  }
  const K = cdiv(nK, dK), G = cdiv(nG, dG);
  const E = cdiv(cscale(cmul(K, G), 9), cadd(cscale(K, 3), G));
  return { K, G, E };
}

/**
 * The compound's dynamic Young's modulus at angular frequency ω from the matrix Prony series.
 * Returns { storage, loss, tanDelta, matrix: { storage, loss, tanDelta } }.
 */
export function compoundDynamicModuli({ prony, nuMatrix, inclusions, omega, aT = 1 }) {
  if (!(nuMatrix > -1 && nuMatrix < 0.5)) throw new RangeError("matrix ν must be in (−1, 0.5)");
  const m = dynamicModuli(prony, omega, aT);
  const Em = c(m.storage, m.loss);
  const K0 = cscale(Em, 1 / (3 * (1 - 2 * nuMatrix))), G0 = cscale(Em, 1 / (2 * (1 + nuMatrix)));
  const r = moriTanakaComplex({ K: K0, G: G0 }, nuMatrix, inclusions.map((p) => ({ phi: p.phi, ...kgFromENu(p.E, p.nu), aspect: p.aspect })));
  return { storage: r.E.re, loss: r.E.im, tanDelta: r.E.im / r.E.re, matrix: m };
}

export { isotropicPart };
