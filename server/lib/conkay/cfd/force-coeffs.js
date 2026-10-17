// server/lib/conkay/cfd/force-coeffs.js
//
// Reads an OpenFOAM forceCoeffs.dat (the forceCoeffs function object's output) and reduces
// the tail of a steady RANS run to a mean with a convergence check. Pure functions.
//
// A steady SIMPLE run does not settle to one number on a bluff body: the separated wake
// keeps the coefficients oscillating. The reported value is the mean over the last N
// iterations, and the run counts as settled only when both
//   - the standard deviation over that window is small relative to the mean, and
//   - the mean of the window's first half and second half agree (no drift).
// The two limits are choices, stated in CONVERGENCE_LIMITS; they are not a published standard.

export const FORCE_COEFFS_VERSION = "1.1.0";

export const CONVERGENCE_LIMITS = Object.freeze({
  window: 500,
  maxRelSd: 0.02,
  maxRelDrift: 0.01,
  basis: "choice, not a published standard. The first Ahmed 25 deg run (2000 iterations, tests/fixtures/conkay-cfd/ahmed25) had sd/mean 0.75 % but half-window drift 1.1 % on the total (slant pressure still migrating to the base), and is NOT counted as settled under these limits",
});

/**
 * Join the forceCoeffs segments of one run (OpenFOAM writes postProcessing/<fn>/<startTime>/ per restart).
 * Segments are ordered by their first Time; where a restart overlaps, the later segment's rows win.
 * All segments must share the reference values (magUInf, lRef, Aref) and columns.
 */
export function mergeForceCoeffs(segments) {
  if (!Array.isArray(segments) || segments.length === 0) throw new Error("mergeForceCoeffs: no segments");
  const segs = [...segments].filter((s) => s.rows.length).sort((a, b) => a.rows[0].Time - b.rows[0].Time);
  if (!segs.length) throw new Error("mergeForceCoeffs: all segments empty");
  const ref = segs[0];
  for (const s of segs) {
    for (const k of ["magUInf", "lRef", "Aref"]) {
      if (s.header[k] !== ref.header[k]) throw new Error(`mergeForceCoeffs: ${k} differs between segments (${ref.header[k]} vs ${s.header[k]})`);
    }
    if (s.columns.join() !== ref.columns.join()) throw new Error("mergeForceCoeffs: columns differ between segments");
  }
  let rows = [];
  for (const s of segs) {
    const start = s.rows[0].Time;
    rows = rows.filter((r) => r.Time < start).concat(s.rows);
  }
  return { header: ref.header, columns: ref.columns, rows, segments: segs.length };
}

const HEADER_VECTOR = /^#\s*(liftDir|dragDir|pitchAxis|CofR)\s*:\s*\(([^)]*)\)\s*$/;
const HEADER_SCALAR = /^#\s*(magUInf|lRef|Aref)\s*:\s*(\S+)\s*$/;

/**
 * Parse forceCoeffs.dat text. Returns { header: { magUInf, lRef, Aref, liftDir, dragDir, pitchAxis, CofR },
 * columns: ["Time", "Cm", "Cd", ...], rows: [{ Time, Cm, Cd, ... }] }. Throws on malformed input.
 */
export function parseForceCoeffs(text) {
  if (typeof text !== "string" || !text.trim()) throw new Error("forceCoeffs: empty input");
  const header = {};
  let columns = null;
  const rows = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      let m = line.match(HEADER_VECTOR);
      if (m) { header[m[1]] = m[2].trim().split(/\s+/).map(Number); continue; }
      m = line.match(HEADER_SCALAR);
      if (m) { header[m[1]] = Number(m[2]); continue; }
      const cols = line.replace(/^#\s*/, "").split(/\s+/);
      if (cols[0] === "Time") columns = cols;
      continue;
    }
    if (!columns) throw new Error("forceCoeffs: data before the column header");
    const vals = line.split(/\s+/).map(Number);
    if (vals.length !== columns.length) throw new Error(`forceCoeffs: row has ${vals.length} values, header has ${columns.length} columns`);
    if (vals.some((v) => !Number.isFinite(v))) throw new Error(`forceCoeffs: non-finite value in row "${line.slice(0, 60)}"`);
    rows.push(Object.fromEntries(columns.map((c, i) => [c, vals[i]])));
  }
  if (!columns) throw new Error("forceCoeffs: no column header (# Time ...)");
  if (!columns.includes("Cd")) throw new Error("forceCoeffs: no Cd column");
  for (const k of ["magUInf", "lRef", "Aref"]) {
    if (!(header[k] > 0)) throw new Error(`forceCoeffs: header ${k} missing or not positive`);
  }
  for (let i = 1; i < rows.length; i++) {
    if (!(rows[i].Time > rows[i - 1].Time)) throw new Error(`forceCoeffs: Time not increasing at row ${i}`);
  }
  return { header, columns, rows };
}

