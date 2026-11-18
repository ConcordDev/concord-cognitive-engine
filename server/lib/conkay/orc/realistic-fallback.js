// server/lib/conkay/orc/realistic-fallback.js
//
// SX-ORC-09 — orc.realistic-fallback: the closest realistic version
// of an impossible request (catalogue wave 0, PRG-17; fidelity
// target L3). When a request violates a solver envelope, this
// solver never refuses and never improvises a number: it solves
// the min-distance relaxation in requirement space against the
// DECLARED constraints and ships the answer WITH its envelope
// (CB-0835 rule 2), worded "closest within the stated envelope".
//
// The relaxation rule is the founder's F10 ruling (Ramaj,
// 2026-11-18, adopting the catalogue planner's recommendation
// entire):
//   1. The user's stated priorities govern when given — "must" /
//      "at least" / "ideally" rank the requirements (an explicit
//      priority field, or the words in the requirement's own
//      source text). A higher-priority requirement is held while
//      any feasible relaxation moves only lower-priority ones.
//   2. Otherwise relax so as to minimize the largest relative
//      change (min-max relative change against the requested
//      bound values).
//   3. The primary version is presented first, plus up to two
//      Pareto alternatives (each relaxing a different
//      requirement), all fully computed and verified against
//      every declared constraint.
//   4. Every change cites the solver envelope that forced it.
//
// Declared constraint model (the JS tier's exact envelope):
//   limit — a per-metric achievable bound with its forcing
//           envelope (solver + citation);
//   ratio — a pairwise bound achievedNum/achievedDen <= si (or
//           >= si) with its forcing envelope (the tyre-friction
//           shape a <= mu*g over speed/time).
// Limits compose exactly; a ratio over two metrics is solved in
// closed form (balanced min-max, or the priority-held single-side
// relaxation). A constraint interaction the closed forms cannot
// compose into a verified feasible point is the general OPT —
// the SXE-21 engine tier, declared engineDependent and reported
// NOT_COMPUTED engine_unavailable:sxe-21 in every result; the JS
// tier's answer is never labelled as the engine result.
// Contradictory envelopes (two limits no point can satisfy) are
// NOT_COMPUTED naming both citations — against contradictory
// envelopes no realistic version exists, and inventing one would
// be an improvised number.
//
// Inputs echo exactly (SC-05); a dimensional bound without its
// declared unit is refused (SC-04); nothing is defaulted (SC-03).

import { registerSolver } from "../physics/registry.js";

const NS = "orc.realisticFallback";
const RANKS = { must: 3, "at-least": 2, ideally: 0 };
const UNRANKED = 1;
const EPS = 1e-12;

function priorityOf(req) {
  if (typeof req?.priority === "string" && req.priority in RANKS) {
    return { priority: req.priority, rank: RANKS[req.priority], source: "declared" };
  }
  const src = typeof req?.source === "string" ? req.source : "";
  if (/\bmust\b/i.test(src)) return { priority: "must", rank: RANKS.must, source: "source-words" };
  if (/\bat least\b/i.test(src)) return { priority: "at-least", rank: RANKS["at-least"], source: "source-words" };
  if (/\bideally\b/i.test(src)) return { priority: "ideally", rank: RANKS.ideally, source: "source-words" };
  return { priority: null, rank: UNRANKED, source: "unstated" };
}

function checkBound(bound, where) {
  if (!bound || typeof bound !== "object") return { error: `missing_input:${where} (a bound object)` };
  if (bound.kind !== "max" && bound.kind !== "min") return { error: `INVALID_INPUT: ${where}.kind must be "max" or "min"` };
  const si = Number(bound.si);
  if (!Number.isFinite(si) || Math.abs(si) >= 1e300) return { error: `INVALID_INPUT: ${where}.si must be a finite number` };
  if (si <= 0) return { error: `INVALID_INPUT: ${where}.si must be positive (got ${si}) — relative change is measured against the bound value` };
  if (typeof bound.unit !== "string" || !bound.unit) {
    return { error: `missing_input:${where}.unit — a bare number on a dimensional input is refused unless the unit is declared (SC-04)` };
  }
  return { si };
}

