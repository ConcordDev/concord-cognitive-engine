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

export const FORCE_COEFFS_VERSION = "1.0.0";

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
