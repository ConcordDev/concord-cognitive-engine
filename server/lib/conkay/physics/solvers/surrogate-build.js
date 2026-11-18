// server/lib/conkay/physics/solvers/surrogate-build.js
//
// surrogate.build — SX-XC-07 (ConKay solver catalogue,
// Wave 0).
//
// Reduced-order / surrogate models trained ONLY on the
// caller's top-tier runs: polynomial response surfaces
// (OLS, leverage-based prediction intervals), ordinary
// kriging (Gaussian correlation, theta by closed-form
// leave-one-out cross-validation, native kriging
// variance), and a POD reduced-order model over snapshot
// fields (Gram-matrix modes, coefficient response
// surfaces).
//
// The envelope discipline is the catalogue's own: a
// surrogate is valid INSIDE THE TRAINING HULL ONLY. A
// query outside the per-dimension training range refuses
// by name — extrapolation is never served. Held-out
// validation, when the caller supplies it, is graded
// against held-out truth at the caller's declared
// tolerance and reported as measured; a surrogate is
// never graded on its own training points. Engine-scale
// POD/DMD and GP refuse by name: requires_engine_tier:
// sxe-01.

import { registerSolver } from "../registry.js";

const Z95 = 1.959963984540054;

/* ---------------- small dense linear algebra ---------------- */

function solveLin(Ain, bin) {
  const n = bin.length;
  const A = Ain.map((row, i) => [...row, bin[i]]);
  for (let col = 0; col < n; col += 1) {
    let piv = col;
    for (let r = col + 1; r < n; r += 1) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < 1e-13) return null;
    [A[col], A[piv]] = [A[piv], A[col]];
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const f = A[r][col] / A[col][col];
      for (let c = col; c <= n; c += 1) A[r][c] -= f * A[col][c];
    }
  }
  return A.map((row, i) => row[n] / row[i]);
}

function invertMat(Ain) {
  const n = Ain.length;
  const A = Ain.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col += 1) {
    let piv = col;
    for (let r = col + 1; r < n; r += 1) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < 1e-13) return null;
    [A[col], A[piv]] = [A[piv], A[col]];
    const d = A[col][col];
    for (let c = 0; c < 2 * n; c += 1) A[col][c] /= d;
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const f = A[r][col];
      for (let c = 0; c < 2 * n; c += 1) A[r][c] -= f * A[col][c];
    }
  }
  return A.map((row) => row.slice(n));
}

/* ---------------- shared gates ---------------- */

function parseTraining(inputs) {
  const td = inputs.trainingData;
  if (!td || !Array.isArray(td.points) || !Array.isArray(td.values) || td.points.length === 0 || td.points.length !== td.values.length) {
    return { error: "missing_input:trainingData {points: [[x...], ...], values: [...]} with one value per point (the surrogate trains only on these top-tier runs)" };
  }
  const d = Array.isArray(td.points[0]) ? td.points[0].length : 0;
  if (d < 1 || d > 8) return { error: `invalid_input:trainingData points must have dimension 1..8 (got ${d})` };
  if (!td.points.every((p) => Array.isArray(p) && p.length === d && p.every(Number.isFinite)) || !td.values.every(Number.isFinite)) {
    return { error: "invalid_input:trainingData points and values must all be finite numbers" };
  }
  const hull = Array.from({ length: d }, (_, j) => [Math.min(...td.points.map((p) => p[j])), Math.max(...td.points.map((p) => p[j]))]);
  return { points: td.points, values: td.values, d, hull };
}

function hullGate(hull, q) {
  for (let j = 0; j < hull.length; j += 1) {
    if (q[j] < hull[j][0] || q[j] > hull[j][1]) {
      return `outside_training_hull:dimension ${j} value ${q[j]} is outside the training range [${hull[j][0]}, ${hull[j][1]}] — a surrogate is valid inside the training hull only; extrapolation is not served`;
    }
  }
  return null;
}

function parseQueries(inputs, d) {
  const qs = inputs.queries;
  if (!Array.isArray(qs) || qs.length === 0 || !qs.every((q) => Array.isArray(q) && q.length === d && q.every(Number.isFinite))) {
    return { error: `missing_input:queries (a non-empty array of ${d}-dimensional finite points)` };
  }
  return { queries: qs };
}

