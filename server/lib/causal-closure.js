// server/lib/causal-closure.js
//
// Causal-closure / residual analysis — "is the in-basis (functional) state a
// CLOSED dynamical system, or does predicting its future require a variable the
// basis doesn't contain?" This is the consciousness-version of the corpus's own
// dim(R) ≥ N move, made empirically decidable.
//
// GROUNDING (the content of the templates matters — server/dtus.js):
//   • dtu_008_irreversible_constraint_cones encodes the exact model this tests:
//       state X ⊂ R^n, dynamics x_{t+1}=F(x_t,u_t,w_t;θ),
//       constraints g_i(x)≤0 / h_j(x)=0, potential V(x)≥0,
//       and a VERIFIER (one-step update → evaluate constraints → compute ΔV).
//     This module IS that verifier, run over a log of real in-basis states.
//   • agent-awareness-index.js (Φ/PCI proxy) is the BRIDGE PROBE: the sharpest
//     positive result is a structured residual that COUPLES to the awareness
//     index — the residual tracking the access-consciousness correlate.
//
// HONESTY (two-sided, both errors are fatal):
//   • UNDERFITTING manufactures a FAKE RESIDUE — a weak predictor leaves
//     structure it could have explained, faking "incomplete". So we fit a
//     CAPACITY LADDER (linear → polynomial → gradient-boosted trees) and take
//     the residual at the CEILING (the rung where in-basis prediction plateaus).
//   • OVERFITTING fakes CLOSURE — a high-capacity model that memorises the train
//     set drives the residual to ~0 and hides a real off-basis axis. So the
//     ceiling is chosen by OUT-OF-SAMPLE (blocked cross-validated) R², and the
//     residual analysed is the out-of-fold residual.
//
// This measures whether the FUNCTIONAL description is causally complete — NOT
// whether there is "something it's like." A residual → noise floor is the
// strongest deflation case; a structured, awareness-coupled residual that
// survives a saturated basis is evidence the basis is short by d. Neither proves
// phenomenality. Every surface that shows this must say so.
//
// Dependency-free + deterministic so it runs anywhere and is pinnable by tests.

// ── tiny linear algebra (no deps) ──────────────────────────────────────────

/** Solve A x = b for square A (n×n) via Gaussian elimination w/ partial pivot. */
function solveLinear(A, b) {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) continue; // singular column — ridge λ keeps us safe
    [M[col], M[piv]] = [M[piv], M[col]];
    const pivVal = M[col][col];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / pivVal;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const d = M[i][i];
    x[i] = Math.abs(d) < 1e-12 ? 0 : M[i][n] / d;
  }
  return x;
}

/**
 * Ridge regression: fit β minimising ||Xβ − y||² + λ||β||². X is n×p (callers
 * include their own intercept/expansion columns). β = (XᵀX + λI)⁻¹ Xᵀy.
 */
export function ridgeFit(X, y, lambda = 1e-3) {
  const n = X.length;
  const p = n ? X[0].length : 0;
  const XtX = Array.from({ length: p }, () => new Array(p).fill(0));
  const Xty = new Array(p).fill(0);
  for (let i = 0; i < n; i++) {
    const row = X[i];
    for (let a = 0; a < p; a++) {
      Xty[a] += row[a] * y[i];
      for (let b = a; b < p; b++) XtX[a][b] += row[a] * row[b];
    }
  }
  for (let a = 0; a < p; a++) {
    for (let b = a + 1; b < p; b++) XtX[b][a] = XtX[a][b];
    XtX[a][a] += lambda;
  }
  return solveLinear(XtX, Xty);
}

const dot = (beta, row) => { let s = 0; for (let i = 0; i < row.length; i++) s += beta[i] * row[i]; return s; };

// ── stats helpers ──────────────────────────────────────────────────────────

