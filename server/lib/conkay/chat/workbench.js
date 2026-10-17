// server/lib/conkay/chat/workbench.js
//
// Workbench v0 (conversational-loop item 5): the design as a diehard sees it. Built from the live design (a
// DesignConversation), nothing invented:
//   graph     the knobs (design variables) and every solver run, with the edges the engine recorded: a run that read
//             a knob's value, a run that read another run's result. Each run carries its depth (longest chain from
//             the inputs) so a view can lay it out in columns.
//   knobs     the design variables with their declared bounds or options and their lock (chat/what-if.js knobsOf).
//   checks    per run, its receipt: inputs (with sources), solver id + version, input hash, regime / validity, the
//             method and reference, margins, warnings, and a plain explanation generated from those numbers:
//             utilization = demand / capacity, with the values substituted, so a student can redo it by hand.
// A knob move and a chat edit go through the same edit path (DesignConversation.setKnob / ask).

import { knobsOf } from "./what-if.js";
import { sectionProps } from "../structural/frame-fe.js";
import { getMaterial } from "../materials/index.js";

export const WORKBENCH_VERSION = "1.1.0";

const fmt = (v) => (typeof v === "number" ? (Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(4) : +v.toPrecision(5)) : String(v));

/** Source links found in a run's inputs and outputs (http(s) strings), deduplicated. */
function sourceLinks(e) {
  const out = new Set();
  const walk = (x, depth = 0) => {
    if (depth > 6 || x == null) return;
    if (typeof x === "string") { if (/^https?:\/\//.test(x)) out.add(x); return; }
    if (Array.isArray(x)) { for (const y of x) walk(y, depth + 1); return; }
    if (typeof x === "object") for (const v of Object.values(x)) walk(v, depth + 1);
  };
  walk(e.inputs); walk(e.outputs);
  return [...out].slice(0, 12);
}

/** A plain explanation of a check, generated from its receipt (no claim the receipt does not carry). */
export function explainCheck(e) {
  const lines = [];
  if (e.solver?.method) lines.push(`Method: ${e.solver.method}.`);
  if (e.status === "NOT_COMPUTED") lines.push(`Not computed: ${e.reason || "an input is missing"}.`);
  if (e.status === "ERROR") lines.push(`The solver stopped with an error: ${e.error}.`);
  for (const m of e.margins || []) {
    if (!Number.isFinite(m.demand) || !Number.isFinite(m.capacity)) continue;
    const u = m.capacity !== 0 ? m.demand / m.capacity : Infinity;
    const unit = m.unit ? ` ${m.unit}` : "";
    lines.push(`${m.check}: utilization = demand / capacity = ${fmt(m.demand)}${unit} / ${fmt(m.capacity)}${unit} = ${fmt(u)} — ${u <= 1 ? "at or under 1, so it holds" : "over 1, so it does not hold"}.`);
  }
  for (const f of (e.failures || []).slice(0, 4)) lines.push(`Fails: ${f}.`);
  for (const w of (e.warnings || []).slice(0, 3)) lines.push(`Warning: ${w}`);
  if (e.solver?.regime) lines.push(`Valid for: ${e.solver.regime}.`);
  if (e.solver?.screening) lines.push("This is a screening check: it bounds or estimates, it does not certify.");
  lines.push("Passing a software check is not physical validation.");
  return lines.join("\n");
}

/** The receipt of one run, for the drawer. */
export function checkReceipt(e) {
  return {
    runId: e.runId, status: e.status,
    solver: { id: e.solver?.id ?? null, version: e.solver?.version ?? null, fidelity: e.solver?.fidelity ?? null, method: e.solver?.method ?? null, reference: e.solver?.reference ?? null, regime: e.solver?.regime ?? null, units: e.solver?.units ?? null, tolerance: e.solver?.tolerance ?? null, screening: e.solver?.screening ?? null },
    inputHash: e.provenance?.inputHash ?? null,
    inputs: Object.fromEntries(Object.entries(e.inputs || {}).slice(0, 24).map(([k, v]) => [k, v && typeof v === "object" ? { value: v.value ?? null, unit: v.unit ?? null, source: v.source ?? null } : { value: v }])),
    margins: (e.margins || []).map((m) => ({ check: m.check, demand: m.demand, capacity: m.capacity, unit: m.unit ?? null, utilization: m.utilization ?? null })),
    warnings: e.warnings || [], failures: e.failures || [], assumptions: (e.assumptions || []).slice(0, 8),
    sources: sourceLinks(e),
    explanation: explainCheck(e),
  };
}

/**
 * The frame-FE run the conversation actually ran (structure.frame on a node
 * carrying props.frameModel), as one honest load case in the shape the
 * engineering.runFEA path consumes (nodes/members/loads/supports in;
 * displacements/utilization/stresses out) — every field from the real solve:
 *   - model geometry: the graph node's own frameModel (nodes, members i/j,
 *     supports), with each member's REAL section + material as the run's own
 *     recorded inputs (`member.<id>`), A/Iz/depth via the solver's own
 *     sectionProps and E/fy via the material library the solve read;
 *   - model loads: the case's resolved nodal forces (the run's
 *     `<case>.appliedLoads` output — weight/force reads already numbers);
 *   - result: the run's own `<case>.members` (von Mises + utilization) and
 *     `<case>.nodeDisplacements` outputs.
 * A case whose resolved loads are only member UDLs cannot be honestly
 * re-solved through the nodal-only runFEA element, so it is skipped: the case
 * shown is the first stress-checked one with resolved nodal loads (the car's
 * kerb-twist), else the first with any nodal load (its twist couple). Null
 * unless every member resolves fully — never a half-real model.
 */
export function feaFrameOf(engine) {
  try {
    for (const [runId, run] of engine.runs) {
      if (run.solverId !== "structure.frame" || !run.envelope) continue;
      const fm = engine.graph.nodes.get(run.target)?.props?.frameModel;
      if (!fm || !Array.isArray(fm.nodes) || !Array.isArray(fm.members) || fm.members.length === 0) continue;
      const env = run.envelope;
      const outs = env.outputs || {};
      // pick the case: resolved nodal loads (re-runnable through the nodal-only
      // runFEA element), preferring one whose stresses the run actually checked.
      let pick = null;
      for (const lc of fm.loadCases || []) {
        const applied = outs[`${lc.id}.appliedLoads`]?.value;
        if (!applied || !Array.isArray(applied.nodal) || applied.nodal.length === 0) continue;
        if (!pick || (!lc.stiffnessOnly && pick.lc.stiffnessOnly)) pick = { lc, applied };
      }
      if (!pick) continue;
      const rows = outs[`${pick.lc.id}.members`]?.value;
      const disp = outs[`${pick.lc.id}.nodeDisplacements`]?.value;
      if (!Array.isArray(rows) || rows.length === 0 || !Array.isArray(disp) || disp.length === 0) continue;
      const fs = fm.factorOfSafety?.value ?? 1;
      const members = [];
      for (const m of fm.members) {
        const sec = env.inputs?.[`member.${m.id}`]?.value?.section;
        if (!sec) return null; // a member the run did not record ⟹ no honest model
        const sp = sectionProps(sec);
        const mat = getMaterial(env.inputs[`member.${m.id}`].value.material);
        const E = mat?.youngsModulusPa, fy = mat?.yieldPa;
        if (![sp.A, sp.Iz, sp.depth, E, fy].every((v) => Number.isFinite(v) && v > 0)) return null; // no half-real member
        members.push({ id: String(m.id), nodeI: String(m.i), nodeJ: String(m.j), area: sp.A, momentI: sp.Iz, depthIn: sp.depth, elasticModulus: E, allowableStress: fy / fs });
      }
      const loads = pick.applied.nodal.map((n) => ({
        nodeId: String(n.node),
        Fx: n.F?.[0] ?? 0, Fy: n.F?.[1] ?? 0, Fz: n.F?.[2] ?? 0,
        ...(Array.isArray(n.M) ? { Mx: n.M[0] ?? 0, My: n.M[1] ?? 0, Mz: n.M[2] ?? 0 } : {}),
      }));
      const supports = (pick.lc.supports || fm.supports || []).map((s) => ({ nodeId: String(s.node), fixedDOF: s.fix }));
      const utils = rows.map((r) => ({ id: String(r.id), utilization: Number.isFinite(r.utilization) ? r.utilization : null }));
      const maxUtil = utils.reduce((mx, u) => (u.utilization != null && u.utilization > mx ? u.utilization : mx), 0);
      return {
        runId,
        case: pick.lc.id,
        model: { nodes: fm.nodes, members, loads, supports },
        result: {
          displacements: disp.map((d) => ({ nodeId: String(d.node), dx: d.u?.[0] ?? 0, dy: d.u?.[1] ?? 0, dz: d.u?.[2] ?? 0 })),
          utilization: utils,
          stresses: rows.map((r) => ({ id: String(r.id), combinedStress: Number.isFinite(r.vonMisesPa) ? r.vonMisesPa : 0 })),
          summary: { maxUtilization: maxUtil },
        },
        note: `the structure.frame run on this design, load case "${pick.lc.id}", as the conversation solved it`,
      };
    }
  } catch { // any surprise in the run's shape ⟹ no artifact, never a guess
    return null;
  }
  return null;
}

/** The Workbench view of a conversation's current design. */
export function workbenchView(conv) {
  const cur = conv.current;
  const engine = cur.final.session.engine;
  const knobs = knobsOf(conv);
  const knobKeys = { tailExtensionM: "node:BODY_SHELL/geometry.tailExtension", motorId: "node:ENGINE/" };
  const runs = [...engine.runs.entries()].filter(([, r]) => r.envelope);
  const ids = new Set(runs.map(([id]) => id));
  const edges = [];
  for (const [id, r] of runs) {
    for (const k of r.reads) {
      if (k.startsWith("result:") && ids.has(k.slice(7))) edges.push({ from: k.slice(7), to: id, kind: "result" });
      for (const knob of knobs) if (k.startsWith(knobKeys[knob.variable] || "\u0000")) edges.push({ from: `knob:${knob.variable}`, to: id, kind: "reads" });
    }
  }
  const dedup = [...new Map(edges.map((e) => [`${e.from}>${e.to}`, e])).values()];
  // depth: longest chain of result reads (knobs at 0, runs that read no other run at 1)
  const depth = new Map();
  const preds = new Map();
  for (const e of dedup) if (e.kind === "result") (preds.get(e.to) || preds.set(e.to, []).get(e.to)).push(e.from);
  const d = (id, seen = new Set()) => {
    if (depth.has(id)) return depth.get(id);
    if (seen.has(id)) return 1;
    seen.add(id);
    const v = 1 + Math.max(0, ...(preds.get(id) || []).map((p) => d(p, seen)));
    depth.set(id, v);
    return v;
  };
  const nodes = [
    ...knobs.map((k) => ({ id: `knob:${k.variable}`, kind: "knob", label: k.label, depth: 0, locked: k.locked })),
    ...runs.map(([id, r]) => ({ id, kind: "run", label: id, solver: r.envelope.solver?.id ?? null, status: r.envelope.status, depth: d(id) })),
  ];
  return {
    version: WORKBENCH_VERSION,
    revision: conv.revisions.length - 1,
    receipt: cur.receipt,
    state: cur.state,
    knobs,
    locked: [...conv.locked].sort(),
    graph: { nodes, edges: dedup },
    checks: runs.map(([, r]) => checkReceipt(r.envelope)).sort((a, b) => a.runId.localeCompare(b.runId)),
    // one frame case of the design's own structure.frame run, in the shape the
    // engineering.runFEA artifact path consumes (feaFrameOf: honest fields of
    // the real solve, or absent when the design has none)
    feaFrame: feaFrameOf(engine),
  };
}