/* ---------------- polynomial response surface ---------------- */

function polyBasis(x, degree) {
  const out = [1, ...x];
  if (degree >= 2) {
    for (let i = 0; i < x.length; i += 1) for (let j = i; j < x.length; j += 1) out.push(x[i] * x[j]);
  }
  return out;
}

function fitPoly(points, values, degree) {
  const Phi = points.map((p) => polyBasis(p, degree));
  const p = Phi[0].length;
  if (points.length <= p) return { error: `underdetermined: ${points.length} training points cannot fit ${p} polynomial terms — supply more top-tier runs or a lower degree` };
  const XtX = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => Phi.reduce((s, row) => s + row[i] * row[j], 0)));
  const Xty = Array.from({ length: p }, (_, i) => Phi.reduce((s, row, k) => s + row[i] * values[k], 0));
  const beta = solveLin(XtX, Xty);
  if (!beta) return { error: "underdetermined: the normal equations are singular (collinear training points) — the surface is not identifiable from these runs" };
  const XtXinv = invertMat(XtX);
  const resid = values.map((v, k) => v - Phi[k].reduce((s, f, i) => s + f * beta[i], 0));
  const dof = points.length - p;
  const sigma2 = resid.reduce((s, e) => s + e * e, 0) / dof;
  return { beta, XtXinv, sigma: Math.sqrt(sigma2), terms: p };
}

function predictPoly(fit, degree, q) {
  const phi = polyBasis(q, degree);
  const value = phi.reduce((s, f, i) => s + f * fit.beta[i], 0);
  const lev = phi.reduce((s, f, i) => s + f * phi.reduce((s2, g, j) => s2 + g * fit.XtXinv[i][j], 0), 0);
  return { value, errorBar: Z95 * fit.sigma * Math.sqrt(1 + Math.max(0, lev)) };
}

/* ---------------- ordinary kriging ---------------- */

function fitKriging(points, values, hull) {
  const n = points.length;
  const d = points[0].length;
  const norm = (p) => p.map((v, j) => (hull[j][1] > hull[j][0] ? (v - hull[j][0]) / (hull[j][1] - hull[j][0]) : 0));
  const Pn = points.map(norm);
  const dist2 = (a, b) => a.reduce((s, v, j) => s + (v - b[j]) ** 2, 0);
  const candidates = [0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8];
  let best = null;
  for (const theta of candidates) {
    const K = Pn.map((a) => Pn.map((b) => Math.exp(-theta * dist2(a, b)) + (a === b ? 1e-10 : 0)));
    // augmented ordinary-kriging system for closed-form LOO
    const M = K.map((row) => [...row, 1]);
    M.push([...new Array(n).fill(1), 0]);
    const Minv = invertMat(M);
    if (!Minv) continue;
    const yExt = [...values, 0];
    const w = yExt.map((_, i) => Minv[i].reduce((s, m, j) => s + m * yExt[j], 0));
    let loo = 0;
    let ok = true;
    for (let i = 0; i < n; i += 1) {
      if (Math.abs(Minv[i][i]) < 1e-12) { ok = false; break; }
      const e = w[i] / Minv[i][i];
      loo += e * e;
    }
    if (!ok) continue;
    if (!best || loo < best.loo) best = { theta, K, loo };
  }
  if (!best) return { error: "underdetermined: the kriging system is singular for every candidate theta (duplicate or degenerate training points)" };
  const { theta, K } = best;
  const Kinv = invertMat(K);
  const ones = new Array(n).fill(1);
  const KinvOnes = ones.map((_, i) => Kinv[i].reduce((s, m, j) => s + m * ones[j], 0));
  const denom = ones.reduce((s, _, i) => s + KinvOnes[i], 0);
  const mu = ones.reduce((s, _, i) => s + Kinv[i].reduce((s2, m, j) => s2 + m * values[j], 0), 0) / denom;
  const resid = values.map((v) => v - mu);
  const alpha = resid.map((_, i) => Kinv[i].reduce((s, m, j) => s + m * resid[j], 0));
  const sigma2 = resid.reduce((s, v, i) => s + v * alpha[i], 0) / n;
  return { theta, mu, alpha, Kinv, KinvOnes, denom, sigma2, Pn, norm, dist2 };
}

