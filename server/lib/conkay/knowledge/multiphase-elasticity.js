// server/lib/conkay/knowledge/multiphase-elasticity.js
//
// Effective isotropic stiffness of an N-phase composite (any recipe):
//
// 1. Hashin–Shtrikman–Walpole bounds (statistically isotropic, any phase geometry, isotropic phases):
//      Λ(z) = [Σ φ_i/(K_i + 4z/3)]⁻¹ − 4z/3,   Γ(z) = [Σ φ_i/(G_i + z)]⁻¹ − z,   ζ(K,G) = (G/6)(9K + 8G)/(K + 2G)
//      K± = Λ(G_max / G_min),  G± = Γ(ζ(K_max, G_max) / ζ(K_min, G_min))
//    (the Walpole form, valid when the stiffest-in-bulk and stiffest-in-shear phases differ). Both bounds rise
//    with every phase modulus, so a property interval maps exactly: the upper bound at every phase's high
//    K and G, the lower bound at every low one.
//
// 2. Mori–Tanaka with randomly oriented spheroidal inclusions in one matrix (Benveniste's multi-phase form):
//      T_r = [I + S_r C₀⁻¹ (C_r − C₀)]⁻¹ (dilute strain concentration), S_r the Eshelby tensor of a spheroid
//      of aspect ω in the matrix; random orientation keeps only T_r's isotropic part a_r J + b_r K,
//      a = T_iijj/3, b = (T_ijij − a)/5;  K* = Σ φ_r K_r a_r / Σ φ_r a_r,  G* = Σ φ_r G_r b_r / Σ φ_r b_r
//      (matrix a = b = 1). The Eshelby tensor is Appendix A of Takao-style geometrical factors (H3, H31) as
//      printed in Heliyon 2024, e25274 (doi:10.1016/j.heliyon.2024.e25274, eqs. A.1–A.3).
//
// Tensors are 6×6 in Mandel notation (shear rows/columns scaled by √2) so that double contraction is matrix
// multiplication and inversion is matrix inversion.

const R2 = Math.SQRT2;

export function kgFromENu(E, nu) {
  if (!(E > 0) || !(nu > -1 && nu < 0.5)) throw new RangeError("need E > 0 and −1 < ν < 0.5");
  return { K: E / (3 * (1 - 2 * nu)), G: E / (2 * (1 + nu)) };
}
export const eNuFromKG = (K, G) => ({ E: (9 * K * G) / (3 * K + G), nu: (3 * K - 2 * G) / (2 * (3 * K + G)) });

/** K and G intervals from E and ν intervals (independent: conservative). */
export function kgIntervals(E, nu) {
  return { K: { lo: kgFromENu(E.lo, nu.lo).K, hi: kgFromENu(E.hi, nu.hi).K }, G: { lo: kgFromENu(E.lo, nu.hi).G, hi: kgFromENu(E.hi, nu.lo).G } };
}

function hsAt(phases, Kp, Gp) {
  const Lambda = (z) => 1 / phases.reduce((a, p, i) => a + p.phi / (Kp[i] + (4 * z) / 3), 0) - (4 * z) / 3;
  const Gamma = (z) => 1 / phases.reduce((a, p, i) => a + p.phi / (Gp[i] + z), 0) - z;
  const zeta = (K, G) => (G / 6) * ((9 * K + 8 * G) / (K + 2 * G));
  const Kmax = Math.max(...Kp), Kmin = Math.min(...Kp), Gmax = Math.max(...Gp), Gmin = Math.min(...Gp);
  return {
    upper: { K: Lambda(Gmax), G: Gamma(zeta(Kmax, Gmax)) },
    lower: { K: Lambda(Gmin), G: Gamma(zeta(Kmin, Gmin)) },
  };
}

/**
 * phases: [{ phi, K: {lo,hi}, G: {lo,hi} }] with Σφ = 1. Returns the HS upper bound at every phase's high
 * moduli and the lower bound at every phase's low moduli, each with E and ν.
 */
