// server/lib/conkay/chat/orchestrator.js
//
// The iterate loop, automated: what was done by hand on the electric car (#1230) as ConKay's normal operation.
//
//   orchestrate({ evaluate, rules, initialState, budget, pick })
//     evaluate(state) -> { envelopes: Map(runId -> envelope), report, massKg, requirementsHash, designHash }
//     each iteration:
//       1. the failing checks (FAIL envelopes) of the current design
//       2. the repair table's rules that apply (chat/repair-rules.js): candidate values for bounded variables
//       3. every candidate is RUN (the finite-difference sensitivity: d margin / d value from a real rerun, not a
//          model of one), its regressions found (a check that newly fails), its cost computed (kerb mass change)
//       4. candidates that regress nothing and improve the failing margins are ranked by margin gain per kg
//          (ties: table order); `pick` (optional, e.g. a language model) may only choose among the top three and
//          explain; anything else is ignored
//       5. stop at: all PASS (WARNs listed), PROVEN INFEASIBLE (no rule applies, or every candidate regresses or
//          gains nothing: the binding variables are named, requirement changes offered, never applied), the
//          iteration budget (default 12) or the wall-time budget
//     Every iteration is logged (failing checks, candidates with their computed margins, the change, why, the rerun
//     set = the runs whose inputs changed, envelope counts, design hash) and the log is hashed into the receipt.
//
// Requirements are hashed before and after every step: a change to one aborts the run.

import { sha256 } from "../iterate/receipt.js";

export const ORCHESTRATOR_VERSION = "1.0.0";
export const DEFAULT_BUDGET = Object.freeze({ iterations: 12, wallMs: 4 * 60 * 60 * 1000 });

const utilOf = (e) => {
  const us = (e?.margins || []).map((m) => m.utilization).filter(Number.isFinite);
  return us.length ? Math.max(...us) : e?.status === "FAIL" ? Infinity : 0;
};
const counts = (envs) => { const c = {}; for (const e of envs.values()) c[e.status] = (c[e.status] || 0) + 1; return c; };
const failingIds = (envs) => [...envs.values()].filter((e) => e.status === "FAIL").map((e) => e.runId).sort();
const warnIds = (envs) => [...envs.values()].filter((e) => e.status === "WARN").map((e) => e.runId).sort();

/** The runs whose inputs changed between two evaluations (the rerun set). */
function rerunSet(a, b) {
  const out = [];
  for (const [id, e] of b) {
    const p = a.get(id);
    if (!p || p.provenance?.inputHash !== e.provenance?.inputHash) out.push(id);
  }
  return out.sort();
}