/** Mean, standard deviation and half-window drift of column `key` over the last `window` rows. */
export function tailStatistics(rows, key = "Cd", window = CONVERGENCE_LIMITS.window) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("tailStatistics: no rows");
  if (!Number.isInteger(window) || window < 4) throw new Error("tailStatistics: window must be an integer >= 4");
  if (rows.length < window) throw new Error(`tailStatistics: ${rows.length} rows, window needs ${window}`);
  const xs = rows.slice(-window).map((r) => r[key]);
  if (xs.some((v) => !Number.isFinite(v))) throw new Error(`tailStatistics: column ${key} missing or not finite`);
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const m = mean(xs);
  const sd = Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / xs.length);
  const half = Math.floor(window / 2);
  const m1 = mean(xs.slice(0, half)), m2 = mean(xs.slice(half));
  const scale = Math.abs(m);
  return {
    key, window, mean: m, sd, firstHalfMean: m1, secondHalfMean: m2,
    relSd: scale > 0 ? sd / scale : Infinity,
    relDrift: scale > 0 ? Math.abs(m2 - m1) / scale : Infinity,
    fromTime: rows.at(-window).Time, toTime: rows.at(-1).Time,
  };
}

/** { settled, reasons } against CONVERGENCE_LIMITS (or the given limits). */
export function convergenceVerdict(stats, limits = CONVERGENCE_LIMITS) {
  const reasons = [];
  if (!(stats.relSd <= limits.maxRelSd)) reasons.push(`sd/mean ${(stats.relSd * 100).toFixed(2)} % > ${limits.maxRelSd * 100} %`);
  if (!(stats.relDrift <= limits.maxRelDrift)) reasons.push(`half-window drift ${(stats.relDrift * 100).toFixed(2)} % > ${limits.maxRelDrift * 100} %`);
  return { settled: reasons.length === 0, reasons };
}

/** Parse snappyHexMesh's layer table + final cell count from a log excerpt. */
export function parseSnappySummary(text) {
  const layers = {};
  const re = /^(\S+)\s+(\d+)\s+([\d.]+)\s+([\d.eE+-]+)\s+([\d.]+)\s*$/;
  let inTable = false;
  for (const line of String(text).split(/\r?\n/)) {
    if (/overall thickness/.test(line)) { inTable = true; continue; }
    if (inTable) {
      const m = line.match(re);
      if (m) layers[m[1]] = { faces: Number(m[2]), layers: Number(m[3]), thicknessM: Number(m[4]), coveragePct: Number(m[5]) };
    }
  }
  const cells = String(text).match(/Layer mesh : cells:(\d+)/);
  const build = String(text).match(/Build\s*:\s*(\S+)/);
  return { cells: cells ? Number(cells[1]) : null, layers, openfoamBuild: build ? build[1] : null };
}

// ---------------------------------------------------------------------------------------------
// Transient (DES) runs: time-window statistics.
//
// A scale-resolving run has no iteration tail to average: the force is a stationary random
// process after the start-up transient. The reported value is the mean over a stated time window
// (after `discardTime`), and its uncertainty must account for autocorrelation, or sd/sqrt(n)
// understates it by sqrt(2 * T_int / dt).
//
// Method: non-overlapping BATCH MEANS (Conway 1963, Management Science 10(1); batch-count advice
// in Schmeiser 1982, Operations Research 30(3): few batches, no more than ~30). The window is cut
// into BATCHES equal batches; if each batch is long compared with the integral time scale, the
// batch means are close to independent, and the standard error of the grand mean is
// sd(batch means) / sqrt(BATCHES), with a Student-t interval on BATCHES-1 degrees of freedom.
// (Cited from memory of those papers, not re-read here.)
// All limits below are choices, not a published standard.
// ---------------------------------------------------------------------------------------------

export const TRANSIENT_LIMITS = Object.freeze({
  batches: 20,
  tCrit95Batches: 2.093, // Student t, 0.975 quantile, 19 d.f. (BATCHES - 1)
  tCrit95Halves: 2.262, // 0.975 quantile, 9 d.f. (each half holds BATCHES/2 = 10 batch means)
  maxRelCi: 0.02,
  maxBatchLag1: 0.5,
  minSamplesPerBatch: 10,
  basis: "choices: 20 batches; 95 % Student-t intervals; the mean must be known to +/-2 % (95 % half-width / |mean|); the two halves of the window must agree within the 95 % interval of their difference; the lag-1 autocorrelation of the batch means must be <= 0.5, else the window is too short for the integral time scale",
});

/**
 * Mean, sd and an autocorrelation-aware uncertainty of column `key` over the time window
 * [t0 + discardTime, t0 + discardTime + windowTime], t0 = the first row's Time.
 * The series must be uniformly spaced (fixed time step) and cover the whole window; otherwise it throws.
 */
