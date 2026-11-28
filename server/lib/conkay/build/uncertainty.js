// server/lib/conkay/build/uncertainty.js
//
// A margin with its scatter (owner, 2026-11-28: "actual CERN-level physics";
// a lab trusts a number only with its uncertainty). Real parts are not the
// nominal design: strength varies from batch to batch, loads are not exactly
// what was written, and sizes are cut within a tolerance. propagate() samples
// those inputs, runs EVERY solver on each sample, and reports per check the
// spread of its utilization (demand / capacity) and the probability it is not
// met, with the statistical confidence of that estimate.
//
//   await propagate(ir, { samples = 1000, seed = 1, loadCoV = 0.10, dimensionCoV = 0.01,
//                   scatter: { <materialId>: { strength, stiffness, density, source } },
//                   withoutSafetyFactors = false })
//
// Inputs and how they vary (stated in the receipt, every one):
//   - material strength, stiffness, density: lognormal about the library value,
//     one draw per material per sample (one batch for the whole build). Default
//     coefficients of variation by category, from the JCSS Probabilistic Model
//     Code (steel 3.02, timber 3.05) and Weibull statistics for ceramics; a
//     category with no sourced default (polymers, composites, design-defined
//     materials) is NOT varied unless the person gives its scatter — said in
//     the warnings, never guessed.
//   - loads (forces, spread loads, carried masses): lognormal, CoV loadCoV
//     (an assumption unless the person states the load's scatter).
//   - cross-section sizes (not spans): lognormal, CoV dimensionCoV.
// The library value is taken as the MEAN. For a material whose library value
// is a specified minimum (most steel grades) the real mean is higher, so the
// probabilities here are then on the safe side; said in the receipt.
//
// Statistics: probability of failure p̂ = k/N with a Wilson 95 % interval;
// when no sample fails the upper bound is the exact one-sided 95 % bound
// 1 − 0.05^(1/N) (≈ 3/N, "the rule of three"). Monte Carlo with N samples can
// say nothing finer than that — to show a smaller probability, run more.

import { listParameters, applyEdits } from "./edit.js";
import { checkPlan } from "./planner.js";
import { DesignGraph } from "../graph/design-graph.js";
import { DesignEngine } from "../graph/engine.js";
import { parseAmount } from "../units/universal.js";

const IGNORE = new Set(["cad.solid-check"]);
const MAX_SAMPLES = 5000;

// Coefficients of variation by material category, with where they come from.
export const DEFAULT_SCATTER = Object.freeze({
  metal: { strength: 0.07, stiffness: 0.03, density: 0.01, source: "JCSS Probabilistic Model Code Part 3.02 (structural steel: fy CoV 0.07, E 0.03); applied to every metal" },
  fastener: { strength: 0.07, stiffness: 0.03, density: 0.01, source: "JCSS Probabilistic Model Code Part 3.02 (structural steel), applied to bolt grades" },
  wood: { strength: 0.25, stiffness: 0.13, density: 0.10, source: "JCSS Probabilistic Model Code Part 3.05 (timber: bending strength CoV 0.25, E 0.13, density 0.10)" },
  ceramic: { strength: 0.12, stiffness: 0.03, density: 0.01, source: "Weibull modulus m ≈ 10 for engineering ceramics (Ashby & Jones, Engineering Materials 1, ch. 18) → strength CoV ≈ 0.12; stiffness, density assumed 0.03, 0.01" },
});

// ---- deterministic random numbers (mulberry32 + Box–Muller) ----
function rng(seed) {
  let a = (Number(seed) >>> 0) || 1;
  const u = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return () => { let x = 0; while (x === 0) x = u(); return Math.sqrt(-2 * Math.log(x)) * Math.cos(2 * Math.PI * u()); };
}
/** Lognormal multiplier with mean 1 and the given coefficient of variation. */
const lognormal = (z, cov) => { if (!(cov > 0)) return 1; const s2 = Math.log(1 + cov * cov); return Math.exp(-s2 / 2 + Math.sqrt(s2) * z); };

function wilson(k, n) {
  const z = 1.959964, p = k / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d, h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}
const quantile = (sorted, q) => { if (!sorted.length) return NaN; const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo); };
const sig = (n) => Number(Number(n).toPrecision(4));

/** Run every solver on an IR, with material properties scaled per material. */
function runOnce(ir, materialScale) {
  const ready = checkPlan(ir);
  if (!ready.ok) return { ok: false, errors: ready.errors };
  const built = DesignGraph.fromIR(ready.ir);
  if (!built.ok) return { ok: false, errors: built.errors };
  const g = built.graph;
  if (materialScale) {
    const base = g.materialOf.bind(g);
    g.materialOf = (id) => {
      const m = base(id);
      const s = m && materialScale[m.id];
      if (!s) return m;
      const mul = (v, f) => (v == null ? v : v * f);
      return { ...m, yieldPa: mul(m.yieldPa, s.strength), ultimatePa: mul(m.ultimatePa, s.strength), allowableStressPa: mul(m.allowableStressPa, s.strength), youngsModulusPa: mul(m.youngsModulusPa, s.stiffness), densityKgM3: mul(m.densityKgM3, s.density) };
    };
  }
  const engine = new DesignEngine(g);
  engine.runAll();
  const checks = [];
  for (const e of engine.results().filter((x) => !IGNORE.has(x.solver?.id))) {
    for (const m of e.margins || []) {
      const cap = Number(m.capacity), dem = Number(m.demand);
      checks.push({ key: `${e.solver.id}|${e.target}|${m.check}`, solver: e.solver.id, target: e.target, check: m.check, basis: m.basis || null, utilization: cap > 0 ? dem / cap : Infinity, met: dem <= cap });
    }
  }
  return { ok: true, checks, materials: g };
}

