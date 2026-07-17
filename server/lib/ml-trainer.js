// server/lib/ml-trainer.js
//
// A genuine small-scale, in-process, CPU trainer backing `ml.js`'s
// `experiment-train` macro. This is deliberately NOT a GPU/deep-learning
// trainer and does NOT borrow the HuggingFace hub's credibility — it is
// plain deterministic gradient descent / Lloyd's algorithm over a real
// user-supplied numeric matrix, on the order of thousands of rows (not
// millions). Every exported trainer is:
//
//   - SEEDED: a fixed `seed` produces byte-identical weights/centroids and
//     an identical per-epoch loss curve on the same input. Determinism is
//     the honesty guarantee — there is no hidden randomness to hand-wave
//     over, and results are reproducible for review.
//   - FAIL-CLOSED: sparse/degenerate/non-finite input returns an honest
//     `{ ok:false, reason, message }` shape rather than a fabricated model.
//     A caller MUST check `.ok` before trusting `.weights`/`.centroids`.
//
// Scale limits (disclosed, not hidden): this runs full-batch gradient
// descent / full-batch Lloyd's iterations in plain JS on the main thread.
// It is appropriate for exploratory/small datasets — thousands of rows,
// a handful to dozens of numeric features — not for production-scale or
// GPU-scale training. `MAX_TRAIN_ROWS` below is the hard cap; rows beyond
// it are deterministically truncated (first N, not a random sample) and
// the caller is told so via `truncatedFrom`.

export const MIN_TRAIN_ROWS = 8;
export const MAX_TRAIN_ROWS = 5000;
export const MAX_EPOCHS = 2000;

/** Deterministic RNG (mulberry32) — same seed ⇒ same stream, always. */
export function mulberry32(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round = (v, dp) => {
  if (!Number.isFinite(v)) return v; // let the finiteness gate above catch it — never silently coerce to 0 here
  const f = Math.pow(10, dp);
  return Math.round(v * f) / f;
};
const round4 = (v) => round(v, 4);
const round6 = (v) => round(v, 6);

/**
 * Build a clean numeric feature matrix from raw dataset rows, mirroring
 * `datasetProfile`'s numeric-column detection (a column counts as numeric
 * only when EVERY row's cell parses to a finite number — same strictness
 * as `featureImportance`'s `finiteCell`, deliberately stricter than
 * `datasetProfile`'s 80%-threshold heuristic, because a training matrix
 * can't tolerate silently-zeroed poison cells).
 *
 * Rows with a missing/non-finite target, or any non-finite feature cell,
 * are DROPPED (counted in `droppedRows`) rather than coerced — dropping
 * is the honest choice; coercing to 0 would quietly bias the fit.
 */
export function buildFeatureMatrix(data, targetField) {
  if (!Array.isArray(data) || data.length === 0) {
    return { featureNames: [], X: [], yRaw: [], rows: 0, droppedRows: 0, totalRows: 0, truncatedFrom: null };
  }
  const totalRows = data.length;
  let truncatedFrom = null;
  let rows = data;
  if (rows.length > MAX_TRAIN_ROWS) {
    truncatedFrom = rows.length;
    rows = rows.slice(0, MAX_TRAIN_ROWS);
  }
  const finiteCell = (v) => { const n = parseFloat(v); return Number.isFinite(n); };
  const fields = Object.keys(rows[0]).filter((k) => k !== targetField);
  const numericFields = fields.filter((f) => rows.every((r) => finiteCell(r[f])));
  const X = [];
  const yRaw = [];
  let droppedRows = 0;
  for (const row of rows) {
    if (targetField != null) {
      const tv = row[targetField];
      if (tv === undefined || tv === null || tv === "") { droppedRows++; continue; }
    }
    const vec = numericFields.map((f) => parseFloat(row[f]));
    if (!vec.every(Number.isFinite)) { droppedRows++; continue; }
    X.push(vec);
    yRaw.push(targetField != null ? row[targetField] : null);
  }
  return { featureNames: numericFields, X, yRaw, rows: X.length, droppedRows, totalRows, truncatedFrom };
}

/** Z-score standardize columns. A constant column (std=0) maps to all-zeros post-standardization, never division by zero. */
export function standardize(X) {
  const n = X.length;
  if (n === 0) return { Xs: [], means: [], stds: [] };
  const d = X[0].length;
  const means = new Array(d).fill(0);
  for (const row of X) for (let j = 0; j < d; j++) means[j] += row[j];
  for (let j = 0; j < d; j++) means[j] /= n;
  const variances = new Array(d).fill(0);
  for (const row of X) for (let j = 0; j < d; j++) variances[j] += (row[j] - means[j]) ** 2;
  const stds = variances.map((v) => { const s = Math.sqrt(v / n); return s > 1e-12 ? s : 1; });
  const Xs = X.map((row) => row.map((v, j) => (v - means[j]) / stds[j]));
  return { Xs, means, stds };
}

/** Seeded Fisher-Yates shuffle of row indices, split into train/val. */
export function trainValSplit(n, valFraction, seed) {
  const idx = Array.from({ length: n }, (_, i) => i);
  const rng = mulberry32(seed);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = idx[i]; idx[i] = idx[j]; idx[j] = tmp;
  }
  const valCount = Math.min(n - 1, Math.max(1, Math.round(n * valFraction)));
  const valIdx = idx.slice(0, valCount);
  const trainIdx = idx.slice(valCount);
  return { trainIdx, valIdx };
}

