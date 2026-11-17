// server/lib/conkay/physics/solvers/eigen.js
//
// math.eigen — SX-NUM-04 (ConKay solver catalogue, Wave 0).
//
// Eigenproblems at the JS tier:
//
//   eig      — the full spectrum of a SYMMETRIC matrix by the
//              classical Jacobi method (Golub & Van Loan §8.5):
//              eigenvalues real, eigenvectors orthonormal. Every
//              returned pair is verified: ||A v - lambda v||inf
//              and the orthonormality defect ||V^T V - I||inf are
//              computed against the original matrix, and a defect
//              beyond tolerance FAILs instead of serving.
//   dominant — the dominant eigenpair of a general real matrix by
//              power iteration with a Rayleigh quotient; the pair
//              is served only when its own residual proves it.
//              Non-convergence inside the iteration cap is
//              NOT_COMPUTED not_converged with the residual named
//              (complex or equimodular dominant pairs live there,
//              and in the engine tier — never approximated).
//
// The engine class — the non-symmetric full spectrum (LAPACK
// DGEEV) and sparse generalized problems (ARPACK / SLEPc
// Krylov-Schur, shift-invert; the Matrix Market BCSSTK cases) —
// is refused by name as requires_engine_tier:lapack-arpack.

import { registerSolver } from "../registry.js";

const MAX_N = 64;
const PAIR_RTOL = 1e-9;

const matVec = (A, x) => A.map((row) => row.reduce((s, v, j) => s + v * x[j], 0));
const normInf = (v) => Math.max(...v.map(Math.abs));
const norm2 = (v) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));

function validate(A) {
  if (!Array.isArray(A) || A.length === 0) return "A must be a non-empty array of rows";
  const n = A.length;
  if (n > MAX_N) return `size ${n} exceeds the dense JS tier cap ${MAX_N} (engine tier)`;
  for (const row of A) {
    if (!Array.isArray(row) || row.length !== n) return "A must be square";
    for (const v of row) if (!Number.isFinite(v)) return "A contains a non-finite entry";
  }
  return null;
}

const isSymmetric = (A) => A.every((row, i) => row.every((v, j) => v === A[j][i]));