export function timeWindowStatistics(rows, key = "Cd", { discardTime, windowTime } = {}, limits = TRANSIENT_LIMITS) {
  if (!Array.isArray(rows) || rows.length < 2) throw new Error("timeWindowStatistics: need at least 2 rows");
  if (!(Number.isFinite(discardTime) && discardTime >= 0)) throw new Error("timeWindowStatistics: discardTime must be a finite number >= 0");
  if (!(Number.isFinite(windowTime) && windowTime > 0)) throw new Error("timeWindowStatistics: windowTime must be a finite number > 0");
  const t0 = rows[0].Time;
  const dt = (rows.at(-1).Time - t0) / (rows.length - 1);
  for (let i = 1; i < rows.length; i++) {
    if (Math.abs(rows[i].Time - rows[i - 1].Time - dt) > 1e-6 * dt + 1e-12) {
      throw new Error(`timeWindowStatistics: time step is not uniform at row ${i} (${rows[i].Time - rows[i - 1].Time} vs ${dt}); fixed-dt runs only`);
    }
  }
  // The series is uniform, so the window is an index range: `discardTime/dt` samples skipped, then
  // `windowTime/dt` samples (rounded to whole steps). Row 0 is the first sample written (t0).
  const skip = Math.round(discardTime / dt), n = Math.round(windowTime / dt);
  if (rows.length < skip + n) throw new Error(`timeWindowStatistics: the run has ${rows.length} samples (to t=${rows.at(-1).Time}), the window needs ${skip + n} (to t=${(t0 + (skip + n - 1) * dt).toPrecision(8)})`);
  const win = rows.slice(skip, skip + n);
  const from = win[0].Time, to = win.at(-1).Time;
  const xs = win.map((r) => r[key]);
  if (xs.some((v) => !Number.isFinite(v))) throw new Error(`timeWindowStatistics: column ${key} missing or not finite`);
  const K = limits.batches;
  const per = Math.floor(xs.length / K);
  if (per < limits.minSamplesPerBatch) throw new Error(`timeWindowStatistics: ${xs.length} samples in the window, ${K} batches need >= ${limits.minSamplesPerBatch} each`);
  const used = xs.slice(xs.length - per * K); // drop the oldest remainder so batches are equal
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const sdOf = (a, m, ddof) => Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - ddof));
  const m = mean(used);
  const sd = sdOf(used, m, 1);
  const bm = Array.from({ length: K }, (_, b) => mean(used.slice(b * per, (b + 1) * per)));
  const sB = sdOf(bm, mean(bm), 1);
  const seMean = sB / Math.sqrt(K);
  const ci95 = limits.tCrit95Batches * seMean;
  const bMean = mean(bm);
  let num = 0, den = 0;
  for (let b = 0; b < K; b++) { den += (bm[b] - bMean) ** 2; if (b) num += (bm[b] - bMean) * (bm[b - 1] - bMean); }
  const lag1 = den > K * (1e-12 * Math.abs(bMean)) ** 2 ? num / den : 0; // no spread between batches: nothing to correlate
  const h = K / 2;
  const h1 = bm.slice(0, h), h2 = bm.slice(h);
  const m1 = mean(h1), m2 = mean(h2);
  const halfDiffSe = Math.sqrt(sdOf(h1, m1, 1) ** 2 / h + sdOf(h2, m2, 1) ** 2 / h);
  const var_mean = seMean ** 2;
  return {
    key, mean: m, sd, samples: used.length, dt, fromTime: from, toTime: to, batches: K, batchSamples: per,
    seMean, ci95HalfWidth: ci95, relCi95: Math.abs(m) > 0 ? ci95 / Math.abs(m) : Infinity,
    // sd^2 / Var(mean): how many independent samples the window is worth
    effectiveSamples: var_mean > 0 ? sd ** 2 / var_mean : Infinity,
    // Var(mean) = 2 T_int sd^2 / T_window for a window much longer than T_int
    integralTimeScale: sd > 0 ? (var_mean * used.length * dt) / (2 * sd ** 2) : 0,
    naiveSeMean: sd / Math.sqrt(used.length),
    firstHalfMean: m1, secondHalfMean: m2, halfDiff: m2 - m1, halfDiffSe,
    relDrift: Math.abs(m) > 0 ? Math.abs(m2 - m1) / Math.abs(m) : Infinity,
    batchLag1: lag1,
  };
}

/** { settled, reasons } for timeWindowStatistics output against TRANSIENT_LIMITS (or the given limits). */
export function timeWindowVerdict(stats, limits = TRANSIENT_LIMITS) {
  const reasons = [];
  const floor = 1e-9 * Math.abs(stats.mean); // rounding noise only, so an exactly flat series is not failed by 1e-16 vs 0
  if (!(Math.abs(stats.halfDiff) <= limits.tCrit95Halves * stats.halfDiffSe + floor)) {
    reasons.push(`the two window halves differ by ${stats.halfDiff.toPrecision(3)}, more than the 95 % interval of the difference (${(limits.tCrit95Halves * stats.halfDiffSe).toPrecision(3)}): the mean is still moving`);
  }
  if (!(stats.relCi95 <= limits.maxRelCi)) reasons.push(`95 % interval of the mean is ${(stats.relCi95 * 100).toFixed(2)} % of the mean, limit ${limits.maxRelCi * 100} %`);
  if (!(Math.abs(stats.batchLag1) <= limits.maxBatchLag1)) reasons.push(`batch means are correlated (lag-1 ${stats.batchLag1.toFixed(2)} > ${limits.maxBatchLag1}): the window is too short for the integral time scale`);
  return { settled: reasons.length === 0, reasons };
}