function dot(a, b) { let s = 0; for (let j = 0; j < a.length; j++) s += a[j] * b[j]; return s; }
function sigmoid(z) { return 1 / (1 + Math.exp(-z)); }

function bceLoss(Xs, yBin, idxs, w, b) {
  const eps = 1e-12;
  let s = 0;
  for (const i of idxs) {
    const p = Math.min(1 - eps, Math.max(eps, sigmoid(dot(Xs[i], w) + b)));
    s += -(yBin[i] * Math.log(p) + (1 - yBin[i]) * Math.log(1 - p));
  }
  return idxs.length ? s / idxs.length : 0;
}
function bceAccuracy(Xs, yBin, idxs, w, b) {
  if (idxs.length === 0) return 0;
  let correct = 0;
  for (const i of idxs) {
    const pred = sigmoid(dot(Xs[i], w) + b) >= 0.5 ? 1 : 0;
    if (pred === yBin[i]) correct++;
  }
  return correct / idxs.length;
}

/**
 * Batch gradient-descent logistic regression for a BINARY target.
 * Fully deterministic given `seed` (only source of randomness is the
 * train/val shuffle — weight init is a fixed zero vector, which for a
 * convex loss like BCE needs no random init to converge).
 *
 * Returns `{ ok:false, reason, message }` on: too few rows, a target with
 * <2 or >2 classes, a train split missing one of the two classes, or a
 * non-finite loss mid-training (numeric divergence) — never a fabricated
 * `ok:true` model in any of those cases.
 */
export function trainLogisticRegression({ X, y, featureNames, epochs = 200, learningRate = 0.1, seed = 42, valFraction = 0.2, l2 = 0 }) {
  const n = X.length;
  if (n < MIN_TRAIN_ROWS) {
    return { ok: false, reason: "insufficient_rows", message: `Need at least ${MIN_TRAIN_ROWS} rows to train (got ${n}).` };
  }
  const classes = [...new Set(y)].sort((a, b) => {
    if (typeof a === "number" && typeof b === "number") return a - b;
    return String(a).localeCompare(String(b));
  });
  if (classes.length < 2) {
    return { ok: false, reason: "no_class_variation", message: "Target column has only one distinct value — nothing to learn." };
  }
  if (classes.length > 2) {
    return { ok: false, reason: "not_binary", message: `Logistic regression requires a binary target; found ${classes.length} distinct classes. Use k-means for unsupervised grouping instead.` };
  }
  const [negative, positive] = classes;
  const yBin = y.map((v) => (v === positive ? 1 : 0));
  const { trainIdx, valIdx } = trainValSplit(n, valFraction, seed);
  if (trainIdx.length < 2 || valIdx.length < 1) {
    return { ok: false, reason: "insufficient_rows", message: "Not enough rows to form a train/validation split." };
  }
  const trainClasses = new Set(trainIdx.map((i) => yBin[i]));
  if (trainClasses.size < 2) {
    return { ok: false, reason: "degenerate_split", message: "The training split contains only one class — provide more rows or a more balanced target." };
  }
  const { Xs, means, stds } = standardize(X);
  const d = Xs[0].length;
  const w = new Array(d).fill(0);
  let b = 0;
  const cappedEpochs = Math.min(MAX_EPOCHS, Math.max(1, Math.round(epochs)));
  const history = [];
  for (let epoch = 1; epoch <= cappedEpochs; epoch++) {
    const gradW = new Array(d).fill(0);
    let gradB = 0;
    for (const i of trainIdx) {
      const err = sigmoid(dot(Xs[i], w) + b) - yBin[i];
      for (let j = 0; j < d; j++) gradW[j] += err * Xs[i][j];
      gradB += err;
    }
    const m = trainIdx.length;
    for (let j = 0; j < d; j++) w[j] -= learningRate * (gradW[j] / m + l2 * w[j]);
    b -= learningRate * (gradB / m);

    const trainLoss = bceLoss(Xs, yBin, trainIdx, w, b);
    const valLoss = bceLoss(Xs, yBin, valIdx, w, b);
    if (!Number.isFinite(trainLoss) || !Number.isFinite(valLoss) || !w.every(Number.isFinite) || !Number.isFinite(b)) {
      return { ok: false, reason: "diverged", message: `Training diverged at epoch ${epoch} (non-finite loss) — try a smaller learning rate.`, history };
    }
    history.push({
      epoch,
      trainLoss: round4(trainLoss),
      valLoss: round4(valLoss),
      trainAccuracy: round4(bceAccuracy(Xs, yBin, trainIdx, w, b)),
      valAccuracy: round4(bceAccuracy(Xs, yBin, valIdx, w, b)),
    });
  }
  const last = history[history.length - 1];
  return {
    ok: true,
    algorithm: "logistic-regression",
    featureNames,
    weights: w.map(round6),
    bias: round6(b),
    standardization: { means: means.map(round6), stds: stds.map(round6) },
    classes: { negative, positive },
    epochs: cappedEpochs,
    history,
    finalTrainLoss: last.trainLoss,
    finalValLoss: last.valLoss,
    finalTrainAccuracy: last.trainAccuracy,
    finalValAccuracy: last.valAccuracy,
    trainRows: trainIdx.length,
    valRows: valIdx.length,
  };
}

