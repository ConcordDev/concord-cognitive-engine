// server/lib/conkay/physics/solvers/svd-lsq.js
//
// math.svd-lsq — SX-NUM-05 (ConKay solver catalogue, Wave 0).
//
// Singular value decomposition and least squares at the JS tier.
//
//   svd       — one-sided Jacobi (Hestenes) SVD. Chosen because it
//               is backward stable and, for least squares, markedly
//               more accurate than normal equations (Demmel–
//               Veselic): the reference case is the NIST StRD
//               Longley set, a deliberately ill-conditioned
//               regression where normal equations lose half the
//               digits. The decomposition is verified by
//               reconstruction ||U S Vt - A||inf before serving.
//   lsq       — minimum-norm least squares via the pseudo-inverse.
//               Singular values at or below rcond * sigma_max are
//               truncated; the truncation is DECLARED in the output
//               (effectiveRank, truncated count), never silent.
//               Optimality is verified by the normal-equation
//               residual ||A^T(Ax - b)||inf.
//   rank      — effective rank under the same declared rcond.
//   tikhonov  — ridge solution by SVD filter factors
//               sigma / (sigma^2 + lambda^2), lambda required and
//               echoed (SC-03: no assumed regularization).
//   tls       — total least squares from the smallest right
//               singular vector of [A | b]; when that vector's last
//               component is ~0 there is no finite TLS solution and
//               the call is NOT_COMPUTED tls_no_finite_solution.
//
// Convention: A = U * diag(s) * Vt, U (m x k) with orthonormal
// columns, Vt (k x n) with orthonormal rows, k = min(m, n),
// s descending. Sizes capped at 64 per dimension at this tier.

import { registerSolver } from "../registry.js";

const MAX_DIM = 64;
const DEFAULT_RCOND = 1e-12;

const transpose = (A) => A[0].map((_, j) => A.map((row) => row[j]));
const matVec = (A, x) => A.map((row) => row.reduce((s, v, j) => s + v * x[j], 0));
const normInfVec = (v) => Math.max(...v.map(Math.abs));

function validateMatrix(A) {
  if (!Array.isArray(A) || A.length === 0 || !Array.isArray(A[0]) || A[0].length === 0) {
    return "A must be a non-empty array of rows";
  }
  const m = A.length;
  const n = A[0].length;
  if (m > MAX_DIM || n > MAX_DIM) return `dimensions ${m}x${n} exceed the JS tier cap ${MAX_DIM} (engine tier)`;
  for (const row of A) {
    if (!Array.isArray(row) || row.length !== n) return "A must be rectangular";
    for (const v of row) if (!Number.isFinite(v)) return "A contains a non-finite entry";
  }
  return null;
}

/** One-sided Jacobi SVD of a tall matrix (m >= n). Returns {U, s, V} with A = U diag(s) V^T. */
function svdTall(A) {
  const m = A.length;
  const n = A[0].length;
  const W = A.map((row) => row.slice()); // becomes U * diag(s)
  const V = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  const colSq = (j) => W.reduce((s, row) => s + row[j] * row[j], 0);
  const tol = 1e-15;
  for (let sweep = 0; sweep < 100; sweep += 1) {
    let rotated = false;
    for (let p = 0; p < n - 1; p += 1) {
      for (let q = p + 1; q < n; q += 1) {
        const alpha = colSq(p);
        const beta = colSq(q);
        if (alpha === 0 || beta === 0) continue;
        let gamma = 0;
        for (let i = 0; i < m; i += 1) gamma += W[i][p] * W[i][q];
        if (Math.abs(gamma) <= tol * Math.sqrt(alpha * beta)) continue;
        rotated = true;
        const zeta = (beta - alpha) / (2 * gamma);
        const t = Math.sign(zeta || 1) / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta));
        const c = 1 / Math.sqrt(1 + t * t);
        const s = c * t;
        for (let i = 0; i < m; i += 1) {
          const wp = W[i][p];
          const wq = W[i][q];
          W[i][p] = c * wp - s * wq;
          W[i][q] = s * wp + c * wq;
        }
        for (let i = 0; i < n; i += 1) {
          const vp = V[i][p];
          const vq = V[i][q];
          V[i][p] = c * vp - s * vq;
          V[i][q] = s * vp + c * vq;
        }
      }
    }
    if (!rotated) break;
  }
  const s = [];
  const U = Array.from({ length: m }, () => Array(n).fill(0));
  for (let j = 0; j < n; j += 1) {
    const sj = Math.sqrt(colSq(j));
    s.push(sj);
    if (sj > 0) for (let i = 0; i < m; i += 1) U[i][j] = W[i][j] / sj;
  }
  return { U, s, V };
}

/** Full SVD for any shape. Returns {U, s, Vt} with A = U diag(s) Vt. */
export function svd(A) {
  const m = A.length;
  const n = A[0].length;
  let U;
  let s;
  let Vt;
  if (m >= n) {
    const r = svdTall(A);
    U = r.U; s = r.s; Vt = transpose(r.V);
  } else {
    const r = svdTall(transpose(A)); // A^T = U' diag(s) V'^T  =>  A = V' diag(s) U'^T
    U = r.V; s = r.s; Vt = transpose(r.U);
  }
  const order = s.map((_, i) => i).sort((a, b) => s[b] - s[a]);
  return {
    U: U.map((row) => order.map((j) => row[j])),
    s: order.map((j) => s[j]),
    Vt: order.map((j) => Vt[j]),
  };
}