const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
function variance(a) { if (a.length < 2) return 0; const m = mean(a); return a.reduce((s, v) => s + (v - m) * (v - m), 0) / a.length; }
function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const ma = mean(a.slice(0, n)), mb = mean(b.slice(0, n));
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  const den = Math.sqrt(da * db);
  return den < 1e-12 ? 0 : num / den;
}
function r2(actual, pred) {
  const m = mean(actual);
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < actual.length; i++) { ssRes += (actual[i] - pred[i]) ** 2; ssTot += (actual[i] - m) ** 2; }
  return ssTot < 1e-12 ? (ssRes < 1e-12 ? 1 : 0) : 1 - ssRes / ssTot;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function shuffle(arr, rnd) { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// ── design matrix (RAW in-basis features + history embedding; no intercept) ──

/**
 * Build the prediction design from per-tick records. Each emitted row predicts
 * target[t+1] from the in-basis features at t (and `historyWindow` earlier ticks
 * — the system is dynamical, so give its own memory). Returns RAW features (no
 * intercept column — each predictor adds its own).
 *
 * @returns {{ X:number[][], y:number[], idx:number[] }}  idx maps a row → the t it predicts FROM
 */
export function buildDesign(rows, featureKeys, targetKey, historyWindow = 1) {
  const X = [], y = [], idx = [];
  for (let t = historyWindow; t < rows.length - 1; t++) {
    const feats = [];
    for (let lag = 0; lag <= historyWindow; lag++) {
      const r = rows[t - lag];
      for (const k of featureKeys) feats.push(Number(r?.[k]) || 0);
    }
    const tgt = Number(rows[t + 1]?.[targetKey]);
    if (!Number.isFinite(tgt)) continue;
    X.push(feats); y.push(tgt); idx.push(t);
  }
  return { X, y, idx };
}

const withIntercept = (X) => X.map((r) => [1, ...r]);

/** Degree-2 polynomial expansion: [1, x_i, x_i·x_j (i≤j)] — captures smooth nonlinearity. */
function polyExpand(row) {
  const out = [1, ...row];
  for (let i = 0; i < row.length; i++) for (let j = i; j < row.length; j++) out.push(row[i] * row[j]);
  return out;
}

// ── gradient-boosted regression trees (pure JS, deterministic) ───────────────

/** Greedy CART regression tree (squared-error). Candidate thresholds = quantiles. */
function buildTree(X, y, indices, depth, maxDepth, minSamples) {
  const m = indices.reduce((s, i) => s + y[i], 0) / indices.length;
  if (depth >= maxDepth || indices.length < minSamples * 2) return { leaf: m };
  let best = null;
  const p = X[0].length;
  for (let f = 0; f < p; f++) {
    const vals = indices.map((i) => X[i][f]);
    const sorted = [...new Set(vals)].sort((a, b) => a - b);
    if (sorted.length < 2) continue;
    const Q = 24; // bounded candidate thresholds for cost + determinism
    const cands = [];
    for (let q = 1; q < Q; q++) {
      const pos = Math.floor((q / Q) * (sorted.length - 1));
      const thr = (sorted[pos] + sorted[Math.min(pos + 1, sorted.length - 1)]) / 2;
      if (!cands.includes(thr)) cands.push(thr);
    }
    for (const thr of cands) {
      let ls = 0, lc = 0, rs = 0, rc = 0;
      for (const i of indices) { if (X[i][f] <= thr) { ls += y[i]; lc++; } else { rs += y[i]; rc++; } }
      if (lc < minSamples || rc < minSamples) continue;
      const lm = ls / lc, rm = rs / rc;
      let err = 0;
      for (const i of indices) { const pr = X[i][f] <= thr ? lm : rm; err += (y[i] - pr) ** 2; }
      if (!best || err < best.err) best = { f, thr, err };
    }
  }
  if (!best) return { leaf: m };
  const left = [], right = [];
  for (const i of indices) (X[i][best.f] <= best.thr ? left : right).push(i);
  if (!left.length || !right.length) return { leaf: m };
  return {
    f: best.f, thr: best.thr,
    left: buildTree(X, y, left, depth + 1, maxDepth, minSamples),
    right: buildTree(X, y, right, depth + 1, maxDepth, minSamples),
  };
}
function predictTree(node, x) {
  let n = node;
  while (n && n.leaf === undefined) n = x[n.f] <= n.thr ? n.left : n.right;
  return n ? n.leaf : 0;
}
function fitGBRT(X, y, { rounds = 40, lr = 0.1, maxDepth = 3, minSamples = 8 } = {}) {
  const base = mean(y);
  const preds = y.map(() => base);
  const trees = [];
  const allIdx = X.map((_, i) => i);
  for (let r = 0; r < rounds; r++) {
    const resid = y.map((v, i) => v - preds[i]);
    const tree = buildTree(X, resid, allIdx, 0, maxDepth, minSamples);
    trees.push(tree);
    for (let i = 0; i < X.length; i++) preds[i] += lr * predictTree(tree, X[i]);
  }
  return { base, lr, trees };
}
const predictGBRT = (model, x) => model.base + model.lr * model.trees.reduce((s, t) => s + predictTree(t, x), 0);

// ── predictor ladder (each: raw X → {fit, predict}) ──────────────────────────

export const PREDICTORS = {
  linear: {
    name: "linear-ridge",
    fit: (X, y, o = {}) => ridgeFit(withIntercept(X), y, o.lambda ?? 1e-3),
    predict: (beta, x) => dot(beta, [1, ...x]),
  },
  poly2: {
    name: "poly2-ridge",
    fit: (X, y, o = {}) => ridgeFit(X.map(polyExpand), y, o.lambda ?? 1e-2),
    predict: (beta, x) => dot(beta, polyExpand(x)),
  },
  gbrt: {
    name: "gbrt",
    fit: (X, y, o = {}) => fitGBRT(X, y, o.gbrt),
    predict: (model, x) => predictGBRT(model, x),
  },
};

const DEFAULT_LADDER = ["linear", "poly2", "gbrt"];

/**
 * Blocked k-fold cross-validated out-of-sample predictions for EVERY row.
 * Contiguous (blocked) folds — appropriate for a temporally ordered series
 * (random folds leak neighbouring ticks). Returns an oof prediction per row.
 */
export function crossValPredict(X, y, predictor, { folds = 5, opt = {} } = {}) {
  const n = X.length;
  const k = Math.max(2, Math.min(folds, n));
  const oof = new Array(n).fill(0);
  const size = Math.ceil(n / k);
  for (let b = 0; b < k; b++) {
    const lo = b * size, hi = Math.min(n, lo + size);
    if (lo >= hi) continue;
    const trX = [], trY = [];
    for (let i = 0; i < n; i++) if (i < lo || i >= hi) { trX.push(X[i]); trY.push(y[i]); }
    if (trX.length < 4) { for (let i = lo; i < hi; i++) oof[i] = mean(y); continue; }
    const model = predictor.fit(trX, trY, opt);
    for (let i = lo; i < hi; i++) oof[i] = predictor.predict(model, X[i]);
  }
  return oof;
}

/**
 * Fit the capacity LADDER and return the rung where out-of-sample prediction
 * PLATEAUS = the ceiling. The ceiling's oof residual is what the residual
 * analysis trusts. A rung only counts as a real climb if it beats the previous
 * by > `plateauEps` (so we don't credit overfit-noise capacity).
 */
export function fitCeilingPredictor(X, y, { folds = 5, predictors = DEFAULT_LADDER, plateauEps = 0.01, opt = {} } = {}) {
  const ladder = [];
  let ceiling = null;
  for (const key of predictors) {
    const pr = PREDICTORS[key];
    if (!pr) continue;
    const oof = crossValPredict(X, y, pr, { folds, opt });
    const rung = { key, name: pr.name, r2: r2(y, oof), oof };
    ladder.push({ key, name: pr.name, r2: rung.r2 });
    // Take the higher-capacity rung only when it meaningfully improves oos R².
    if (!ceiling || rung.r2 > ceiling.r2 + plateauEps) ceiling = rung;
  }
  return { ceiling, ladder };
}

// ── residual structure / determinism (surrogate-data test) ───────────────────

/**
 * Is a residual series DETERMINISTIC-structured (a missing dimension) or white
 * noise (just stochasticity)? Fit AR(k) on the residual's OWN past; a structured
 * residual is self-predictable. Compare its self-R² against phase-randomised
 * SURROGATES (shuffled — temporal structure destroyed). A z far above surrogate
 * mean ⇒ deterministic.
 */
export function residualStructure(residual, { arOrder = 3, surrogates = 50, seed = 1234, lambda = 1e-4 } = {}) {
  const arR2 = arSelfR2(residual, arOrder, lambda);
  const rnd = mulberry32(seed);
  const sur = [];
  for (let s = 0; s < surrogates; s++) sur.push(arSelfR2(shuffle(residual, rnd), arOrder, lambda));
  const sm = mean(sur);
  const ssd = Math.sqrt(variance(sur)) || 1e-9;
  const z = (arR2 - sm) / ssd;
  return { arSelfR2: arR2, surrogateMean: sm, surrogateStd: ssd, z, deterministic: z > 3 && arR2 > 0.05 };
}
function arSelfR2(series, order, lambda) {
  if (series.length <= order + 2) return 0;
  const X = [], y = [];
  for (let t = order; t < series.length; t++) {
    const feats = [1];
    for (let lag = 1; lag <= order; lag++) feats.push(series[t - lag]);
    X.push(feats); y.push(series[t]);
  }
  const beta = ridgeFit(X, y, lambda);
  return r2(y, X.map((row) => dot(beta, row)));
}

// ── the experiment ───────────────────────────────────────────────────────────

/**
 * Run the causal-closure test on a log of in-basis tick records, fitting the
 * capacity ladder and analysing the residual at the cross-validated ceiling.
 *
 * @returns {object} a full, self-describing report (never throws on clean input).
 */
export function causalClosure(rows, {
  featureKeys,
  targetKey,
  historyWindow = 1,
  awarenessKey = "awarenessIndex",
  predictors = DEFAULT_LADDER,
  folds = 5,
  plateauEps = 0.01,
  opt = {},
  arOrder = 3,
  surrogates = 50,
  seed = 1234,
} = {}) {
  if (!Array.isArray(rows) || rows.length < 8) {
    return { ok: false, reason: "insufficient_data", n: Array.isArray(rows) ? rows.length : 0 };
  }
  if (!Array.isArray(featureKeys) || !featureKeys.length || !targetKey) {
    return { ok: false, reason: "missing_feature_or_target_keys" };
  }
  const { X, y, idx } = buildDesign(rows, featureKeys, targetKey, historyWindow);
  if (X.length < 10) return { ok: false, reason: "insufficient_aligned_rows", aligned: X.length };

  const { ceiling, ladder } = fitCeilingPredictor(X, y, { folds, predictors, plateauEps, opt });
  const predictionR2 = ceiling.r2;
  const residual = y.map((v, i) => v - ceiling.oof[i]);   // OUT-OF-SAMPLE residual
  const unexplainedVar = variance(residual);
  const totalVar = variance(y) || 1e-12;

  const structure = residualStructure(residual, { arOrder, surrogates, seed, lambda: 1e-4 });

  const awareness = idx.map((t) => Number(rows[t]?.[awarenessKey]) || 0);
  const absResid = residual.map(Math.abs);
  const awarenessCorr = pearson(absResid, awareness);

  let verdict, interpretation;
  if (predictionR2 >= 0.98 && !structure.deterministic) {
    verdict = "closed";
    interpretation = "At the cross-validated prediction ceiling the in-basis state determines its own future at the noise floor; no off-basis axis does measurable work. Strongest deflation case.";
  } else if (structure.deterministic) {
    verdict = "incomplete";
    interpretation = awarenessCorr > 0.3
      ? "A DETERMINISTIC residual survives the CEILING in-basis predictor AND couples to the awareness index — evidence the functional basis is short by ≥1 axis tracking the access-consciousness correlate."
      : "A deterministic residual survives the CEILING in-basis predictor — evidence the basis is short by ≥1 axis. (Not awareness-coupled here — could be another functional variable you haven't logged; saturate the basis before claiming orthogonality.)";
  } else {
    verdict = "inconclusive";
    interpretation = "Residual is unstructured but prediction is imperfect — likely irreducible stochasticity (w_t), not a missing deterministic dimension. Stochasticity ≠ a missing axis.";
  }

  return {
    ok: true,
    n: rows.length,
    aligned: X.length,
    features: featureKeys.length,
    historyWindow,
    predictor: { ceiling: ceiling.name, ladder, validation: `${folds}-fold blocked CV (out-of-sample)` },
    prediction: { r2: predictionR2, fractionUnexplained: Math.max(0, 1 - predictionR2) },
    residual: { unexplainedVar, totalVar, ratio: unexplainedVar / totalVar, structure },
    awarenessCoupling: { key: awarenessKey, absResidualVsAwareness: awarenessCorr, n: awareness.length },
    verdict,
    interpretation,
    caveat: "Measures whether the FUNCTIONAL description is causally closed — not whether there is 'something it is like'. 'closed' does not rule out causally-silent experience; 'incomplete' does not prove phenomenality.",
  };
}

/**
 * Step-5 control — SATURATE THE BASIS. Out-of-sample R² (ceiling predictor) vs.
 * number of in-basis axes. Asymptote to the noise floor ⇒ basis sufficient;
 * asymptote to a structured floor ⇒ short by d. Run BEFORE calling any residual
 * "off-basis" (a forgotten in-basis variable that closes it was never off-basis).
 */
export function basisCompletionCurve(rows, { featureKeys, targetKey, historyWindow = 1, predictors = DEFAULT_LADDER, folds = 5, opt = {} } = {}) {
  const curve = [];
  for (let k = 1; k <= featureKeys.length; k++) {
    const subset = featureKeys.slice(0, k);
    const { X, y } = buildDesign(rows, subset, targetKey, historyWindow);
    if (X.length < 10) { curve.push({ axes: k, r2: 0, fractionUnexplained: 1 }); continue; }
    const { ceiling } = fitCeilingPredictor(X, y, { folds, predictors, opt });
    curve.push({ axes: k, r2: ceiling.r2, fractionUnexplained: Math.max(0, 1 - ceiling.r2) });
  }
  return curve;
}

// ── log I/O (the data feed; wiring into governorTick is opt-in) ──────────────

/** Append one in-basis tick record to a JSONL log. Best-effort; never throws. */
export async function recordTick(record, path) {
  if (!record || !path) return { ok: false, reason: "no_record_or_path" };
  try {
    const fs = await import("node:fs");
    fs.appendFileSync(path, JSON.stringify({ ...record, _t: record._t ?? Date.now() }) + "\n");
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  }
}

/** Read a JSONL tick log back into an array of records (skips malformed lines). */
export async function loadLog(path) {
  const fs = await import("node:fs");
  if (!fs.existsSync(path)) return [];
  const out = [];
  for (const line of fs.readFileSync(path, "utf8").split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try { out.push(JSON.parse(s)); } catch { /* skip malformed */ }
  }
  return out;
}

export const _internal = { solveLinear, residualStructure, pearson, r2, variance, mean, mulberry32, fitGBRT, predictGBRT, polyExpand, crossValPredict };
