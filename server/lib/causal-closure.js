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
// HONESTY: this measures whether the FUNCTIONAL description is causally complete
// — NOT whether there is "something it's like." A residual → noise floor is the
// strongest deflation case; a structured, awareness-coupled residual that
// survives a saturated basis is evidence the basis is short by d. Neither proves
// phenomenality. Every surface that shows this must say so.
//
// Dependency-free + deterministic (seeded surrogates) so it runs anywhere and is
// pinnable by tests. Linear ridge is the BASELINE in-basis predictor; the
// proposal's "push capacity until the in-basis prediction plateaus" is a future
// swap of fitPredictor — the residual pipeline is predictor-agnostic.

// ── tiny linear algebra (no deps) ──────────────────────────────────────────

/** Solve A x = b for square A (n×n) via Gaussian elimination w/ partial pivot. */
function solveLinear(A, b) {
  const n = A.length;
  // Augment.
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    // Partial pivot.
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
 * Ridge regression: fit β minimising ||Xβ − y||² + λ||β||².
 * X is n×p (callers prepend a 1-column for the intercept). Returns length-p β.
 * Closed form: β = (XᵀX + λI)⁻¹ Xᵀy. λ regularises a rank-deficient XᵀX.
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
    for (let b = a + 1; b < p; b++) XtX[b][a] = XtX[a][b]; // symmetric
    XtX[a][a] += lambda; // do NOT regularise the intercept harder; uniform λ is fine for a baseline
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
/** Coefficient of determination of preds vs actuals. */
function r2(actual, pred) {
  const m = mean(actual);
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < actual.length; i++) { ssRes += (actual[i] - pred[i]) ** 2; ssTot += (actual[i] - m) ** 2; }
  return ssTot < 1e-12 ? (ssRes < 1e-12 ? 1 : 0) : 1 - ssRes / ssTot;
}
/** Seeded RNG (mulberry32) so surrogate tests are reproducible. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function shuffle(arr, rnd) { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// ── design-matrix construction (in-basis features + history embedding) ───────

/**
 * Build the prediction design from a list of per-tick records.
 * Each row predicts target[t+1] from the in-basis features at t (and `historyWindow`
 * earlier ticks — the system is dynamical; give its own memory). Prepends a 1
 * intercept column.
 *
 * @param {object[]} rows           per-tick records (e.g. { affect, salience, ..., awarenessIndex, <target> })
 * @param {string[]} featureKeys    in-basis feature names to read from each row
 * @param {string}   targetKey      the value to predict one step ahead
 * @param {number}   historyWindow  lags to include (>=0). 0 = x_t only.
 * @returns {{ X:number[][], y:number[], idx:number[] }}  idx maps each row back to the t it predicts FROM
 */