export async function propagate(ir, opts = {}) {
  const N = Math.round(Number(opts.samples ?? 1000));
  if (!(N >= 20 && N <= MAX_SAMPLES)) return { ok: false, error: `samples: between 20 and ${MAX_SAMPLES}` };
  const loadCoV = Number(opts.loadCoV ?? 0.10), dimensionCoV = Number(opts.dimensionCoV ?? 0.01);
  if (!(loadCoV >= 0 && loadCoV <= 1) || !(dimensionCoV >= 0 && dimensionCoV <= 0.5)) return { ok: false, error: "loadCoV between 0 and 1, dimensionCoV between 0 and 0.5" };
  const stated = opts.scatter && typeof opts.scatter === "object" ? opts.scatter : {};
  const warnings = [];

  let base = ir;
  const params = listParameters(ir);
  const safety = params.filter((p) => p.path[p.path.length - 2] === "factorOfSafety");
  if (opts.withoutSafetyFactors) {
    if (!safety.length) return { ok: false, error: "this build states no safety factor to remove" };
    const ed = applyEdits(ir, safety.map((p) => ({ id: p.id, value: 1 })));
    if (!ed.ok) return { ok: false, error: "compile", errors: ed.errors };
    base = ed.ir;
  }

  const nominal = runOnce(base);
  if (!nominal.ok) return { ok: false, error: "compile", errors: nominal.errors };

  // which materials, and how each varies
  const used = new Map();
  for (const n of base.nodes || []) {
    if (typeof n.material !== "string" || !n.geometry) continue;
    const m = nominal.materials.materialOf(n.id);
    if (m && !used.has(m.id)) used.set(m.id, m);
  }
  const materialVar = [];
  for (const [id, m] of used) {
    const s = stated[id];
    if (s) {
      const bad = ["strength", "stiffness", "density"].find((k) => s[k] != null && !(Number(s[k]) >= 0 && Number(s[k]) <= 1));
      if (bad) return { ok: false, error: `scatter.${id}.${bad}: a coefficient of variation between 0 and 1` };
      materialVar.push({ id, label: m.label || id, strength: Number(s.strength ?? 0), stiffness: Number(s.stiffness ?? 0), density: Number(s.density ?? 0), source: String(s.source || "stated by the person").slice(0, 300) });
    } else if (DEFAULT_SCATTER[m.category]) {
      materialVar.push({ id, label: m.label || id, ...DEFAULT_SCATTER[m.category] });
    } else {
      warnings.push(`${m.label || id}: not varied — no sourced scatter for a ${m.category || "design-defined"} material; give its coefficients of variation (strength, stiffness, density) to include it`);
    }
  }
  const LOAD_DIMS = new Set(["force", "force_per_length", "mass"]);
  const loadVar = params.filter((p) => LOAD_DIMS.has(p.dim) && p.path[0] === "props");
  const dimVar = params.filter((p) => p.dim === "length" && p.path[0] === "geometry" && p.path[p.path.length - 1] !== "length" && !p.path.includes("sections"));
  const SI = { force: "N", force_per_length: "N/m", mass: "kg", length: "m" };
  const nominalSI = new Map([...loadVar, ...dimVar].map((p) => { const r = parseAmount(p.value, { expectDim: p.dim }); return [p.id, r.ok ? r.si : NaN]; }));
  for (const p of [...loadVar, ...dimVar]) if (!Number.isFinite(nominalSI.get(p.id))) return { ok: false, error: `${p.nodeName} ${p.label}: "${p.value}" could not be read` };

  // inputs, one standard-normal draw each, logged for the sensitivity
  const inputs = [
    ...materialVar.flatMap((m) => ["strength", "stiffness", "density"].filter((k) => m[k] > 0).map((k) => ({ kind: "material", id: `${m.id}:${k}`, label: `${m.label} ${k}`, cov: m[k], m, k }))),
    ...(loadCoV > 0 ? loadVar.map((p) => ({ kind: "param", id: p.id, label: `${p.nodeName} ${p.label}`, cov: loadCoV, p })) : []),
    ...(dimensionCoV > 0 ? dimVar.map((p) => ({ kind: "param", id: p.id, label: `${p.nodeName} ${p.label}`, cov: dimensionCoV, p })) : []),
  ];
  if (!inputs.length) return { ok: false, error: "nothing to vary", warnings };

  const gauss = rng(opts.seed ?? 1);
  const per = new Map(nominal.checks.map((c) => [c.key, { ...c, nominal: c.utilization, u: [], fails: 0 }]));
  const draws = inputs.map(() => []);
  let anyFail = 0, errored = 0;
  for (let s = 0; s < N; s++) {
    if (s % 25 === 24) await new Promise((r) => { setImmediate(r); }); // a long run must not hold the event loop
    const z = inputs.map(() => gauss());
    z.forEach((v, i) => draws[i].push(v));
    const scale = {};
    const edits = [];
    inputs.forEach((inp, i) => {
      const f = lognormal(z[i], inp.cov);
      if (inp.kind === "material") { (scale[inp.m.id] ||= { strength: 1, stiffness: 1, density: 1 })[inp.k] = f; }
      else edits.push({ id: inp.p.id, value: `${nominalSI.get(inp.p.id) * f} ${SI[inp.p.dim]}` });
    });
    let sampleIr = base;
    if (edits.length) { const ed = applyEdits(base, edits); if (!ed.ok) { errored++; continue; } sampleIr = ed.ir; }
    const r = runOnce(sampleIr, scale);
    if (!r.ok) { errored++; continue; }
    let failed = false;
    const seen = new Set();
    for (const c of r.checks) {
      const q = per.get(c.key); if (!q) continue;
      seen.add(c.key);
      q.u.push(c.utilization); if (!c.met) { q.fails++; failed = true; }
    }
    // a check that disappears on a sample (not computed) is counted as not met there
    for (const [k, q] of per) if (!seen.has(k)) { q.u.push(Infinity); q.fails++; failed = true; }
    if (failed) anyFail++;
  }
  const ran = N - errored;
  if (ran < 20) return { ok: false, error: "too many samples could not be evaluated", errored };

  const prob = (k) => (k === 0 ? { p: 0, low: 0, high: 1 - 0.05 ** (1 / ran), zeroFailures: true } : (() => { const [lo, hi] = wilson(k, ran); return { p: k / ran, low: lo, high: hi }; })());
  const checks = [...per.values()].map((q) => {
    const sorted = q.u.slice().sort((a, b) => a - b);
    // which input moves this check most: correlation of its utilization with each input draw (finite samples only)
    let driver = null;
    const finite = q.u.map((u, i) => [u, i]).filter(([u]) => Number.isFinite(u));
    if (finite.length > 10) {
      const um = finite.reduce((s, [u]) => s + u, 0) / finite.length;
      const su = Math.sqrt(finite.reduce((s, [u]) => s + (u - um) ** 2, 0));
      let best = 0;
      inputs.forEach((inp, j) => {
        const d = finite.map(([, i]) => draws[j][i]);
        const dm = d.reduce((a, b) => a + b, 0) / d.length;
        const sd = Math.sqrt(d.reduce((a, b) => a + (b - dm) ** 2, 0));
        if (!(su > 0) || !(sd > 0)) return;
        const r = finite.reduce((a, [u], k) => a + (u - um) * (d[k] - dm), 0) / (su * sd);
        if (Math.abs(r) > Math.abs(best)) { best = r; driver = { input: inp.label, correlation: sig(r) }; }
      });
    }
    return {
      solver: q.solver, target: q.target, check: q.check, basis: q.basis,
      nominalUtilization: sig(q.nominal),
      utilization: { p05: sig(quantile(sorted, 0.05)), p50: sig(quantile(sorted, 0.5)), p95: sig(quantile(sorted, 0.95)) },
      failures: q.fails, probabilityNotMet: prob(q.fails), driver,
    };
  }).sort((a, b) => b.probabilityNotMet.p - a.probabilityNotMet.p || b.utilization.p95 - a.utilization.p95);

  return {
    ok: true, samples: ran, seed: opts.seed ?? 1, errored,
    mode: opts.withoutSafetyFactors ? `safety factors set to 1 (${safety.map((p) => `${p.nodeName}`).join(", ")}): the probability a part actually fails` : "checks as written (safety factors kept): the probability a check is not met",
    probabilityAnyNotMet: prob(anyFail),
    checks,
    inputs: inputs.map((i) => ({ input: i.label, cov: i.cov, distribution: "lognormal, mean = nominal", source: i.kind === "material" ? i.m.source : (i.p.dim === "length" ? (opts.dimensionCoV != null ? "stated by the person" : "assumed manufacturing tolerance (CoV 0.01)") : (opts.loadCoV != null ? "stated by the person" : "assumed load scatter (CoV 0.10) — state your load's scatter")) })),
    warnings,
    method: `Monte Carlo, ${ran} samples (seeded, so it repeats exactly); every solver re-run on each sample; one draw per material per sample; p̂ = failures / samples with a Wilson 95 % interval, or 0 to 1 − 0.05^(1/N) when none fail`,
    assumption: "library values taken as the mean (for specified-minimum grades the true mean is higher, so these probabilities are on the safe side); inputs independent of each other; spans not varied",
  };
}
