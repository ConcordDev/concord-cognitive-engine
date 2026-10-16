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

export const WORKBENCH_VERSION = "1.0.0";

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
  };
}