export function hashinShtrikman(phases) {
  if (!Array.isArray(phases) || phases.length < 1) throw new RangeError("need at least one phase");
  const sum = phases.reduce((a, p) => a + p.phi, 0);
  if (phases.some((p) => !(p.phi >= 0)) || Math.abs(sum - 1) > 1e-9) throw new RangeError(`volume fractions must be ≥ 0 and sum to 1 (got ${sum})`);
  for (const p of phases) if (!(p.K?.lo > 0 && p.K.hi >= p.K.lo && p.G?.lo > 0 && p.G.hi >= p.G.lo)) throw new RangeError("each phase needs K and G intervals with 0 < lo ≤ hi");
  const hi = hsAt(phases, phases.map((p) => p.K.hi), phases.map((p) => p.G.hi)).upper;
  const lo = hsAt(phases, phases.map((p) => p.K.lo), phases.map((p) => p.G.lo)).lower;
  return { upper: { ...hi, ...eNuFromKG(hi.K, hi.G) }, lower: { ...lo, ...eNuFromKG(lo.K, lo.G) } };
}

// ---- Mandel-notation tensor algebra ----
const ID6 = () => Array.from({ length: 6 }, (_, i) => Array.from({ length: 6 }, (_, j) => (i === j ? 1 : 0)));
const mul = (A, B) => A.map((r) => B[0].map((_, j) => r.reduce((a, v, k) => a + v * B[k][j], 0)));
const sub = (A, B) => A.map((r, i) => r.map((v, j) => v - B[i][j]));
const add = (A, B) => A.map((r, i) => r.map((v, j) => v + B[i][j]));
export function inv6(A) {
  const n = 6, M = A.map((r, i) => [...r, ...ID6()[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-300) throw new RangeError("singular tensor");
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c];
    for (let j = 0; j < 2 * n; j++) M[c][j] /= d;
    for (let r = 0; r < n; r++) { if (r === c) continue; const f = M[r][c]; for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[c][j]; }
  }
  return M.map((r) => r.slice(n));
}

/** Isotropic stiffness (Mandel). */
export function isoMandel(K, G) {
  const l = K - (2 * G) / 3;
  const C = Array.from({ length: 6 }, () => new Array(6).fill(0));
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] = l + (i === j ? 2 * G : 0);
  for (let i = 3; i < 6; i++) C[i][i] = 2 * G;
  return C;
}

/** Geometrical factors H3, H31 of a spheroid with symmetry axis 3 and aspect ω = a3/a1 (Heliyon 2024 eq. A.1). */
export function geometricFactors(omega) {
  if (!(omega > 0) || !Number.isFinite(omega)) throw new RangeError("aspect ratio must be a positive number");
  if (omega === 1) return { H3: 1 / 3, H31: 1 / 5 };
  let H3;
  if (omega > 1) {
    const s = Math.sqrt(omega * omega - 1);
    H3 = 1 - (omega / (s * s * s)) * (omega * s - Math.acosh(omega));
  } else {
    const s = Math.sqrt(1 - omega * omega);
    H3 = 1 - (omega / (s * s * s)) * (Math.acos(omega) - omega * s);
  }
  return { H3, H31: (1 - 3 * H3) / (2 * (omega * omega - 1)) };
}

const NEAR_SPHERE = 1e-3;

/** Eshelby tensor components of a spheroid (axis 3) in an isotropic matrix of Poisson ratio ν (eqs. A.2–A.3). */
export function eshelbyComponents(omega, nu) {
  if (!(nu > -1 && nu < 0.5)) throw new RangeError("matrix ν must be in (−1, 0.5)");
  // the closed form cancels catastrophically next to ω = 1: interpolate between the sphere and ω = 1 ± 1e-3
  if (Math.abs(omega - 1) < NEAR_SPHERE && omega !== 1) {
    const t = Math.abs(omega - 1) / NEAR_SPHERE, a = closedForm(1, nu), b = closedForm(omega > 1 ? 1 + NEAR_SPHERE : 1 - NEAR_SPHERE, nu);
    return Object.fromEntries(Object.keys(a).map((k) => [k, a[k] + t * (b[k] - a[k])]));
  }
  return closedForm(omega, nu);
}

