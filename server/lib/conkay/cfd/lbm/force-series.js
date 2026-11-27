// server/lib/conkay/cfd/lbm/force-series.js
//
// Reads the force time series that aero_lbm.cpp writes (forces.dat) and reduces a window of it to a
// mean with a settled check. Pure functions.
//
// An LES force series does not settle to a constant: the wake keeps it fluctuating, and that
// fluctuation is physical. So the settled check here is not a limit on sd/mean (aero.cfd's RANS limit)
// but on the quality of the MEAN: (1) the two halves of the window agree (no drift), and (2) the
// standard error of the mean, from block means of one flow-through each, is small. Both limits are
// choices (LBM_LIMITS), set before the Ahmed run was looked at; they are not a published standard.

export const LBM_SERIES_VERSION = "1.0.0";

export const LBM_LIMITS = Object.freeze({
  windowFlowThroughs: 24,
  blockFlowThroughs: 1,
  maxRelDrift: 0.01,
  maxRelSem: 0.01,
  minBlocks: 8,
  basis: "choice, fixed before the Ahmed run: average the last 24 flow-throughs (L/U) of a 36-flow-through run; first and second half within 1 %; standard error of the mean from 1-flow-through block means within 1 %; at least 8 blocks. Not a published standard",
});

const KV = /([A-Za-z_][A-Za-z0-9_]*)=([^\s]+)/g;

/**
 * Parse forces.dat. Returns { header, columns, rows, done, diverged } where header collects every key=value
 * token from the '#' lines (numbers as numbers), columns come from the '# step t_s ...' line and rows are objects.
 * Throws on malformed input.
 */
export function parseLbmForces(text) {
  if (typeof text !== "string" || !text.trim()) throw new Error("lbm forces: empty input");
  const header = {};
  let columns = null;
  let done = false, diverged = false;
  const rows = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      const body = line.replace(/^#\s*/, "");
      if (/^step\s+t_s\b/.test(body)) { columns = body.split(/\s+/); continue; }
      if (/^done\b/.test(body)) { done = true; continue; }
      if (/^DIVERGED\b/.test(body)) { diverged = true; continue; }
      // the Aref line ends in prose with an unquoted formula; keep only the tokens before it
      for (const m of body.replace(/\bCd=Fx\/\(.*$/, "").matchAll(KV)) {
        const v = Number(m[2]);
        if (!(m[1] in header)) header[m[1]] = Number.isFinite(v) && /^[-+0-9.eE]+$/.test(m[2]) ? v : m[2];
      }
      continue;
    }
    if (!columns) throw new Error("lbm forces: data before the column header");
    const vals = line.split(/\s+/).map(Number);
    if (vals.length !== columns.length) throw new Error(`lbm forces: row has ${vals.length} values, header has ${columns.length} columns`);
    if (vals.some((v) => !Number.isFinite(v))) throw new Error(`lbm forces: non-finite value in row "${line.slice(0, 60)}"`);
    rows.push(Object.fromEntries(columns.map((c, i) => [c, vals[i]])));
  }
  if (!columns) throw new Error("lbm forces: no column header (# step t_s ...)");
  for (const c of ["step", "t_s", "Cd", "Cl"]) if (!columns.includes(c)) throw new Error(`lbm forces: no ${c} column`);
  for (const k of ["lref", "ftt_s", "Aref", "qinf", "dt"]) {
    if (!(header[k] > 0)) throw new Error(`lbm forces: header ${k} missing or not positive`);
  }
  for (let i = 1; i < rows.length; i++) {
    if (!(rows[i].step > rows[i - 1].step)) throw new Error(`lbm forces: step not increasing at row ${i}`);
  }
  return { header, columns, rows, done, diverged };
}

const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;

/**
 * Statistics of column `key` over the window [fromT, toT] (seconds) of a parsed series. Default window: the last
 * LBM_LIMITS.windowFlowThroughs flow-throughs. Needs the window to fit inside the series and to hold at least
 * minBlocks whole blocks.
 */
