// server/lib/conkay/build/size.js
//
// Design by the math (owner, 2026-11-27: "the LLM is just the organizer").
// The organizer (the person, or Kay) says WHAT may change and within what
// bounds; the solvers decide HOW MUCH. sizeBuild finds the lightest design
// in those bounds on which every check passes, and every number in it comes
// from a solver run — none from the model.
//
//   variables: [{ id (a parameter id from listParameters), min, max (any units) } |
//               { id, stock: ["1/2 in", "5/8 in", "3/4 in", ...] }]   (sizes you can buy)
//   objective: "mass" (default)
//
// Method (deterministic, stated in the receipt; step 3 added after a browser run
// showed descent alone stops short on a tube: OD up + wall down is lighter):
//   1. feasibility — if the design fails, every variable grows together
//      (geometrically toward its max) and the smallest common step that
//      passes is found by bisection; if even the maxima fail, it stops and
//      lists the checks that still fail there (the bounds are the problem);
//   2. descent — each variable in turn is bisected down toward its min to the
//      smallest value that still passes (stock: the smallest stock size that
//      passes), kept only if the mass falls; rounds repeat until nothing moves.
// Assumption, said in the receipt: a larger section never makes a check
// worse (true for stress, deflection, buckling and mass-capacity checks of
// members; not for every possible check — the final design is re-checked
// in full either way, so a violated assumption shows as a non-optimum, never
// as a hidden failure).

import { listParameters, applyEdits } from "./edit.js";
import { checkPlan } from "./planner.js";
import { openDesign } from "../index.js";
import { parseAmount, convertFromSI } from "../units/universal.js";

const IGNORE = new Set(["cad.solid-check"]); // verification of the geometry, not a design requirement
const BISECT_STEPS = 22;                      // 2^-22 of a log-span: < 1e-6 relative
const MAX_ROUNDS = 6;
const MAX_EVALUATIONS = 4000;                  // a bound on work, reported in the receipt

/** Run every solver on an IR (no kernels): { ok, feasible, mass, failing, worst, envelopes }. */
export function evaluate(ir) {
  const ready = checkPlan(ir);
  if (!ready.ok) return { ok: false, errors: ready.errors };
  const o = openDesign(ready.ir);
  if (!o.ok) return { ok: false, errors: o.errors };
  const env = o.session.results().filter((e) => !IGNORE.has(e.solver?.id));
  const failing = []; const checks = [];
  let worst = 0;
  for (const e of env) {
    for (const m of e.margins || []) {
      const u = Number(m.capacity) > 0 ? Number(m.demand) / Number(m.capacity) : Infinity;
      worst = Math.max(worst, u);
      checks.push({ solver: e.solver.id, target: e.target, check: m.check, utilization: u });
      if (!(Number(m.demand) <= Number(m.capacity))) failing.push({ solver: e.solver.id, target: e.target, check: m.check, utilization: u });
    }
    if (e.status === "FAIL" && !(e.margins || []).some((m) => !(Number(m.demand) <= Number(m.capacity)))) failing.push({ solver: e.solver.id, target: e.target, check: (e.warnings || []).join("; ") || "failed", utilization: Infinity });
  }
  const mass = env.filter((e) => e.solver?.id === "mass.part" && Number.isFinite(e.outputs?.mass?.value)).reduce((s, e) => s + e.outputs.mass.value, 0);
  return { ok: true, feasible: failing.length === 0, mass, failing, worst, checks };
}

const sig = (n) => Number(Number(n).toPrecision(6));
/** Write an SI value back in the unit the parameter was written in. */
function inUnitOf(original, si, dim) {
  const r = parseAmount(original, { expectDim: dim });
  const unit = r.ok && r.unit && !/^(?:m|1)$/.test(r.unit) ? r.unit : (dim === "length" ? "mm" : r.unit || "");
  try { return `${sig(convertFromSI(si, unit))} ${unit}`.trim(); } catch { return `${sig(si)}`; }
}