export async function orchestrate({ evaluate, rules, initialState, budget = {}, pick = null, now = () => Date.now(), onEvent = null }) {
  // progress events for the live view (item 3): pure data, no clock, so a replay is the run
  const emit = (e) => { try { onEvent?.(e); } catch { /* a viewer never breaks the run */ } };
  emit({ type: "start", initialState: { ...initialState } });
  const B = { ...DEFAULT_BUDGET, ...budget };
  const t0 = now();
  let state = { ...initialState };
  let cur;
  try {
    cur = await evaluate(state);
  } catch (e) {
    // the design cannot even be built from what the library holds (a component selection fails before any check
    // runs): proven infeasible at the build, with the binding constraint the compiler names
    if (e?.code !== "build-infeasible") throw e;
    const outcome = { kind: "proven-infeasible", stage: "build", failing: [], binding: [{ rule: "component-selection", variable: e.variable || null, why: e.message }], requirementOptions: e.requirementOptions || [] };
    const body = { orchestratorVersion: ORCHESTRATOR_VERSION, initialState, finalState: state, outcome, log: [], finalDesignHash: null, requirementsHash: null };
    const receiptSha256 = sha256(body);
    emit({ type: "done", outcome, finalState: state, receiptSha256, snapshot: null, envelopes: {} });
    return { ...body, receiptSha256, final: null, state };
  }
  const reqHash0 = cur.requirementsHash;
  emit({ type: "evaluated", label: "initial design", failingChecks: failingIds(cur.envelopes), envelopes: counts(cur.envelopes), designHash: cur.designHash, snapshot: cur.snapshot || null });
  const log = [];
  let outcome = null;
  for (let iteration = 1; ; iteration++) {
    const fails = failingIds(cur.envelopes);
    if (!fails.length) { outcome = { kind: "all-pass", warnings: warnIds(cur.envelopes) }; break; }
    if (iteration > B.iterations) { outcome = { kind: "iteration-budget", failing: fails }; break; }
    if (now() - t0 > B.wallMs) { outcome = { kind: "wall-time-budget", failing: fails }; break; }
    const ctx = { state, envelopes: cur.envelopes, report: cur.report };
    const applicable = rules.filter((r) => r.variable && r.applies(ctx));
    const listed = rules.filter((r) => r.listed && r.applies(ctx)).map((r) => ({ rule: r.id, cite: r.cite }));
    const binding = rules.filter((r) => r.variable && !r.applies(ctx) && r.checks.some((c) => fails.includes(c))).map((r) => ({ rule: r.id, variable: r.variable, why: r.atBound(ctx) }));
    const tried = [];
    for (const rule of applicable) {
      const cands = rule.candidates(ctx);
      if (!cands.length) { binding.push({ rule: rule.id, variable: rule.variable, why: rule.atBound(ctx) }); continue; }
      for (const c of cands) {
        const next = { ...state, [rule.variable]: c.value };
        const res = await evaluate(next);
        if (res.requirementsHash !== reqHash0) throw new Error(`candidate ${rule.id} changed a requirement: refused`);
        const gains = Object.fromEntries(rule.checks.filter((id) => cur.envelopes.has(id)).map((id) => [id, { before: utilOf(cur.envelopes.get(id)), after: utilOf(res.envelopes.get(id)), statusAfter: res.envelopes.get(id)?.status }]));
        const gain = Object.values(gains).reduce((s, g) => s + (Number.isFinite(g.before) && Number.isFinite(g.after) ? g.before - g.after : 0), 0);
        const regressions = failingIds(res.envelopes).filter((id) => !fails.includes(id));
        const dMass = (res.massKg ?? 0) - (cur.massKg ?? 0);
        const fixes = rule.checks.filter((id) => fails.includes(id) && res.envelopes.get(id)?.status !== "FAIL").sort();
        tried.push({
          rule: rule.id, variable: rule.variable, value: c.value, label: c.label, cite: rule.cite,
          margins: gains, gain: +gain.toFixed(6), sensitivity: typeof c.value === "number" && typeof state[rule.variable] === "number" ? +(gain / (c.value - state[rule.variable])).toFixed(6) : null,
          dMassKg: +dMass.toFixed(3), perKg: +(gain / Math.max(0.1, Math.abs(dMass))).toFixed(6),
          regressions, fixes, rerun: rerunSet(cur.envelopes, res.envelopes), designHash: res.designHash, _state: next, _res: res,
        });
        // the smallest step on this variable that clears its check, or that resolves the rule's own condition
        const failingHere = rule.checks.filter((id) => fails.includes(id));
        if (!regressions.length && ((failingHere.length && fixes.length === failingHere.length) || rule.resolved?.({ state: next, envelopes: res.envelopes, report: res.report }))) break;
      }
    }
    const ok = tried.filter((t) => !t.regressions.length && t.gain > 1e-9);
    ok.sort((a, b) => (b.fixes.length - a.fixes.length) || (b.perKg - a.perKg) || (rules.findIndex((r) => r.id === a.rule) - rules.findIndex((r) => r.id === b.rule)));
    const strip = ({ _state, _res, ...t }) => t;
    let chosen = ok[0] || null;
    let pickNote = null;
    if (chosen && typeof pick === "function") {
      const top = ok.slice(0, 3).map(strip);
      const p = await pick(top, { iteration, failing: fails });
      const idx = top.findIndex((t) => t.rule === p?.rule && t.value === p?.value);
      if (idx >= 0) { chosen = ok[idx]; pickNote = typeof p.why === "string" ? p.why.slice(0, 500) : null; } else if (p) pickNote = "the pick was not one of the top computed candidates: ignored";
    }
    const entry = {
      iteration, failing: fails, listed, binding,
      candidates: tried.map(strip),
      chosen: chosen ? { rule: chosen.rule, variable: chosen.variable, value: chosen.value, label: chosen.label, reason: chosen.fixes.length ? `clears ${chosen.fixes.join(", ")} with no new failure (${chosen.dMassKg} kg)` : `best margin gain per kg with no new failure (${chosen.perKg} per kg)`, ...(pickNote ? { pickNote } : {}) } : null,
      rerun: chosen ? chosen.rerun : [],
      envelopes: counts((chosen?._res || cur).envelopes),
      designHash: (chosen?._res || cur).designHash,
    };
    log.push(entry);
    emit({
      type: "iteration", iteration, failingChecks: fails,
      candidates: entry.candidates.map((c) => ({ rule: c.rule, variable: c.variable, value: c.value, label: c.label, gain: c.gain, dMassKg: c.dMassKg, perKg: c.perKg, fixes: c.fixes, regressions: c.regressions })),
      change: entry.chosen, rerunNodes: entry.rerun, envelopes: entry.envelopes, designHash: entry.designHash, binding: chosen ? [] : binding,
      snapshot: (chosen?._res || cur).snapshot || null,
    });
    if (!chosen) {
      outcome = {
        kind: "proven-infeasible", failing: fails,
        binding: [...binding, ...tried.filter((t) => t.regressions.length).map((t) => ({ rule: t.rule, variable: t.variable, why: `${t.label} would newly fail ${t.regressions.join(", ")}` }))],
        requirementOptions: fails.filter((id) => /^requirement\.check@/.test(id)).map((id) => ({ runId: id, option: `relax ${id.replace(/^requirement\.check@/, "")} to what the design reaches (${cur.report?.topSpeed?.mph != null && /topSpeed/.test(id) ? `${cur.report.topSpeed.mph} mph` : "see its envelope"})`, applied: false })),
      };
      break;
    }
    state = chosen._state;
    cur = chosen._res;
  }
  const strippedLog = log;
  const body = { orchestratorVersion: ORCHESTRATOR_VERSION, initialState, finalState: state, outcome, log: strippedLog, finalDesignHash: cur.designHash, requirementsHash: reqHash0 };
  const receiptSha256 = sha256(body);
  emit({ type: "done", outcome, finalState: state, receiptSha256, snapshot: cur.snapshot || null, envelopes: counts(cur.envelopes) });
  return { ...body, receiptSha256, final: cur, state };
}