/**
 * Lloyd's-algorithm k-means. Deterministic given `seed`: initial centroids
 * are k distinct training rows chosen via a seeded shuffle (not
 * `Math.random`). Stops early once no centroid moves (converged) or at
 * `epochs` iterations, whichever comes first.
 *
 * An empty cluster (a centroid that attracts zero points on some
 * iteration) keeps its PREVIOUS position rather than being silently
 * reseeded — reseeding would hide a real degeneracy (k too large for the
 * data's actual structure) behind a plausible-looking result.
 */
export function trainKMeans({ X, featureNames, k = 3, epochs = 25, seed = 42, valFraction = 0.2 }) {
  const n = X.length;
  if (n < MIN_TRAIN_ROWS) {
    return { ok: false, reason: "insufficient_rows", message: `Need at least ${MIN_TRAIN_ROWS} rows to cluster (got ${n}).` };
  }
  if (!Number.isInteger(k) || k < 2) {
    return { ok: false, reason: "invalid_k", message: "k must be an integer >= 2." };
  }
  const { trainIdx, valIdx } = trainValSplit(n, valFraction, seed);
  if (trainIdx.length < k) {
    return { ok: false, reason: "insufficient_rows", message: `Training split (${trainIdx.length} rows) is smaller than k=${k}.` };
  }
  const { Xs, means, stds } = standardize(X);
  const d = Xs[0].length;
  const dist2 = (a, b) => { let s = 0; for (let j = 0; j < d; j++) { const diff = a[j] - b[j]; s += diff * diff; } return s; };

  const rng = mulberry32((seed >>> 0) ^ 0x9e3779b9); // distinct stream from the split shuffle
  const pool = [...trainIdx];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
  }
  let centroids = pool.slice(0, k).map((i) => Xs[i].slice());

  const assign = (idxs) => idxs.map((i) => {
    let best = 0, bestD = Infinity;
    for (let c = 0; c < centroids.length; c++) {
      const dd = dist2(Xs[i], centroids[c]);
      if (dd < bestD) { bestD = dd; best = c; }
    }
    return best;
  });
  const inertiaOf = (idxs, labels) => idxs.length
    ? idxs.reduce((s, i, ii) => s + dist2(Xs[i], centroids[labels[ii]]), 0) / idxs.length
    : 0;

  const cappedEpochs = Math.min(MAX_EPOCHS, Math.max(1, Math.round(epochs)));
  const history = [];
  let trainLabels = assign(trainIdx);
  for (let epoch = 1; epoch <= cappedEpochs; epoch++) {
    const sums = Array.from({ length: k }, () => new Array(d).fill(0));
    const counts = new Array(k).fill(0);
    trainIdx.forEach((i, ii) => { const c = trainLabels[ii]; counts[c]++; for (let j = 0; j < d; j++) sums[c][j] += Xs[i][j]; });
    let moved = false;
    for (let c = 0; c < k; c++) {
      if (counts[c] === 0) continue; // keep prior centroid — honest, not reseeded
      const next = sums[c].map((v) => v / counts[c]);
      if (dist2(next, centroids[c]) > 1e-10) moved = true;
      centroids[c] = next;
    }
    trainLabels = assign(trainIdx);
    const valLabels = assign(valIdx);
    const trainInertia = inertiaOf(trainIdx, trainLabels);
    const valInertia = inertiaOf(valIdx, valLabels);
    if (!Number.isFinite(trainInertia) || !Number.isFinite(valInertia)) {
      return { ok: false, reason: "diverged", message: `Clustering diverged at epoch ${epoch}.`, history };
    }
    history.push({ epoch, trainLoss: round6(trainInertia), valLoss: round6(valInertia) });
    if (!moved) break;
  }
  const finalLabels = assign(trainIdx);
  const clusterSizes = new Array(k).fill(0);
  finalLabels.forEach((c) => clusterSizes[c]++);
  const last = history[history.length - 1];
  return {
    ok: true,
    algorithm: "kmeans",
    featureNames,
    k,
    centroids: centroids.map((c) => c.map(round6)),
    standardization: { means: means.map(round6), stds: stds.map(round6) },
    history,
    finalTrainInertia: last.trainLoss,
    finalValInertia: last.valLoss,
    clusterSizes,
    trainRows: trainIdx.length,
    valRows: valIdx.length,
    iterations: history.length,
  };
}