function reconstructionError(A, { U, s, Vt }) {
  const m = A.length;
  const n = A[0].length;
  const k = s.length;
  let worst = 0;
  for (let i = 0; i < m; i += 1) {
    for (let j = 0; j < n; j += 1) {
      let sum = 0;
      for (let t = 0; t < k; t += 1) sum += U[i][t] * s[t] * Vt[t][j];
      worst = Math.max(worst, Math.abs(sum - A[i][j]));
    }
  }
  return worst;
}

function runSvdLsq(ctx, target) {
  const inputs = ctx?.inputs || {};
  if (!["svd", "lsq", "rank", "tikhonov", "tls"].includes(target)) {
    return { notComputed: `unknown_operation:${target}` };
  }
  const bad = validateMatrix(inputs.A);
  if (bad) return { notComputed: `invalid_input:A ${bad}` };
  const A = inputs.A;
  const m = A.length;
  const n = A[0].length;
  const rcond = inputs.rcond === undefined ? DEFAULT_RCOND : inputs.rcond;
  if (!(Number.isFinite(rcond) && rcond > 0 && rcond < 1)) {
    return { notComputed: "invalid_input:rcond must lie in (0, 1)" };
  }
  const dec = svd(A);
  const recon = reconstructionError(A, dec);
  const aScale = Math.max(1, normInfVec(A.flat()));
  if (recon > 1e-9 * aScale) {
    return {
      inputs: { m, n },
      outputs: { reconstructionError: recon },
      margins: [],
      failures: [{ name: "svd_reconstruction", detail: `||U S Vt - A||inf = ${recon} beyond tolerance — decomposition not served` }],
      covers: [target],
    };
  }
  const cutoff = rcond * (dec.s[0] || 0);
  const effectiveRank = dec.s.filter((sv) => sv > cutoff).length;

  if (target === "svd") {
    return {
      inputs: { m, n },
      outputs: { U: dec.U, singularValues: dec.s, Vt: dec.Vt, reconstructionError: recon, effectiveRank },
      margins: [],
      covers: [target],
    };
  }
  if (target === "rank") {
    return {
      inputs: { m, n, rcond },
      outputs: { rank: effectiveRank, singularValues: dec.s, cutoff },
      margins: [],
      covers: [target],
    };
  }

  const b = inputs.b;
  if (!Array.isArray(b) || b.length !== m || b.some((v) => !Number.isFinite(v))) {
    return { notComputed: `invalid_input:b must be an array of ${m} finite numbers` };
  }
  // U^T b once; each target combines it with its own filter
  const utb = dec.s.map((_, t) => dec.U.reduce((sum, row, i) => sum + row[t] * b[i], 0));

  if (target === "lsq" || target === "tikhonov") {
    let lambda = 0;
    if (target === "tikhonov") {
      lambda = inputs.lambda;
      if (!(Number.isFinite(lambda) && lambda > 0)) {
        return { notComputed: "missing_input:lambda (SC-03: no regularization is assumed; declare lambda > 0)" };
      }
    }
    const x = Array(n).fill(0);
    let truncated = 0;
    dec.s.forEach((sv, t) => {
      let coef;
      if (target === "lsq") {
        if (sv <= cutoff) { truncated += 1; coef = 0; } else coef = utb[t] / sv;
      } else {
        coef = (sv / (sv * sv + lambda * lambda)) * utb[t];
      }
      for (let j = 0; j < n; j += 1) x[j] += coef * dec.Vt[t][j];
    });
    const resid = matVec(A, x).map((v, i) => v - b[i]);
    const normalResid = transpose(A).map((row) => row.reduce((sum, v, i) => sum + v * resid[i], 0));
    return {
      inputs: { m, n, ...(target === "tikhonov" ? { lambda } : { rcond }) },
      outputs: {
        x,
        residualNorm2: Math.sqrt(resid.reduce((s2, v) => s2 + v * v, 0)),
        normalEquationResidualInf: normInfVec(normalResid),
        effectiveRank,
        ...(target === "lsq" ? { truncatedSingularValues: truncated } : {}),
        singularValues: dec.s,
      },
      margins: [],
      covers: [target],
    };
  }

  // tls: smallest right singular vector of [A | b]
  const aug = A.map((row, i) => [...row, b[i]]);
  const decAug = svd(aug);
  const vLast = decAug.Vt[decAug.Vt.length - 1];
  const tail = vLast[n];
  if (Math.abs(tail) < 1e-12) {
    return { notComputed: "tls_no_finite_solution:the smallest singular vector of [A | b] has a ~0 last component" };
  }
  const x = vLast.slice(0, n).map((v) => -v / tail);
  return {
    inputs: { m, n },
    outputs: { x, smallestSingularValue: decAug.s[decAug.s.length - 1], singularValues: decAug.s },
    margins: [],
    covers: [target],
  };
}

export const svdLsq = registerSolver({
  id: "math.svd-lsq",
  version: "1.0.0",
  domain: "math",
  domains: ["math"],
  fidelity: 2,
  method: "one-sided Jacobi SVD; least squares by pseudo-inverse with declared rank truncation; Tikhonov by SVD filter factors; TLS from the augmented matrix",
  reference: "NIST StRD linear regression sets (Longley certified values); Golub & Van Loan, Matrix Computations 4e Ch. 5-6",
  regime: "dense matrices up to 64 x 64 at this tier; rank decisions under a declared rcond (default 1e-12)",
  units: { inputs: "dimensionless matrix A and vector b", outputs: "U, singular values, Vt; least-squares x with residual and normal-equation residual" },
  tolerance: "SVD reconstruction ||U S Vt - A||inf <= 1e-9 * max(1, ||A||inf), verified on every call; Longley coefficients asserted against the NIST certified values in CI",
  screening: false,
  targets: () => [], // direct-call solver (solve.direct shape)
  run: runSvdLsq,
});