// ---- the car adapter ----------------------------------------------------------------------------------------------

/**
 * evaluate(state) for the compiler's car: state { brief, fuelType, motorId?, tailExtensionM }. Runs
 * carAcceptanceAsync with the compiler's own motor repair OFF (the orchestrator owns the repair) and returns the
 * envelopes, the report, the kerb mass, a hash of the requirements and of the design (IR nodes).
 */
export function carEvaluator({ carAcceptanceAsync, cadBody = true }) {
  return async (state) => {
    const config = { fuelType: state.fuelType, ...(state.motorId ? { motorId: state.motorId } : {}) };
    const r = await carAcceptanceAsync(state.brief, { config, bodyParams: { tailExtensionM: state.tailExtensionM }, motorRepair: false, ...(cadBody ? {} : { cadBody: false }) });
    if (!r.ok) {
      const e = new Error(r.error || "the car did not build");
      // the compiler refuses a requirement no library component meets (tyres, drive units): build-infeasible
      if (/no (tyre|tire|motor|engine|differential)|established above|no .* in the library/i.test(r.error || "")) {
        e.code = "build-infeasible";
        e.variable = /tyre|tire/i.test(r.error) ? "tyres" : "drive unit";
        const lim = (r.error || "").match(/above (\d+(?:\.\d+)?) km\/h \((\d+) mph\)/);
        e.requirementOptions = lim ? [{ option: `relax the top speed to at most ${lim[2]} mph (${lim[1]} km/h), the highest speed a library tyre is established for`, applied: false }, { option: "or add a tyre established above the required speed to the component library (sourced rating)", applied: false }] : [];
      }
      throw e;
    }
    const s = r.session;
    const envelopes = new Map(s.results().filter(Boolean).map((e) => [e.runId, e]));
    const graph = s.engine.graph;
    const stl = envelopes.get("cad.body@BODY_SHELL")?.outputs?.files?.value?.stl;
    return {
      snapshot: stl?.path ? { kind: "stl", path: stl.path, sha256: stl.sha256 || null, triangles: stl.triangles ?? null } : null,
      session: s, envelopes, report: r.report, massKg: r.report.massBreakdown?.totalKg ?? null,
      requirementsHash: sha256(graph.requirements),
      designHash: sha256([...graph.nodes.values()].map((n) => ({ id: n.id, geometry: n.geometry, position: n.position, material: n.material })).sort((a, b) => a.id.localeCompare(b.id))),
    };
  };
}