export function windowStatistics(series, key = "Cd", { limits = LBM_LIMITS, fromT, toT } = {}) {
  const { rows, header } = series;
  if (!rows.length) throw new Error("windowStatistics: no rows");
  if (!(key in rows[0])) throw new Error(`windowStatistics: column ${key} not in the series`);
  const ftt = header.ftt_s;
  const t1 = toT ?? rows.at(-1).t_s;
  const t0 = fromT ?? t1 - limits.windowFlowThroughs * ftt;
  if (!(t1 > t0)) throw new Error("windowStatistics: empty window");
  if (t0 < rows[0].t_s - 1e-12) throw new Error(`windowStatistics: the series starts at ${rows[0].t_s} s, the window needs ${t0.toFixed(4)} s`);
  const w = rows.filter((r) => r.t_s > t0 + 1e-12 && r.t_s <= t1 + 1e-12);
  if (w.length < 8) throw new Error(`windowStatistics: only ${w.length} samples in the window`);
  const xs = w.map((r) => r[key]);
  const m = mean(xs);
  const sd = Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / xs.length);
  const half = Math.floor(xs.length / 2);
  const m1 = mean(xs.slice(0, half)), m2 = mean(xs.slice(xs.length - half));
  // block means of blockFlowThroughs flow-throughs each, from the window start
  const blockT = limits.blockFlowThroughs * ftt;
  const nBlocks = Math.floor((t1 - t0) / blockT + 1e-9);
  const blocks = [];
  for (let b = 0; b < nBlocks; b++) {
    const lo = t0 + b * blockT, hi = lo + blockT;
    const inB = w.filter((r) => r.t_s > lo + 1e-12 && r.t_s <= hi + 1e-12).map((r) => r[key]);
    if (inB.length) blocks.push(mean(inB));
  }
  const bm = blocks.length ? mean(blocks) : NaN;
  const bsd = blocks.length > 1 ? Math.sqrt(blocks.reduce((s, v) => s + (v - bm) ** 2, 0) / (blocks.length - 1)) : NaN;
  const sem = blocks.length > 1 ? bsd / Math.sqrt(blocks.length) : NaN;
  const scale = Math.abs(m);
  return {
    key, mean: m, sd, samples: w.length, fromT: t0, toT: t1, flowThroughs: (t1 - t0) / ftt,
    firstHalfMean: m1, secondHalfMean: m2, relDrift: scale > 0 ? Math.abs(m2 - m1) / scale : Infinity,
    blocks: blocks.length, sem, relSem: scale > 0 ? sem / scale : Infinity,
  };
}

/** { settled, reasons } against LBM_LIMITS (or the given limits). */
export function lbmVerdict(stats, limits = LBM_LIMITS) {
  const reasons = [];
  if (!(stats.blocks >= limits.minBlocks)) reasons.push(`${stats.blocks} blocks, need at least ${limits.minBlocks}`);
  if (!(stats.relDrift <= limits.maxRelDrift)) reasons.push(`half-window drift ${(stats.relDrift * 100).toFixed(2)} % > ${limits.maxRelDrift * 100} %`);
  if (!(stats.relSem <= limits.maxRelSem)) reasons.push(`standard error of the mean ${(stats.relSem * 100).toFixed(2)} % > ${limits.maxRelSem * 100} %`);
  return { settled: reasons.length === 0, reasons };
}

/** Mean of `key` in consecutive blocks of `blockT` seconds over the whole series, as [{ to, mean }] (for a history plot). */
export function blockHistory(series, key = "Cd", blockFlowThroughs = 2) {
  const blockT = blockFlowThroughs * series.header.ftt_s;
  const out = [];
  let lo = 0;
  while (lo + blockT <= series.rows.at(-1).t_s + 1e-9) {
    const b = series.rows.filter((r) => r.t_s > lo + 1e-12 && r.t_s <= lo + blockT + 1e-12);
    if (b.length) out.push({ to: lo + blockT, mean: mean(b.map((r) => r[key])) });
    lo += blockT;
  }
  return out;
}

export const COMPONENT_COLUMNS = Object.freeze({ nose: "Fx_nose", slant: "Fx_slant", base: "Fx_base", rest: "Fx_rest" });

/**
 * Window means of the per-region x-force as drag-coefficient contributions (Fx / (qinf Aref)), for runs made with
 * --regions=ahmed. A region is a group of the body's wall voxels (nose x < 0.1 m; slant; base; rest = everything
 * else), so each is the total force (pressure and friction) on it; edge voxels within 1.5 cells of a region's
 * boundary go to the next region by rule, not by surface patch.
 */
export function componentMeans(series, opts = {}) {
  const scale = series.header.qinf * series.header.Aref;
  const out = {};
  for (const [name, col] of Object.entries(COMPONENT_COLUMNS)) {
    if (!(col in series.rows[0])) continue;
    const derived = { ...series, rows: series.rows.map((r) => ({ ...r, [name]: r[col] / scale })) };
    const s = windowStatistics(derived, name, opts);
    out[name] = { mean: s.mean, sem: s.sem };
  }
  return out;
}