function checkEnvelope(env, where) {
  if (!env || typeof env.solver !== "string" || !env.solver) {
    return { error: `missing_input:${where}.envelope.solver — a change must cite the solver envelope that forced it` };
  }
  if (typeof env.citation !== "string" || !env.citation) {
    return { error: `missing_input:${where}.envelope.citation — a change must cite the solver envelope that forced it` };
  }
  return {};
}

/** The pure solver function. Exported for direct testing. */
export function realisticFallback(props = {}) {
  const reqsIn = props?.requirements;
  if (!Array.isArray(reqsIn) || reqsIn.length === 0) {
    return { notComputed: "missing_input:requirements (the requested bounds, in the orc.requirements shape)", inputs: {} };
  }
  const consIn = props?.constraints ?? [];
  if (!Array.isArray(consIn)) {
    return { notComputed: "INVALID_INPUT: constraints must be an array of declared envelope constraints", inputs: { requirements: reqsIn } };
  }
  const inputs = { requirements: reqsIn, ...(props?.constraints !== undefined ? { constraints: consIn } : {}) };

  // --- validate requirements --------------------------------------
  const reqs = new Map(); // metric -> {kind, si, unit, priority, rank, prioritySource}
  for (let i = 0; i < reqsIn.length; i++) {
    const r = reqsIn[i];
    if (!r || typeof r.metric !== "string" || !r.metric) {
      return { notComputed: `missing_input:requirements[${i}].metric`, inputs };
    }
    if (reqs.has(r.metric)) {
      return { notComputed: `INVALID_INPUT: duplicate requirement for metric "${r.metric}" — one bound per metric in a request`, inputs };
    }
    const b = checkBound(r.bound, `requirements[${i}].bound`);
    if (b.error) return { notComputed: b.error, inputs };
    const p = priorityOf(r);
    reqs.set(r.metric, { kind: r.bound.kind, si: b.si, unit: r.bound.unit, ...p });
  }

  // --- validate constraints ---------------------------------------
  const limits = []; // {metric, kind, si, envelope}
  const ratios = []; // {numerator, denominator, kind, si, envelope}
  for (let i = 0; i < consIn.length; i++) {
    const c = consIn[i];
    const where = `constraints[${i}]`;
    if (!c || (c.kind !== "limit" && c.kind !== "ratio")) {
      return { notComputed: `INVALID_INPUT: ${where}.kind must be "limit" or "ratio" — other constraint shapes are the SXE-21 engine tier's general OPT`, inputs };
    }
    const e = checkEnvelope(c.envelope, where);
    if (e.error) return { notComputed: e.error, inputs };
    const b = checkBound(c.bound, `${where}.bound`);
    if (b.error) return { notComputed: b.error, inputs };
    if (c.kind === "limit") {
      if (typeof c.metric !== "string" || !reqs.has(c.metric)) {
        return { notComputed: `INVALID_INPUT: ${where}.metric "${c.metric}" is not a declared requirement — an envelope can only bind a requested metric`, inputs };
      }
      limits.push({ metric: c.metric, kind: c.bound.kind, si: b.si, envelope: c.envelope });
    } else {
      if (!reqs.has(c.numerator) || !reqs.has(c.denominator) || c.numerator === c.denominator) {
        return { notComputed: `INVALID_INPUT: ${where} ratio must name two distinct declared requirement metrics (got "${c.numerator}" / "${c.denominator}")`, inputs };
      }
      ratios.push({ numerator: c.numerator, denominator: c.denominator, kind: c.bound.kind, si: b.si, envelope: c.envelope });
    }
  }

  // Contradictory limit envelopes on one metric: no point exists.
  for (const [metric] of reqs) {
    const maxes = limits.filter((l) => l.metric === metric && l.kind === "max");
    const mins = limits.filter((l) => l.metric === metric && l.kind === "min");
    for (const mx of maxes) for (const mn of mins) {
      if (mx.si < mn.si) {
        return {
          notComputed: `contradictory_envelopes: metric "${metric}" is bounded above ${mx.si} by ${mx.envelope.solver} ("${mx.envelope.citation}") and below ${mn.si} by ${mn.envelope.solver} ("${mn.envelope.citation}") — no realistic version exists against contradictory envelopes, and none is improvised`,
          inputs,
        };
      }
    }
  }

  const x0 = new Map([...reqs].map(([m, r]) => [m, r.si]));
  const relOf = (metric, value) => Math.abs(value - x0.get(metric)) / x0.get(metric);
  const forcedBy = new Map(); // metric -> Map(key -> envelope)
  const noteForced = (metric, envelope) => {
    if (!forcedBy.has(metric)) forcedBy.set(metric, new Map());
    forcedBy.get(metric).set(`${envelope.solver}|${envelope.citation}`, envelope);
  };

  const satisfies = (point) => {
    for (const l of limits) {
      const v = point.get(l.metric);
      if (l.kind === "max" && v > l.si * (1 + EPS)) return false;
      if (l.kind === "min" && v < l.si * (1 - EPS)) return false;
    }
    for (const r of ratios) {
      const v = point.get(r.numerator) / point.get(r.denominator);
      if (r.kind === "max" && v > r.si * (1 + EPS)) return false;
      if (r.kind === "min" && v < r.si * (1 - EPS)) return false;
    }
    return true;
  };

  // --- phase 1: per-metric limits (exact, independent) ------------
  const point = new Map(x0);
  for (const [metric] of reqs) {
    const mine = limits.filter((l) => l.metric === metric);
    if (!mine.length) continue;
    let target = point.get(metric);
    let binding = null;
    for (const l of mine) {
      if (l.kind === "max" && target > l.si) { target = l.si; binding = l; }
      if (l.kind === "min" && target < l.si) { target = l.si; binding = l; }
    }
    if (binding && target !== point.get(metric)) {
      point.set(metric, target);
      noteForced(metric, binding.envelope);
    }
  }

  // --- phase 2: pairwise ratios (closed form) ----------------------
  const alternatives = [];
  let alternativesNote = null;
  const pairCandidates = (r, pt) => {
    const a = pt.get(r.numerator), b = pt.get(r.denominator), L = r.si;
    // Single-side moves land the ratio exactly on its bound.
    const singleNum = new Map(pt); singleNum.set(r.numerator, L * b);
    const singleDen = new Map(pt); singleDen.set(r.denominator, a / L);
    // Balanced min-max: both metrics move by the same relative t.
    let t;
    const balanced = new Map(pt);
    if (r.kind === "max") {
      t = (a - L * b) / (a + L * b);
      balanced.set(r.numerator, a * (1 - t));
      balanced.set(r.denominator, b * (1 + t));
    } else {
      t = (L * b - a) / (L * b + a);
      balanced.set(r.numerator, a * (1 + t));
      balanced.set(r.denominator, b * (1 - t));
    }
    return { singleNum, singleDen, balanced };
  };

  for (const r of ratios) {
    const val = point.get(r.numerator) / point.get(r.denominator);
    const violated = r.kind === "max" ? val > r.si * (1 + EPS) : val < r.si * (1 - EPS);
    if (!violated) continue;
    const { singleNum, singleDen, balanced } = pairCandidates(r, point);
    const rankNum = reqs.get(r.numerator).rank, rankDen = reqs.get(r.denominator).rank;

    let chosen = null, chosenKind = null;
    if (rankNum !== rankDen) {
      // Rule 1 (priorities first): hold the higher-priority metric
      // if relaxing only the lower-priority one is feasible.
      const lowerIsNum = rankNum < rankDen;
      const cand = lowerIsNum ? singleNum : singleDen;
      if (satisfies(cand)) { chosen = cand; chosenKind = lowerIsNum ? "singleNum" : "singleDen"; }
    }
    if (!chosen) {
      if (satisfies(balanced)) { chosen = balanced; chosenKind = "balanced"; }
      else if (satisfies(singleNum)) { chosen = singleNum; chosenKind = "singleNum"; }
      else if (satisfies(singleDen)) { chosen = singleDen; chosenKind = "singleDen"; }
    }
    if (!chosen) {
      return {
        notComputed: `engine_tier_required:sxe-21 — the ${r.numerator}/${r.denominator} ratio bound (${r.envelope.solver}: "${r.envelope.citation}") interacts with the declared limits so that no closed-form relaxation composes a feasible point; the general OPT is the engine tier's, and no number is improvised at the JS tier`,
        inputs,
      };
    }
    // Pareto alternatives: the pair's other fully-computed versions,
    // each relaxing a different requirement, verified whole.
    const altDefs = [
      { kind: "singleNum", pt: singleNum, relaxes: [r.numerator], label: `relaxes ${r.numerator} alone for the ${r.envelope.solver} bound` },
      { kind: "singleDen", pt: singleDen, relaxes: [r.denominator], label: `relaxes ${r.denominator} alone for the ${r.envelope.solver} bound` },
      { kind: "balanced", pt: balanced, relaxes: [r.numerator, r.denominator], label: `min-max balance across ${r.numerator} + ${r.denominator} for the ${r.envelope.solver} bound` },
    ];
    for (const alt of altDefs) {
      if (alternatives.length >= 2) break;
      if (alt.kind === chosenKind) continue;
      const full = new Map(point);
      full.set(r.numerator, alt.pt.get(r.numerator));
      full.set(r.denominator, alt.pt.get(r.denominator));
      if (!satisfies(full)) continue;
      alternatives.push({ label: alt.label, relaxes: alt.relaxes, point: full, envelope: r.envelope });
    }
    for (const m of [r.numerator, r.denominator]) {
      if (chosen.get(m) !== point.get(m)) noteForced(m, r.envelope);
    }
    point.set(r.numerator, chosen.get(r.numerator));
    point.set(r.denominator, chosen.get(r.denominator));
  }

  if (!satisfies(point)) {
    return {
      notComputed: "engine_tier_required:sxe-21 — the composed relaxation does not verify against every declared constraint; the general OPT is the engine tier's, and no number is improvised at the JS tier",
      inputs,
    };
  }

  // --- assemble the answer -----------------------------------------
  const changesOf = (pt, forced) => {
    const out = [];
    for (const [metric, req] of reqs) {
      const v = pt.get(metric);
      if (Math.abs(v - x0.get(metric)) <= EPS * x0.get(metric)) continue;
      out.push({
        metric, from: x0.get(metric), to: v, unit: req.unit,
        relativeChange: relOf(metric, v),
        forcedBy: forced ? [...(forced.get(metric)?.values() ?? [])] : [],
        priority: req.priority, prioritySource: req.source,
        mustRelaxed: req.priority === "must",
      });
    }
    return out;
  };
  const pointObj = (pt) => Object.fromEntries([...reqs].map(([m, req]) => [m, { value: pt.get(m), unit: req.unit }]));
  const maxRel = (pt) => Math.max(0, ...[...reqs.keys()].map((m) => relOf(m, pt.get(m))));

  const changes = changesOf(point, forcedBy);
  const verdict = changes.length ? "relaxed" : "feasible-as-requested";
  if (!alternatives.length) {
    alternativesNote = verdict === "feasible-as-requested"
      ? "no alternatives: the request already satisfies every declared envelope — there is no relaxation to alternative against"
      : "no Pareto alternatives: every violated constraint here is an independent per-metric envelope (or its alternatives failed verification), so the closest feasible point is unique";
  }

  const warnings = [
    "engine tier sxe-21 NOT_COMPUTED (engine_unavailable:sxe-21): the general OPT over arbitrary solver constraints is the engine tier's; this result is the JS tier's exact solve of the declared constraint model, never labelled as the engine result",
  ];
  for (const c of changes) {
    if (c.mustRelaxed) {
      warnings.push(`a "must" requirement was relaxed under envelope force: ${c.metric} ${c.from} -> ${c.to} ${c.unit} (forced by ${c.forcedBy.map((e) => e.solver).join(", ")}) — the envelope, not preference, moved it`);
    }
  }

  return {
    inputs,
    outputs: {
      verdict,
      claim: "closest within the stated envelope",
      claimText: verdict === "relaxed"
        ? "closest realistic version within the stated envelope"
        : "the request is feasible as stated, within the stated envelope",
      requested: Object.fromEntries([...reqs].map(([m, r]) => [m, { kind: r.kind, si: r.si, unit: r.unit, priority: r.priority, prioritySource: r.source }])),
      realistic: pointObj(point),
      changes,
      alternatives: alternatives.map((a) => ({
        label: a.label, relaxes: a.relaxes, realistic: pointObj(a.point),
        changes: changesOf(a.point, null).map((c) => ({ ...c, forcedBy: [a.envelope] })),
        maxRelativeChange: maxRel(a.point),
      })),
      ...(alternativesNote ? { alternativesNote } : {}),
      maxRelativeChange: maxRel(point),
      envelope: {
        claim: "closest within the stated envelope",
        constraints: consIn,
        fidelityTier: "L3",
        engineTier: { tier: "sxe-21", status: "NOT_COMPUTED", reason: "engine_unavailable:sxe-21 — the general OPT is the engine tier's; the JS tier solved the declared constraint model exactly" },
      },
    },
    assumptions: [],
    warnings,
  };
}