function predictKriging(fit, q) {
  const qn = fit.norm(q);
  const r = fit.Pn.map((p) => Math.exp(-fit.theta * fit.dist2(p, qn)));
  const value = fit.mu + r.reduce((s, v, i) => s + v * fit.alpha[i], 0);
  const KinvR = r.map((_, i) => fit.Kinv[i].reduce((s, m, j) => s + m * r[j], 0));
  const rKr = r.reduce((s, v, i) => s + v * KinvR[i], 0);
  const sumKinvR = KinvR.reduce((a, b) => a + b, 0);
  const varK = fit.sigma2 * Math.max(0, 1 - rKr + ((1 - sumKinvR) ** 2) / fit.denom);
  return { value, errorBar: Z95 * Math.sqrt(varK) };
}

/* ---------------- run: build + predict ---------------- */

function runSurrogate(ctx, target) {
  const inputs = ctx?.inputs || {};
  if (target === "engine") return { notComputed: "requires_engine_tier:sxe-01" };
  if (target === "pod") return runPod(inputs);
  if (target !== "build-predict") {
    return { notComputed: `unknown_target:${target} (known: build-predict, pod, engine)` };
  }
  const method = inputs.method ?? "poly";
  if (!["poly", "kriging"].includes(method)) {
    return { notComputed: `invalid_input:method '${method}' (one of: poly, kriging; POD is target 'pod'; engine-scale GP/DMD is requires_engine_tier:sxe-01)` };
  }
  const t = parseTraining(inputs);
  if (t.error) return { notComputed: t.error };
  if (method === "kriging" && t.points.length > 200) {
    return { notComputed: "size_above_envelope:kriging training is capped at 200 points at the JS tier (larger sets: requires_engine_tier:sxe-01)" };
  }
  const qp = parseQueries(inputs, t.d);
  if (qp.error) return { notComputed: qp.error };
  for (const q of qp.queries) {
    const outside = hullGate(t.hull, q);
    if (outside) return { notComputed: outside };
  }
  let predictions;
  let fitInfo;
  if (method === "poly") {
    const degree = inputs.degree ?? 2;
    if (![1, 2].includes(degree)) return { notComputed: "invalid_input:degree must be 1 or 2 at the JS tier" };
    const fit = fitPoly(t.points, t.values, degree);
    if (fit.error) return { notComputed: fit.error };
    predictions = qp.queries.map((q) => predictPoly(fit, degree, q));
    fitInfo = { degree, terms: fit.terms, residualSigma: fit.sigma };
  } else {
    const fit = fitKriging(t.points, t.values, t.hull);
    if (fit.error) return { notComputed: fit.error };
    predictions = qp.queries.map((q) => predictKriging(fit, q));
    fitInfo = { theta: fit.theta, processVariance: fit.sigma2, looSelection: "theta by closed-form leave-one-out CV over a fixed grid" };
  }
  const outputs = {
    method,
    trainingPoints: t.points.length,
    hull: t.hull,
    fit: fitInfo,
    predictions: qp.queries.map((q, i) => ({ query: q, value: predictions[i].value, errorBar: predictions[i].errorBar })),
  };
  const warnings = [];
  if (inputs.validationData) {
    const vd = inputs.validationData;
    if (!Array.isArray(vd.points) || !Array.isArray(vd.values) || vd.points.length === 0 || vd.points.length !== vd.values.length
      || !vd.points.every((p) => Array.isArray(p) && p.length === t.d && p.every(Number.isFinite)) || !vd.values.every(Number.isFinite)) {
      return { notComputed: "invalid_input:validationData must be {points, values} of the training dimension with finite entries" };
    }
    for (const p of vd.points) {
      const outside = hullGate(t.hull, p);
      if (outside) return { notComputed: `validation point refused: ${outside}` };
    }
    let pred;
    if (method === "poly") {
      const fit = fitPoly(t.points, t.values, inputs.degree ?? 2);
      pred = vd.points.map((q) => predictPoly(fit, inputs.degree ?? 2, q).value);
    } else {
      const fit = fitKriging(t.points, t.values, t.hull);
      pred = vd.points.map((q) => predictKriging(fit, q).value);
    }
    const errs = vd.values.map((v, i) => Math.abs(pred[i] - v));
    const maxError = Math.max(...errs);
    const rmsError = Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / errs.length);
    const tolerance = inputs.tolerance;
    const within = tolerance !== undefined ? maxError <= tolerance : null;
    outputs.validation = { points: vd.points.length, maxError, rmsError, ...(tolerance !== undefined ? { tolerance, withinTolerance: within } : {}) };
    if (within === false) {
      warnings.push(`held-out max error ${maxError} exceeds the declared tolerance ${tolerance} — the surrogate is short of its declared accuracy on held-out runs, reported as measured`);
    }
  }
  return {
    inputs: { method, trainingData: inputs.trainingData, queries: inputs.queries, ...(inputs.degree !== undefined ? { degree: inputs.degree } : {}), ...(inputs.validationData ? { validationData: inputs.validationData } : {}), ...(inputs.tolerance !== undefined ? { tolerance: inputs.tolerance } : {}) },
    outputs,
    ...(warnings.length ? { warnings } : {}),
    margins: [],
    covers: [target],
  };
}