export function buildDesign(rows, featureKeys, targetKey, historyWindow = 1) {
  const X = [], y = [], idx = [];
  for (let t = historyWindow; t < rows.length - 1; t++) {
    const feats = [1]; // intercept
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

// ── residual structure / determinism (surrogate-data test) ───────────────────

/**
 * Is a residual series DETERMINISTIC-structured (a missing dimension) or white
 * noise (just stochasticity)? Fit an AR(k) model on the residual's OWN past; a
 * structured residual is self-predictable. Compare its self-R² against a
 * distribution of phase-randomised SURROGATES (shuffled residual, temporal
 * structure destroyed). A z far above the surrogate mean ⇒ deterministic.
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
  const pred = X.map((row) => dot(beta, row));
  return r2(y, pred);
}

// ── the experiment ───────────────────────────────────────────────────────────

/**
 * Run the causal-closure test on a log of in-basis tick records.
 *
 * Steps (Crick-style, mirrors the proposal & dtu_008's verifier):
 *   1. Assemble x_t        → buildDesign over featureKeys (+ history).
 *   2. Fit the ceiling in-basis predictor (ridge baseline) → next-tick target.
 *   3. Measure the residual R = actual − pred: magnitude (1−R²) and STRUCTURE
 *      (surrogate determinism test).
 *   4. Bridge probe: correlate |R| with the awareness index.
 *   5. Verdict.
 *
 * @returns {object} a full, self-describing report (never throws on clean input).
 */
export function causalClosure(rows, {
  featureKeys,
  targetKey,
  historyWindow = 1,
  lambda = 1e-3,
  awarenessKey = "awarenessIndex",
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
  if (X.length < 6) return { ok: false, reason: "insufficient_aligned_rows", aligned: X.length };

  const beta = ridgeFit(X, y, lambda);
  const pred = X.map((row) => dot(beta, row));
  const predictionR2 = r2(y, pred);
  const residual = y.map((v, i) => v - pred[i]);
  const unexplainedVar = variance(residual);
  const totalVar = variance(y) || 1e-12;

  const structure = residualStructure(residual, { arOrder, surrogates, seed, lambda: 1e-4 });

  // Bridge probe: |residual| vs the awareness index at the predicted-from tick.
  const awareness = idx.map((t) => Number(rows[t]?.[awarenessKey]) || 0);
  const absResid = residual.map(Math.abs);
  const awarenessCorr = pearson(absResid, awareness);

  // Verdict (heuristics — documented, tunable; the test pins clear-cut cases).
  let verdict, interpretation;
  if (predictionR2 >= 0.98 && !structure.deterministic) {
    verdict = "closed";
    interpretation = "The in-basis state determines its own future at the noise floor; no off-basis axis does measurable work. Strongest deflation case.";
  } else if (structure.deterministic) {
    verdict = "incomplete";
    interpretation = awarenessCorr > 0.3
      ? "A DETERMINISTIC residual survives the in-basis predictor AND couples to the awareness index — evidence the functional basis is short by ≥1 axis tracking the access-consciousness correlate."
      : "A deterministic residual survives the in-basis predictor — evidence the functional basis is short by ≥1 axis. (Not awareness-coupled in this window — could be another functional variable you haven't logged; saturate the basis before claiming orthogonality.)";
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
    prediction: { r2: predictionR2, fractionUnexplained: Math.max(0, 1 - predictionR2) },
    residual: { unexplainedVar, totalVar, ratio: unexplainedVar / totalVar, structure },
    awarenessCoupling: { key: awarenessKey, absResidualVsAwareness: awarenessCorr, n: awareness.length },
    verdict,
    interpretation,
    caveat: "Measures whether the FUNCTIONAL description is causally closed — not whether there is 'something it is like'. 'closed' does not rule out causally-silent experience; 'incomplete' does not prove phenomenality.",
  };
}

/**
 * Step 5 control — SATURATE THE BASIS. Residual vs. number of in-basis axes
 * included. If it asymptotes to the noise floor the basis is sufficient; if it
 * asymptotes to a STRUCTURED floor the basis is short by d. Run BEFORE calling
 * any residual "off-basis" (a forgotten in-basis variable that closes it was
 * never off-basis).
 *
 * @returns {{ axes:number, r2:number, fractionUnexplained:number }[]}
 */
export function basisCompletionCurve(rows, { featureKeys, targetKey, historyWindow = 1, lambda = 1e-3 } = {}) {
  const curve = [];
  for (let k = 1; k <= featureKeys.length; k++) {
    const subset = featureKeys.slice(0, k);
    const { X, y } = buildDesign(rows, subset, targetKey, historyWindow);
    if (X.length < 6) { curve.push({ axes: k, r2: 0, fractionUnexplained: 1 }); continue; }
    const beta = ridgeFit(X, y, lambda);
    const pred = X.map((row) => dot(beta, row));
    const rr = r2(y, pred);
    curve.push({ axes: k, r2: rr, fractionUnexplained: Math.max(0, 1 - rr) });
  }
  return curve;
}

// ── log I/O (the data feed; wiring into governorTick is opt-in) ──────────────

/**
 * Append one in-basis tick record to a JSONL log. The intended writer is the
 * governor tick (env-gated): capture the awareness activation map + affect +
 * drives + the tracked invariants + the awareness index + the expressed
 * behavior, one row per tick. Best-effort; never throws (must never break a tick).
 *
 * @param {object} record  the in-basis state + next-tick targets for this tick
 * @param {string} path    JSONL file path
 */
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

export const _internal = { solveLinear, residualStructure, pearson, r2, variance, mean, mulberry32 };