/** Classical Jacobi eigenvalue method for symmetric A. Returns {values, vectors (columns), sweeps}. */
export function jacobiEigen(A, tol = 1e-14, maxSweeps = 100) {
  const n = A.length;
  const a = A.map((row) => row.slice());
  const V = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  const scale = Math.max(1, normInf(A.flat()));
  const off = () => {
    let s = 0;
    for (let i = 0; i < n; i += 1) for (let j = i + 1; j < n; j += 1) s += a[i][j] * a[i][j];
    return Math.sqrt(2 * s);
  };
  let sweeps = 0;
  while (off() > tol * scale && sweeps < maxSweeps) {
    sweeps += 1;
    for (let p = 0; p < n - 1; p += 1) {
      for (let q = p + 1; q < n; q += 1) {
        if (a[p][q] === 0) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k += 1) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k += 1) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k += 1) {
          const vkp = V[k][p];
          const vkq = V[k][q];
          V[k][p] = c * vkp - s * vkq;
          V[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const values = a.map((row, i) => row[i]);
  const vectors = values.map((_, j) => V.map((row) => row[j]));
  return { values, vectors, sweeps, converged: off() <= tol * scale };
}

function canonicalSign(v) {
  let idx = 0;
  for (let i = 1; i < v.length; i += 1) if (Math.abs(v[i]) > Math.abs(v[idx])) idx = i;
  return v[idx] < 0 ? v.map((x) => -x) : v.slice();
}

function pairResidual(A, lambda, v) {
  const av = matVec(A, v);
  return normInf(av.map((x, i) => x - lambda * v[i]));
}

function runEigen(ctx, target) {
  const inputs = ctx?.inputs || {};
  if (!["eig", "dominant"].includes(target)) return { notComputed: `unknown_operation:${target}` };
  const bad = validate(inputs.A);
  if (bad) return { notComputed: `invalid_input:A ${bad}` };
  const A = inputs.A;
  const n = A.length;
  const scale = Math.max(1, normInf(A.flat()));

  if (target === "dominant") {
    let v = Array.from({ length: n }, (_, i) => 1 + i * 0.137); // deterministic, non-symmetric start
    v = v.map((x) => x / norm2(v));
    const maxIter = 10000;
    let lambda = 0;
    let resid = Infinity;
    let iter = 0;
    for (; iter < maxIter; iter += 1) {
      const w = matVec(A, v);
      const nw = norm2(w);
      if (nw === 0) return { notComputed: "not_converged:power iteration reached the zero vector (nilpotent action on the start vector)" };
      const next = w.map((x) => x / nw);
      lambda = next.reduce((s, x, i) => s + x * matVec(A, next)[i], 0); // Rayleigh quotient
      resid = pairResidual(A, lambda, next);
      v = next;
      if (resid <= PAIR_RTOL * scale) break;
    }
    if (resid > PAIR_RTOL * scale) {
      return { notComputed: `not_converged:dominant pair residual ${resid.toExponential(3)} after ${maxIter} iterations (complex or equimodular dominant spectrum — engine tier)` };
    }
    return {
      inputs: { n },
      outputs: { eigenvalue: lambda, eigenvector: canonicalSign(v), residualInf: resid, iterations: iter + 1 },
      margins: [],
      covers: [target],
    };
  }

  // eig — symmetric only at this tier
  if (!isSymmetric(A)) {
    return { notComputed: "requires_engine_tier:lapack-arpack (the non-symmetric full spectrum is LAPACK DGEEV; the JS tier decides the symmetric problem and the dominant pair)" };
  }
  const { values, vectors, sweeps, converged } = jacobiEigen(A);
  if (!converged) return { notComputed: `not_converged:jacobi sweeps exhausted (${sweeps}) with off-diagonal mass above tolerance` };
  const order = values.map((_, i) => i).sort((x, y) => values[y] - values[x]);
  const sortedValues = order.map((i) => values[i]);
  const sortedVectors = order.map((i) => canonicalSign(vectors[i].map((x) => x / norm2(vectors[i]))));
  const maxResid = Math.max(...sortedValues.map((lam, i) => pairResidual(A, lam, sortedVectors[i])));
  let orthoDefect = 0;
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      const dot = sortedVectors[i].reduce((s, x, k) => s + x * sortedVectors[j][k], 0);
      orthoDefect = Math.max(orthoDefect, Math.abs(dot - (i === j ? 1 : 0)));
    }
  }
  if (maxResid > PAIR_RTOL * scale || orthoDefect > 1e-8) {
    return {
      inputs: { n },
      outputs: { eigenvalues: sortedValues, maxPairResidual: maxResid, orthonormalityDefect: orthoDefect },
      margins: [],
      failures: [{ name: "eigenpair_verification", detail: `max pair residual ${maxResid}, orthonormality defect ${orthoDefect} — beyond the declared tolerance` }],
      covers: [target],
    };
  }
  return {
    inputs: { n },
    outputs: {
      eigenvalues: sortedValues,
      eigenvectors: sortedVectors, // per eigenvalue, unit norm, canonical sign
      maxPairResidual: maxResid,
      orthonormalityDefect: orthoDefect,
      sweeps,
    },
    margins: [],
    covers: [target],
  };
}

export const eigen = registerSolver({
  id: "math.eigen",
  version: "1.0.0",
  domain: "math",
  domains: ["math"],
  fidelity: 3,
  method: "symmetric eigenproblem by the classical Jacobi method; dominant pair by residual-checked power iteration (JS tier); non-symmetric and sparse generalized spectra via the LAPACK / ARPACK-SLEPc engine tier, refused by name here",
  reference: "Golub & Van Loan, Matrix Computations 4e §8.5 (Jacobi), §7.3 (power method); Matrix Market eigen cases",
  regime: "symmetric dense n <= 64 for the full spectrum; dominant pair for general real matrices with a strictly dominant real eigenvalue",
  units: { inputs: "dimensionless square matrix A", outputs: "eigenvalues, unit eigenvectors (canonical sign), pair residuals, orthonormality defect" },
  tolerance: "pair residuals ||A v - lambda v||inf <= 1e-9 * max(1, ||A||inf), verified on every returned pair",
  screening: false,
  targets: () => [], // direct-call solver (solve.direct shape)
  run: runEigen,
});