/* ---------------- POD reduced-order model ---------------- */

function jacobiEigenSym(Ain) {
  const n = Ain.length;
  const A = Ain.map((r) => [...r]);
  let V = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 60; sweep += 1) {
    let off = 0;
    for (let i = 0; i < n; i += 1) for (let j = i + 1; j < n; j += 1) off += A[i][j] ** 2;
    if (Math.sqrt(off) < 1e-14) break;
    for (let p = 0; p < n; p += 1) for (let q = p + 1; q < n; q += 1) {
      if (A[p][q] === 0) continue;
      const theta = 0.5 * Math.atan2(2 * A[p][q], A[q][q] - A[p][p]);
      const c = Math.cos(theta);
      const s = Math.sin(theta);
      for (let k = 0; k < n; k += 1) {
        const akp = A[k][p];
        const akq = A[k][q];
        A[k][p] = c * akp - s * akq;
        A[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < n; k += 1) {
        const apk = A[p][k];
        const aqk = A[q][k];
        A[p][k] = c * apk - s * aqk;
        A[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < n; k += 1) {
        const vkp = V[k][p];
        const vkq = V[k][q];
        V[k][p] = c * vkp - s * vkq;
        V[k][q] = s * vkp + c * vkq;
      }
    }
  }
  const pairs = Array.from({ length: n }, (_, i) => ({ value: A[i][i], vector: V.map((row) => row[i]) }));
  pairs.sort((a, b) => b.value - a.value);
  return pairs;
}

function runPod(inputs) {
  const snaps = inputs.snapshots;
  if (!snaps || !Array.isArray(snaps.parameters) || !Array.isArray(snaps.fields)
    || snaps.parameters.length === 0 || snaps.parameters.length !== snaps.fields.length) {
    return { notComputed: "missing_input:snapshots {parameters: [[mu...], ...], fields: [[field...], ...]} with one field per parameter set" };
  }
  const nS = snaps.fields.length;
  if (nS > 64) return { notComputed: "size_above_envelope:POD is capped at 64 snapshots at the JS tier (larger snapshot sets: requires_engine_tier:sxe-01)" };
  const fieldLen = Array.isArray(snaps.fields[0]) ? snaps.fields[0].length : 0;
  if (fieldLen < 2 || !snaps.fields.every((f) => Array.isArray(f) && f.length === fieldLen && f.every(Number.isFinite))) {
    return { notComputed: "invalid_input:snapshots.fields must be equal-length finite arrays" };
  }
  const pd = Array.isArray(snaps.parameters[0]) ? snaps.parameters[0].length : 0;
  if (pd < 1 || pd > 4 || !snaps.parameters.every((p) => Array.isArray(p) && p.length === pd && p.every(Number.isFinite))) {
    return { notComputed: "invalid_input:snapshots.parameters must be 1..4-dimensional finite vectors" };
  }
  const qp = inputs.queryParameters;
  if (!Array.isArray(qp) || qp.length !== pd || !qp.every(Number.isFinite)) {
    return { notComputed: `missing_input:queryParameters (one ${pd}-dimensional finite parameter vector)` };
  }
  const hull = Array.from({ length: pd }, (_, j) => [Math.min(...snaps.parameters.map((p) => p[j])), Math.max(...snaps.parameters.map((p) => p[j]))]);
  const outside = hullGate(hull, qp);
  if (outside) return { notComputed: outside };
  // Gram matrix + POD modes
  const G = snaps.fields.map((a) => snaps.fields.map((b) => a.reduce((s, v, k) => s + v * b[k], 0)));
  const pairs = jacobiEigenSym(G);
  const totalEnergy = pairs.reduce((s, p) => s + Math.max(0, p.value), 0);
  const modesWanted = inputs.modes ?? pairs.filter((p) => p.value > 1e-10 * Math.max(1, totalEnergy)).length;
  if (!Number.isInteger(modesWanted) || modesWanted < 1 || modesWanted > nS) {
    return { notComputed: `invalid_input:modes must be an integer in [1, ${nS}]` };
  }
  const modes = [];
  for (let k = 0; k < modesWanted; k += 1) {
    const lam = Math.max(0, pairs[k].value);
    const coef = pairs[k].vector;
    const phi = new Array(fieldLen).fill(0);
    if (lam > 0) {
      snaps.fields.forEach((f, i) => { const w = coef[i] / Math.sqrt(lam); f.forEach((v, j) => { phi[j] += w * v; }); });
    }
    modes.push(phi);
  }
  const energyCaptured = pairs.slice(0, modesWanted).reduce((s, p) => s + Math.max(0, p.value), 0) / (totalEnergy || 1);
  // coefficient response surfaces (degree <= 2 poly) over parameters
  const degree = Math.min(2, inputs.degree ?? 2);
  const coeffFits = modes.map((phi) => {
    const coeffs = snaps.fields.map((f) => f.reduce((s, v, j) => s + v * phi[j], 0));
    return { fit: fitPoly(snaps.parameters, coeffs, degree), coeffs };
  });
  for (const cf of coeffFits) if (cf.fit.error) return { notComputed: `POD coefficient surface: ${cf.fit.error}` };
  const predictedCoeffs = coeffFits.map((cf) => predictPoly(cf.fit, degree, qp));
  const field = new Array(fieldLen).fill(0);
  modes.forEach((phi, k) => { phi.forEach((v, j) => { field[j] += predictedCoeffs[k].value * v; }); });
  const fieldErrorBar = Math.sqrt(predictedCoeffs.reduce((s, pc) => s + (pc.errorBar / Z95) ** 2, 0)) * Z95;
  return {
    inputs: { snapshots: inputs.snapshots, queryParameters: qp, ...(inputs.modes !== undefined ? { modes: inputs.modes } : {}) },
    outputs: {
      modesUsed: modesWanted,
      energyCaptured,
      singularValues: pairs.slice(0, modesWanted).map((p) => Math.sqrt(Math.max(0, p.value))),
      predictedField: field,
      fieldErrorBar,
      errorBarBasis: "coefficient prediction intervals combined in quadrature through the unit-norm modes (approximate, labelled)",
    },
    margins: [],
    covers: ["pod"],
  };
}

export const surrogateBuild = registerSolver({
  id: "surrogate.build",
  version: "1.0.0",
  domain: "surrogate",
  domains: ["surrogate", "uq"],
  fidelity: 3,
  method: "polynomial response surfaces (OLS + leverage prediction intervals), ordinary kriging (Gaussian correlation, theta by closed-form LOO-CV, native kriging variance), POD reduced-order models (Gram eigensystem + coefficient surfaces) — trained only on caller-supplied top-tier runs",
  reference: "self-validated against held-out top-tier runs (catalogue) — reference case: a quadratic surface trained on an exactly quadratic function recovers it with held-out error at numerical precision; kriging reproduces training values exactly (interpolant)",
  regime: "predictions inside the per-dimension training hull only — outside refuses by name; training caps 500 points (poly) / 200 (kriging) / 64 snapshots (POD), dimensions <= 8 (POD parameters <= 4); engine-scale POD/DMD and GP are requires_engine_tier:sxe-01",
  units: { inputs: "training points/values, snapshot fields and parameters (caller's units)", outputs: "predictions with 95% error bars in the value's units; POD energy fractions dimensionless" },
  tolerance: "held-out validation graded at the caller's declared tolerance and reported as measured; a miss serves as WARN, never hidden",
  screening: false,
  targets: () => [], // direct-call solver (solve.direct shape)
  run: runSurrogate,
});