// Local targets/run pair (literal-key discipline; graph-adapter finding
// filed under SX-ORC-01).
function fbTargets(graph) {
  if (!graph || !graph.nodes) return [];
  const out = [];
  for (const [id, node] of graph.nodes) {
    if (node && node.props && node.props[NS]) out.push(id);
  }
  return out;
}

function fbRun(ctx, id) {
  let all = null;
  try {
    all = ctx.get(id, "props");
  } catch {
    all = null;
  }
  const props = all ? all[NS] : null;
  if (!props || (typeof props === "object" && !Array.isArray(props) && Object.keys(props).length === 0)) {
    return { notComputed: `props.${NS} is empty or absent on node ${id}`, inputs: {} };
  }
  return realisticFallback(props);
}

registerSolver({
  id: "orc.realistic-fallback",
  version: "1.0.0",
  domain: "orchestration",
  domains: ["orchestration"],
  method: "realistic-fallback.min-distance",
  fidelity: 3,
  engineDependent: ["sxe-21"],
  regime: "the closest realistic version of an impossible request: infeasible requests relaxed against declared envelopes — per-metric limits and pairwise ratio bounds — under the F10 rule: stated priorities first (must / at least / ideally), then min-max relative change, with up to two verified Pareto alternatives; the general constrained OPT is the sxe-21 engine tier",
  units: "inherited per requirement (SI inside; every bound carries its declared unit and echoes it)",
  tolerance: "closed-form exact for the declared constraint model; reference cases asserted to 1e-9 relative",
  screening: false,
  reference: "the forcing envelopes' own references, cited per change — tyre friction (Gillespie, Fundamentals of Vehicle Dynamics) and the electric-aircraft energy bounds (Anderson, Aircraft Performance & Design) among them",
  graphProp: NS,
  targets: fbTargets,
  run: fbRun,
});

export default { realisticFallback };