function closedForm(omega, nu) {
  const { H3, H31 } = geometricFactors(omega), d = H3 - H31, q = 1 - nu;
  const S1111 = ((5 - 4 * nu) / (8 * q)) * (1 - H3) + (3 * d) / (8 * q);
  const S1122 = (-(1 - 4 * nu) / (8 * q)) * (1 - H3) + d / (8 * q);
  return {
    S1111, S2222: S1111, S3333: H3 + d / q, S1122, S2211: S1122,
    S1133: (nu / (2 * q)) * (1 - H3) - d / (2 * q), S2233: (nu / (2 * q)) * (1 - H3) - d / (2 * q),
    S3311: (nu / q) * H3 - d / (2 * q), S3322: (nu / q) * H3 - d / (2 * q),
    S2323: 0.25 * (1 + H3) - d / (2 * q), S3131: 0.25 * (1 + H3) - d / (2 * q), S1212: (S1111 - S1122) / 2,
  };
}

/** Eshelby tensor as a Mandel matrix (rows: strain 11,22,33,23,13,12; S_ijkl maps eigenstrain kl to strain ij). */
export function eshelbyMandel(omega, nu) {
  const s = eshelbyComponents(omega, nu), M = Array.from({ length: 6 }, () => new Array(6).fill(0));
  M[0][0] = s.S1111; M[0][1] = s.S1122; M[0][2] = s.S1133;
  M[1][0] = s.S2211; M[1][1] = s.S2222; M[1][2] = s.S2233;
  M[2][0] = s.S3311; M[2][1] = s.S3322; M[2][2] = s.S3333;
  M[3][3] = 2 * s.S2323; M[4][4] = 2 * s.S3131; M[5][5] = 2 * s.S1212;
  return M;
}

/** Isotropic part (a, b) of a Mandel tensor: X_iijj = 3a, X_ijij = a + 5b. */
export function isotropicPart(T) {
  let iijj = 0;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) iijj += T[i][j];
  const trace = T.reduce((a, r, i) => a + r[i], 0);
  const a = iijj / 3;
  return { a, b: (trace - a) / 5 };
}

/**
 * Mori–Tanaka, random 3-D orientation. matrix: { K, G }; inclusions: [{ phi, K, G, aspect }] (point values);
 * matrix fraction = 1 − Σφ_r.
 */
export function moriTanakaRandom(matrix, inclusions) {
  const fm = 1 - inclusions.reduce((a, p) => a + p.phi, 0);
  if (!(fm > 0) || inclusions.some((p) => !(p.phi >= 0))) throw new RangeError("inclusion fractions must be ≥ 0 and sum below 1");
  const nu0 = (3 * matrix.K - 2 * matrix.G) / (2 * (3 * matrix.K + matrix.G));
  const C0 = isoMandel(matrix.K, matrix.G), C0inv = inv6(C0);
  let nK = fm * matrix.K, dK = fm, nG = fm * matrix.G, dG = fm;
  for (const p of inclusions) {
    const S = eshelbyMandel(p.aspect, nu0);
    const T = inv6(add(ID6(), mul(mul(S, C0inv), sub(isoMandel(p.K, p.G), C0))));
    const { a, b } = isotropicPart(T);
    nK += p.phi * p.K * a; dK += p.phi * a; nG += p.phi * p.G * b; dG += p.phi * b;
  }
  const K = nK / dK, G = nG / dG;
  return { K, G, ...eNuFromKG(K, G) };
}

/** MT extremes over the corners of every phase's E, ν (and aspect) intervals. Exact if MT is monotone in each. */
export function moriTanakaRandomBand(matrix, inclusions) {
  const dims = [];
  const pick = (iv) => (iv.lo === iv.hi ? [iv.lo] : [iv.lo, iv.hi]);
  dims.push(pick(matrix.E), pick(matrix.nu));
  for (const p of inclusions) dims.push(pick(p.E), pick(p.nu), pick(p.aspect));
  const total = dims.reduce((a, d) => a * d.length, 1);
  if (total > 1 << 16) throw new RangeError("too many interval corners");
  let lo = null, hi = null;
  for (let m = 0; m < total; m++) {
    let r = m;
    const v = dims.map((d) => { const x = d[r % d.length]; r = Math.floor(r / d.length); return x; });
    const mk = kgFromENu(v[0], v[1]);
    const inc = inclusions.map((p, i) => ({ phi: p.phi, ...kgFromENu(v[2 + 3 * i], v[3 + 3 * i]), aspect: v[4 + 3 * i] }));
    const e = moriTanakaRandom(mk, inc);
    if (!lo || e.E < lo.E) lo = e;
    if (!hi || e.E > hi.E) hi = e;
  }
  return { low: lo, high: hi, corners: total };
}
