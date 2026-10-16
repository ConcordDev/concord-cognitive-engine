// server/lib/conkay/knowledge/crystal-elasticity.js
//
// Isotropic properties of a randomly oriented polycrystalline aggregate (a mineral
// powder filler) from its single-crystal data. Any recipe's mineral filler can use it.
//
//   Voigt (uniform strain, upper):  K_V = [(C11+C22+C33) + 2(C12+C23+C31)]/9
//                                   G_V = [(C11+C22+C33) − (C12+C23+C31) + 3(C44+C55+C66)]/15
//   Reuss (uniform stress, lower):  1/K_R = (S11+S22+S33) + 2(S12+S23+S31)
//                                   15/G_R = 4(S11+S22+S33) − 4(S12+S23+S31) + 3(S44+S55+S66),  S = C⁻¹
//   Hill = mean of the two.  E = 9KG/(3K+G),  ν = (3K − 2G)/(2(3K+G)).
// Benchmarked against the published Quantas calcite example (tests). A stiffness
// matrix that is not positive definite is mechanically unstable: refused.
//
// Uniaxial crystal (trigonal/hexagonal/tetragonal), random aggregate:
//   conductivity bounds (Wiener): arithmetic (2k⊥ + k∥)/3 and harmonic 3/(2/k⊥ + 1/k∥)
//   expansion: (2α⊥ + α∥)/3 — the orientation average, without the elastic interaction
//   between grains (an estimate, labelled).

export function symmetric6(upper) {
  if (!Array.isArray(upper) || upper.length !== 6) throw new RangeError("need 6 rows");
  const C = Array.from({ length: 6 }, () => new Array(6).fill(0));
  for (let i = 0; i < 6; i++) {
    const row = upper[i];
    if (!Array.isArray(row) || row.length !== 6 - i) throw new RangeError(`row ${i + 1} must have ${6 - i} entries (upper triangle)`);
    for (let j = i; j < 6; j++) {
      const v = row[j - i];
      if (!Number.isFinite(v)) throw new RangeError(`C${i + 1}${j + 1} is not a number`);
      C[i][j] = C[j][i] = v;
    }
  }
  return C;
}

/** Trigonal 3̄m / 32 (calcite, quartz) stiffness from its six independent constants. */
export function trigonalStiffness({ C11, C12, C13, C14, C33, C44 }) {
  for (const [k, v] of Object.entries({ C11, C12, C13, C14, C33, C44 })) if (!Number.isFinite(v)) throw new RangeError(`${k} is missing`);
  const C66 = (C11 - C12) / 2;
  return symmetric6([
    [C11, C12, C13, C14, 0, 0],
    [C11, C13, -C14, 0, 0],
    [C33, 0, 0, 0],
    [C44, 0, 0],
    [C44, C14],
    [C66],
  ]);
}

function cholesky(A) {
  const n = A.length, L = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) { if (!(s > 0)) return null; L[i][i] = Math.sqrt(s); } else L[i][j] = s / L[j][j];
    }
  }
  return L;
}

function invert(A) {
  const n = A.length, M = A.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c];
    for (let j = 0; j < 2 * n; j++) M[c][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c];
      for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[c][j];
    }
  }
  return M.map((r) => r.slice(n));
}

const iso = (K, G) => ({ K, G, E: (9 * K * G) / (3 * K + G), nu: (3 * K - 2 * G) / (2 * (3 * K + G)) });

/** Voigt, Reuss and Hill aggregate moduli (same units as C). */
export function voigtReussHill(C) {
  if (!Array.isArray(C) || C.length !== 6 || C.some((r) => !Array.isArray(r) || r.length !== 6 || r.some((v) => !Number.isFinite(v)))) throw new RangeError("C must be a 6×6 numeric matrix (Voigt notation)");
  for (let i = 0; i < 6; i++) for (let j = 0; j < i; j++) if (Math.abs(C[i][j] - C[j][i]) > 1e-9 * Math.max(1, Math.abs(C[i][j]))) throw new RangeError(`C is not symmetric at (${i + 1},${j + 1})`);
  if (!cholesky(C)) return { stable: false, reason: "the stiffness matrix is not positive definite (mechanically unstable)" };
  const S = invert(C);
  const KV = (C[0][0] + C[1][1] + C[2][2] + 2 * (C[0][1] + C[1][2] + C[2][0])) / 9;
  const GV = (C[0][0] + C[1][1] + C[2][2] - (C[0][1] + C[1][2] + C[2][0]) + 3 * (C[3][3] + C[4][4] + C[5][5])) / 15;
  const KR = 1 / (S[0][0] + S[1][1] + S[2][2] + 2 * (S[0][1] + S[1][2] + S[2][0]));
  const GR = 15 / (4 * (S[0][0] + S[1][1] + S[2][2]) - 4 * (S[0][1] + S[1][2] + S[2][0]) + 3 * (S[3][3] + S[4][4] + S[5][5]));
  return { stable: true, voigt: iso(KV, GV), reuss: iso(KR, GR), hill: iso((KV + KR) / 2, (GV + GR) / 2) };
}

/** Random-aggregate conductivity bounds for a uniaxial crystal. */
export function uniaxialConductivityBounds({ kPara, kPerp }) {
  if (!(kPara > 0 && kPerp > 0)) throw new RangeError("k∥ and k⊥ must be > 0");
  return { lower: 3 / (2 / kPerp + 1 / kPara), upper: (2 * kPerp + kPara) / 3 };
}

/** Orientation-averaged linear CTE of a uniaxial crystal (no grain interaction). */
export function uniaxialCteAverage({ alphaPara, alphaPerp }) {
  if (!Number.isFinite(alphaPara) || !Number.isFinite(alphaPerp)) throw new RangeError("α∥ and α⊥ must be numbers");
  return (2 * alphaPerp + alphaPara) / 3;
}

// ---- sourced single-crystal data (sources.js, with locators) ----

/** Calcite, Korth Kristalle data page: the full constant set (Crystran omits C44). GPa. */
export const CALCITE_KORTH = Object.freeze({ C11: 144, C12: 53.9, C13: 51.1, C14: 20.5, C33: 84, C44: 33.5 });
/** Calcite conductivity and expansion, Crystran (and Korth, same values) at 273 K. */
export const CALCITE_THERMAL = Object.freeze({ kPara: 5.526, kPerp: 4.646, alphaPara: 25e-6, alphaPerp: -5.8e-6 });
/** α-quartz, Crystran: C11 87, C12 7, C44 58, C13 13, C14 −18, C33 106 GPa; k 10.7 ∥ / 6.2 ⊥ (323 K); α 7.1 ∥ / 13.2 ⊥ ppm/°C. */
export const QUARTZ_CRYSTRAN = Object.freeze({ C11: 87, C12: 7, C13: 13, C14: -18, C33: 106, C44: 58 });
export const QUARTZ_THERMAL = Object.freeze({ kPara: 10.7, kPerp: 6.2, alphaPara: 7.1e-6, alphaPerp: 13.2e-6 });