export function sizeBuild(ir, { variables = [], objective = "mass" } = {}) {
  if (objective !== "mass") return { ok: false, error: `objective "${objective}" is not supported yet (mass)` };
  const params = new Map(listParameters(ir).map((p) => [p.id, p]));
  const vars = [];
  const errors = [];
  for (const v of variables) {
    const p = params.get(String(v?.id));
    if (!p) { errors.push(`"${v?.id}" is not a value on this build`); continue; }
    if (p.dim !== "length") { errors.push(`${p.nodeName} ${p.label}: only sizes (lengths) can be sized for now`); continue; }
    const cur = parseAmount(p.value, { expectDim: "length" });
    if (!cur.ok || !(cur.si > 0)) { errors.push(`${p.nodeName} ${p.label}: current value "${p.value}" is not a positive length`); continue; }
    if (Array.isArray(v.stock) && v.stock.length) {
      const stock = v.stock.map((s) => ({ text: String(s), r: parseAmount(s, { expectDim: "length" }) }));
      const bad = stock.find((s) => !s.r.ok || !(s.r.si > 0));
      if (bad) { errors.push(`${p.nodeName} ${p.label}: stock size "${bad.text}" is not a positive length`); continue; }
      stock.sort((a, b) => a.r.si - b.r.si);
      vars.push({ p, cur: cur.si, stock });
    } else {
      const lo = parseAmount(v.min, { expectDim: "length" }), hi = parseAmount(v.max, { expectDim: "length" });
      if (!lo.ok || !hi.ok || !(lo.si > 0) || !(hi.si >= lo.si)) { errors.push(`${p.nodeName} ${p.label}: give min and max as positive lengths (min ≤ max), or a stock list`); continue; }
      vars.push({ p, cur: Math.min(hi.si, Math.max(lo.si, cur.si)), lo: lo.si, hi: hi.si });
    }
  }
  if (errors.length) return { ok: false, error: "invalid_variables", errors };
  if (!vars.length) return { ok: false, error: "no_variables", errors: ["say which sizes may change"] };

  let evaluations = 0;
  const at = (values) => {
    const edits = vars.map((v, i) => ({ id: v.p.id, value: v.stock ? v.stock[values[i]].text : inUnitOf(v.p.value, values[i], "length") }));
    const ed = applyEdits(ir, edits);
    if (!ed.ok) return { ok: false, errors: ed.errors };
    evaluations += 1;
    return { ...evaluate(ed.ir), ir: ed.ir, edits };
  };
  // values: SI for continuous variables, a stock index for stock variables
  // start at the current sizes (a stock variable at the nearest stock size at or above it, else the largest)
  const start = vars.map((v) => { if (!v.stock) return v.cur; const k = v.stock.findIndex((s) => s.r.si >= v.cur - 1e-12); return k < 0 ? v.stock.length - 1 : k; });
  // "before" is the design as it stands, not the optimizer's starting point
  const asIs = evaluate(ir);
  if (!asIs.ok) return { ok: false, error: "compile", errors: asIs.errors };
  const before = { mass: asIs.mass, feasible: asIs.feasible, failing: asIs.failing };
  const initial = at(start);
  if (!initial.ok) return { ok: false, error: "compile", errors: initial.errors };

  // 1. feasibility: grow everything together
  let x = start.slice(), best = initial;
  if (!initial.feasible) {
    const grown = (t) => vars.map((v, i) => (v.stock ? Math.round(start[i] + (v.stock.length - 1 - start[i]) * t) : start[i] * (v.hi / start[i]) ** t));
    const top = at(grown(1));
    if (!top.ok) return { ok: false, error: "compile", errors: top.errors };
    if (!top.feasible) return { ok: true, feasible: false, before, evaluations, failingAtLimits: top.failing, message: "No design within these bounds passes every check: the checks below still fail with every size at its maximum. Widen the bounds, change the layout or material, or relax a requirement." };
    let lo = 0, hi = 1, hiRes = top;
    for (let k = 0; k < BISECT_STEPS; k++) { const mid = (lo + hi) / 2; const r = at(grown(mid)); if (r.ok && r.feasible) { hi = mid; hiRes = r; } else lo = mid; }
    x = grown(hi); best = hiRes;
  }
  // 2. descent: shrink each variable to its smallest passing value, keep it if lighter
  const descend = (x0, best0, skip = -1) => {
    let xx = x0.slice(), bb = best0;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      let moved = false;
      for (let i = 0; i < vars.length; i++) {
        if (i === skip) continue;
        const v = vars[i];
        if (v.stock) {
          for (let k = 0; k < xx[i]; k++) {
            const trial = xx.slice(); trial[i] = k;
            const r = at(trial);
            if (r.ok && r.feasible && r.mass < bb.mass - 1e-12) { xx = trial; bb = r; moved = true; break; }
          }
          continue;
        }
        if (xx[i] <= v.lo * (1 + 1e-9)) continue;
        const tryAt = (val) => { const trial = xx.slice(); trial[i] = val; return at(trial); };
        const atMin = tryAt(v.lo);
        if (atMin.ok && atMin.feasible) { if (atMin.mass < bb.mass - 1e-12) { xx[i] = v.lo; bb = atMin; moved = true; } continue; }
        let lo = Math.log(v.lo), hi = Math.log(xx[i]), hiRes = null;
        for (let k = 0; k < BISECT_STEPS; k++) { const mid = (lo + hi) / 2; const r = tryAt(Math.exp(mid)); if (r.ok && r.feasible) { hi = mid; hiRes = r; } else lo = mid; }
        if (hiRes && hiRes.mass < bb.mass - 1e-12 && Math.abs(Math.exp(hi) - xx[i]) > 1e-6 * xx[i]) { xx[i] = Math.exp(hi); bb = hiRes; moved = true; }
      }
      if (!moved) break;
    }
    return { x: xx, best: bb };
  };
  ({ x, best } = descend(x, best));
  // 3. trades: grow one size, shrink the others to their limits, keep it if lighter. Shrinking one
  //    value at a time can never find these (a tube gets lighter wider with a thinner wall).
  if (vars.length > 1) {
    for (const f of [2, 1.5, 1.25, 1.1, 1.04, 1.01]) {
      let improved = true;
      while (improved && evaluations < MAX_EVALUATIONS) {
        improved = false;
        for (let i = 0; i < vars.length; i++) {
          const v = vars[i];
          const trial = x.slice();
          if (v.stock) { if (x[i] >= v.stock.length - 1) continue; trial[i] = x[i] + 1; }
          else { if (x[i] >= v.hi * (1 - 1e-9)) continue; trial[i] = Math.min(v.hi, x[i] * f); }
          const grownRes = at(trial);
          if (!grownRes.ok || !grownRes.feasible) continue;
          const d = descend(trial, grownRes, i);
          if (d.best.mass < best.mass * (1 - 1e-6)) { x = d.x; best = d.best; improved = true; }
        }
      }
    }
  }
  const fin = evaluate(best.ir);
  // the checks that set the answer: within 0.1 % of their limit
  const binding = fin.checks.filter((c) => c.utilization >= 0.999).map((c) => ({ check: c.check, target: c.target, utilization: c.utilization }));
  return {
    ok: true, feasible: true, evaluations,
    before, after: { mass: fin.mass, worstUtilization: fin.worst },
    changes: vars.map((v, i) => ({ id: v.p.id, label: `${v.p.nodeName} ${v.p.label}`, from: v.p.value, to: best.edits[i].value, atBound: v.stock ? (x[i] === 0 ? "smallest stock" : x[i] === v.stock.length - 1 ? "largest stock" : null) : (x[i] <= v.lo * (1 + 1e-6) ? "min" : x[i] >= v.hi * (1 - 1e-6) ? "max" : null) })),
    binding, ir: best.ir,
    method: "feasibility by a common geometric step (bisection); coordinate descent (each size bisected to the smallest value on which every check passes, kept only if lighter); then trades (grow one size, shrink the others to their limits, kept only if lighter); deterministic, every value from a solver run",
    assumption: "a larger section never makes a check worse; the final design is re-checked in full",
  };
}
