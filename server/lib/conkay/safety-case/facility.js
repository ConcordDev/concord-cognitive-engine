// server/lib/conkay/safety-case/facility.js
//
// Nuclear Phase 3: a facility-level SSC graph (structures, systems,
// components, supports, with stated dependencies and their sources) linked to
// the Phase 1 safety-case graph (support graph, independence screen,
// requirement records, change log) and the Phase 2 fault-tree / event-tree
// engine, plus facility-level cross-system dependency checks:
//   1. the Phase 1 single-failure / cross-function screen on the support graph
//      generated from the facility (registry solvers, with receipts);
//   2. supports required by EVERY train of a function: they defeat it for any
//      success criterion, so functions whose criterion is unknown are covered;
//   3. shared SSCs: every SSC used by more than one module, with the modules and
//      safety functions that depend on it (common-cause initiator candidates);
//   4. fail-safe dependencies: supports whose loss ACTUATES functions (moves
//      them to their safe state) rather than defeating them, and across how
//      many modules at once;
//   5. source conflicts and gaps, as review items.
// Phase 2 link: the fault tree of each function is generated from the same
// graph; the LOOP event tree uses the NUREG/CR-6928 2020 LOOP frequency; every
// basic event without a sourced data row blocks quantification and is listed.
// Screening only (vocabulary.js): no output is a safety determination.

import { iterateToPhysical } from "../iterate/loop.js";
import { buildFaultTree, independenceScreen, propagate, validateSystem } from "./support-graph.js";
import { minimalCutSets } from "./fault-tree.js";
import { systemToIR } from "./demo.js";
import { makeRequirement, requirementStatus } from "./requirement.js";
import { ChangeLog, verifyChain } from "./change-log.js";
import { regRef } from "./sources.js";
import { INITIATOR_DATA, COMPONENT_DATA } from "./reliability-data.js";
import { BANNER } from "./vocabulary.js";
import "./solvers.js";

export const FACILITY_VERSION = "1.0.0";
const DEP_TYPES = new Set(["requires", "fail-safe", "actuates"]);
const SUPPORT_KIND = { structure: "structure", "ultimate-heat-sink": "ultimate-heat-sink", "control-room": "room-fire-area", power: "dc-bus", ic: "ic-channel", module: "structure" };

export function validateFacility(fac) {
  const errors = [];
  const ids = new Set();
  for (const s of fac.ssc) { if (ids.has(s.id)) errors.push(`duplicate SSC ${s.id}`); ids.add(s.id); }
  const factIds = new Set(Object.values(fac.facts).map((f) => f.id));
  for (const s of fac.ssc) {
    if (!s.facts?.length) errors.push(`SSC ${s.id} has no source fact`);
    for (const f of s.facts || []) if (!factIds.has(f)) errors.push(`SSC ${s.id}: unknown fact ${f}`);
  }
  for (const d of fac.dependencies) {
    if (!ids.has(d.from) || !ids.has(d.to)) errors.push(`dependency ${d.from} → ${d.to}: unknown SSC`);
    if (!DEP_TYPES.has(d.type)) errors.push(`dependency ${d.from} → ${d.to}: type ${d.type}`);
    if (!d.facts?.length) errors.push(`dependency ${d.from} → ${d.to} has no source fact`);
    for (const f of d.facts || []) if (!factIds.has(f)) errors.push(`dependency ${d.from} → ${d.to}: unknown fact ${f}`);
  }
  for (const f of Object.values(fac.facts)) {
    if (!fac.sources[f.source]) errors.push(`fact ${f.id}: unknown source ${f.source}`);
    if (!f.locator || !f.quote) errors.push(`fact ${f.id}: needs a locator and the quoted text`);
  }
  for (const fn of fac.functions) for (const t of fn.trains) for (const c of t.components) if (!ids.has(c)) errors.push(`function ${fn.id} train ${t.id}: unknown component ${c}`);
  return errors;
}

/** Phase 1 support system from the facility: "requires" edges only (fail-safe edges never defeat). */
export function facilitySupportSystem(fac) {
  const kind = new Map(fac.ssc.map((s) => [s.id, s.kind]));
  const req = new Map();
  for (const d of fac.dependencies) if (d.type === "requires") { if (!req.has(d.from)) req.set(d.from, []); req.get(d.from).push(d.to); }
  const sys = { functions: {}, trains: {}, components: {}, supports: {} };
  const excluded = [];
  const compIds = new Set();
  for (const fn of fac.functions) {
    for (const t of fn.trains) {
      sys.trains[t.id] = { function: fn.id, components: t.components };
      for (const c of t.components) { compIds.add(c); sys.components[c] = { train: t.id, requires: [...(req.get(c) || [])], anyOf: [] }; }
    }
    if (Number.isInteger(fn.successCriterion?.k)) sys.functions[fn.id] = { name: fn.name, trains: fn.trains.map((t) => t.id), successCriterion: { k: fn.successCriterion.k } };
    else excluded.push({ function: fn.id, reason: `success criterion unknown (${fn.successCriterion?.gap || "no source"})` });
  }
  // supports = everything reachable through requires from a component
  const stack = [...compIds].flatMap((c) => req.get(c) || []);
  while (stack.length) {
    const s = stack.pop();
    if (sys.supports[s] || compIds.has(s)) continue;
    sys.supports[s] = { supportKind: SUPPORT_KIND[kind.get(s)] || "structure", requires: [...(req.get(s) || [])], anyOf: [] };
    stack.push(...(req.get(s) || []));
  }
  // trains of functions excluded from k-of-n stay in sys.trains (for the all-trains check) but are not in sys.functions
  return { sys, excluded };
}

/** Supports whose loss defeats every train of a function (any success criterion). */
export function allTrainSupports(fac, sys) {
  const out = [];
  for (const fn of fac.functions) {
    for (const sid of Object.keys(sys.supports).sort()) {
      const r = propagate({ ...sys, functions: {} }, new Set([sid]));
      if (fn.trains.every((t) => r.trains.has(t.id))) out.push({ function: fn.id, support: sid, trains: fn.trains.length, successCriterion: fn.successCriterion.k ?? "unknown", path: r.trainPath(fn.trains[0].id).map((p) => p.id).join(" → ") });
    }
  }
  return out;
}

function closure(fac, from, types) {
  const out = new Map(); // dependent → type of first link reached
  const rev = new Map();
  for (const d of fac.dependencies) if (types.includes(d.type)) { if (!rev.has(d.to)) rev.set(d.to, []); rev.get(d.to).push(d); }
  const stack = [from];
  while (stack.length) {
    const x = stack.pop();
    for (const d of rev.get(x) || []) if (!out.has(d.from)) { out.set(d.from, d.type); stack.push(d.from); }
  }
  return out;
}

const moduleOf = (id) => { const m = /^M(\d+):/.exec(id); return m ? Number(m[1]) : null; };

/** Shared-SSC exposure and fail-safe actuation reach. */
export function sharedExposure(fac) {
  const fnByComp = new Map();
  for (const fn of fac.functions) for (const t of fn.trains) for (const c of t.components) fnByComp.set(c, fn.id);
  const rows = [];
  for (const s of fac.ssc.filter((x) => x.scope === "shared")) {
    const defeat = closure(fac, s.id, ["requires"]);
    const actuate = new Map([...fac.dependencies.filter((d) => d.to === s.id && d.type === "fail-safe").map((d) => [d.from, "fail-safe"])]);
    // fail-safe reach also follows into components through an intermediate (e.g. power → MPS → valves)
    for (const [x] of [...actuate]) for (const d of fac.dependencies) if (d.to === x && d.type === "fail-safe") actuate.set(d.from, "fail-safe");
    const fnsDefeatedPaths = [...new Set([...defeat.keys()].map((c) => fnByComp.get(c)).filter(Boolean))].sort();
    const fnsActuated = [...new Set([...actuate.keys()].map((c) => fnByComp.get(c)).filter(Boolean))].sort();
    const mods = (ids) => [...new Set(ids.map(moduleOf).filter((m) => m != null))].sort((a, b) => a - b);
    rows.push({
      ssc: s.id, name: s.name, kind: s.kind,
      dependents: [...defeat.keys()].length,
      modulesWhoseFunctionsItSupports: mods(fnsDefeatedPaths),
      functionsWithATrainDependingOnIt: fnsDefeatedPaths,
      functionsActuatedOnItsLoss: fnsActuated,
      modulesActuatedOnItsLoss: mods(fnsActuated),
    });
  }
  return rows;
}

/** Phase 2 link: fault tree per function, cut sets, data availability; LOOP event tree structure. */
export function phase2Link(sys, { functionId, maxOrder = 2 } = {}) {
  const ft = buildFaultTree(sys);
  const top = ft.tops[functionId];
  const cutSets = minimalCutSets(ft, top, { maxOrder });
  const basics = [...new Set(cutSets.flat())].sort();
  const withData = basics.filter((b) => COMPONENT_DATA[b]);
  return {
    function: functionId, top, cutSets, basicEvents: basics,
    quantified: false,
    blockedBy: basics.filter((b) => !withData.includes(b)).map((b) => ({ event: b, reason: "no sourced failure-data row is mapped to this basic event (G-reliability)" })),
    eventTree: {
      initiator: "PO.LOOP", frequency: { mean: INITIATOR_DATA["PO.LOOP"].mean, unit: INITIATOR_DATA["PO.LOOP"].unit, source: INITIATOR_DATA["PO.LOOP"].source, locator: INITIATOR_DATA["PO.LOOP"].locator },
      headers: [{ id: "DHR", gate: top, label: `${functionId} (1 of 2 DHRS trains)` }],
      sequences: [{ id: "S1", path: { DHR: "S" }, endState: "OK" }, { id: "S2", path: { DHR: "F" }, endState: "DHR-lost (ECCS / pool path not credited in this skeleton)" }],
      sequenceFrequencies: null,
      note: "structure only: the header's failure probability needs data for every basic event in its cut sets; none is available, so no sequence frequency is computed",
    },
  };
}

/**
 * Run the Phase 3 screen on a facility (e.g. buildUS600Facility()). Returns the report: validation, the support
 * system, Phase 1 runs with receipts, cross-system checks, Phase 2 link, requirements, review queue, banner.
 */
export function runFacilityScreen(fac, { at = "2026-10-10T00:00:00Z", caseId = "SC-FACILITY" } = {}) {
  const errors = validateFacility(fac);
  if (errors.length) return { ok: false, errors, banner: BANNER };
  const { sys, excluded } = facilitySupportSystem(fac);
  const kOfN = { ...sys, trains: Object.fromEntries(Object.entries(sys.trains).filter(([, t]) => sys.functions[t.function])) };
  const sysErrors = validateSystem(kOfN);
  if (sysErrors.length) return { ok: false, errors: sysErrors, banner: BANNER };
  const ir = systemToIR(kOfN, caseId, { name: `${fac.design.name}: facility support graph (screening)`, designId: `${fac.design.id}-facility`, designName: `${fac.design.name} facility skeleton (screening)` });
  const loop = iterateToPhysical(ir, {});
  if (!loop.ok) return { ok: false, errors: loop.errors, banner: BANNER };
  const runs = loop.report.checks.filter((c) => c.solver?.startsWith("safety."));
  const receipt = loop.report.receipt.sha256;
  const independence = independenceScreen(kOfN);
  const allTrain = allTrainSupports(fac, sys);
  const shared = sharedExposure(fac);
  const firstDhr = fac.functions.find((f) => Number.isInteger(f.successCriterion?.k));
  const p2 = firstDhr ? phase2Link(kOfN, { functionId: firstDhr.id }) : null;
  // loss of a fail-safe support defeats nothing in the support graph (it is not a "requires" edge): checked, not assumed
  const failSafeSupports = [...new Set(fac.dependencies.filter((d) => d.type === "fail-safe").map((d) => d.to))].sort();
  const failSafeCheck = failSafeSupports.map((s) => ({ support: s, trainsDefeated: sys.supports[s] ? [...propagate({ ...sys, functions: {} }, new Set([s])).trains] : [], inSupportGraphAsRequirement: Boolean(sys.supports[s]) }));

  const ref = (id) => regRef(id);
  const dhrIds = fac.functions.filter((f) => Number.isInteger(f.successCriterion?.k)).map((f) => f.id);
  const reqs = [
    makeRequirement({
      id: "R-FAC-DHR-SF", text: "Each module's decay heat removal function shall remain available after any single failure of a component or support item in its declared support graph.",
      textNote: "Screening requirement written for this skeleton; not regulatory text. Regulatory locators below are context.",
      source: [ref("gdc-34"), ref("10cfr50-appA-single-failure")],
      implementation: { nodes: dhrIds },
      analysis: dhrIds.map((id) => ({ runId: `safety.single-failure@${id}`, receiptSha256: receipt })),
      acceptanceCriterion: { statement: `No order-1 minimal cut set for loss of ${dhrIds[0]} in the declared support graph.`, metric: { runId: `safety.single-failure@${dhrIds[0]}`, output: "cutSetsOrder1", comparator: "==", value: 0 }, source: [ref("10cfr50-appA-single-failure")] },
      verification: { method: "analysis (screening) + independent engineering review", status: "pending" },
    }),
    makeRequirement({
      id: "R-FAC-XFN", text: "No single support item shall defeat the safety functions of more than one module.",
      textNote: "Screening requirement written for this skeleton (multi-module shared SSCs); not regulatory text.",
      source: [ref("ssr-2/1-req-24"), ref("ssr-2/1-req-21")],
      implementation: { nodes: [caseId] },
      analysis: [{ runId: `safety.cross-function@${caseId}`, receiptSha256: receipt }],
      acceptanceCriterion: { statement: "Zero cross-function findings in the declared support graph.", metric: { runId: `safety.cross-function@${caseId}`, output: "crossFunctionFindings", comparator: "==", value: 0 }, source: [ref("ssr-2/1-req-24")] },
      verification: { method: "analysis (screening) + independent engineering review", status: "pending" },
    }),
  ];
  const log = new ChangeLog();
  for (const r of reqs) {
    log.append({ at, actor: { name: "ConKay", kind: "tool" }, action: "create", target: r.id, change: { text: r.text, draft: true } });
    log.append({ at, actor: { name: "ConKay", kind: "tool" }, action: "link-analysis", target: r.id, change: r.analysis });
  }
  for (const r of reqs) r.history = { head: log.head(), entries: log.for(r.id).length };
  const ctx = { nodeIds: new Set(ir.nodes.map((n) => n.id)), runIds: new Set(runs.map((c) => c.runId)), receipts: new Set([receipt]) };
  const requirements = reqs.map((r) => ({ record: r, status: requirementStatus(r, runs, ctx) }));

  // Findings on shared passive SSCs (structures, the heat sink) are classified, not judged: the single-failure
  // definition treats active and passive failures differently, and how a passive shared structure is credited is
  // an engineering and regulatory disposition (10 CFR 50 App. A, "Single failure", quoted in sources.js).
  const passiveKinds = new Set(["structure", "ultimate-heat-sink"]);
  const kindOf = new Map(fac.ssc.map((x) => [x.id, x.kind]));
  const findingSupports = [...new Set([...independence.map((f) => f.support), ...allTrain.map((a) => a.support)])].sort();
  const dispositions = findingSupports.map((sid) => ({
    support: sid, sscKind: kindOf.get(sid), passive: passiveKinds.has(kindOf.get(sid)),
    class: passiveKinds.has(kindOf.get(sid)) ? "shared-passive-ssc: common-cause candidate (structural / inventory loss); treatment under the single-failure criterion is an engineering disposition" : "active or support item: single-failure finding",
    source: ref("10cfr50-appA-single-failure"),
    decision: "pending_human_review",
  }));
  const reviewQueue = [
    ...dispositions.map((d) => ({ kind: "finding-disposition", id: `D-${d.support}`, item: d.support, detail: d.class, decision: d.decision })),
    ...fac.conflicts.map((c) => ({ kind: "source-conflict", id: c.id, item: c.subject, detail: c.disposition, decision: c.decision })),
    ...fac.gaps.map((g) => ({ kind: "gap", id: g.id, item: g.item, detail: `${g.where}; effect: ${g.effect}`, decision: "pending_human_review" })),
    ...excluded.map((e) => ({ kind: "excluded-from-k-of-n", id: e.function, item: e.function, detail: e.reason, decision: "pending_human_review" })),
    ...allTrain.filter((a) => a.successCriterion === "unknown").slice(0, 1).map(() => ({ kind: "note", id: "ECCS-all-trains", item: "ECCS", detail: "screened for supports shared by every valve train (valid for any success criterion)", decision: "pending_human_review" })),
  ];
  return {
    ok: true, banner: BANNER, version: FACILITY_VERSION, design: fac.design,
    counts: { ssc: fac.ssc.length, dependencies: fac.dependencies.length, functions: fac.functions.length, facts: Object.keys(fac.facts).length, sources: Object.keys(fac.sources).length },
    supportSystem: { supports: Object.keys(sys.supports).sort(), excludedFromKofN: excluded },
    phase1: { runs: runs.map((c) => ({ runId: c.runId, engineStatus: c.status, failures: c.failures?.length ?? 0 })), receipt, independence },
    crossSystem: { allTrainSupports: allTrain, sharedExposure: shared, failSafe: failSafeCheck, dispositions },
    phase2: p2,
    requirements,
    changeLog: { entries: log.entries(), verification: verifyChain(log.entries()) },
    reviewQueue,
  };
}

/** Markdown summary of a facility screen (for the lens action and reviewers). */
export function renderFacilityMarkdown(r) {
  const L = [`# ${r.design.name}: facility skeleton screen`, "", `> ${r.banner}`, ""];
  L.push(`${r.counts.ssc} SSCs, ${r.counts.dependencies} sourced dependencies, ${r.counts.functions} safety functions, ${r.counts.facts} quoted facts from ${r.counts.sources} public sources. Receipt \`${r.phase1.receipt.slice(0, 16)}…\`.`, "");
  L.push("## Phase 1 screen (support graph)", "", ...r.phase1.runs.map((x) => `- ${x.runId}: ${x.failures} finding(s)`), "");
  L.push("## Cross-system checks", "", "Supports shared by every train of a function (any success criterion):", ...r.crossSystem.allTrainSupports.map((a) => `- ${a.function} ← ${a.support} (${a.path}); success criterion ${a.successCriterion}`).slice(0, 40), "");
  L.push("Shared SSCs:", ...r.crossSystem.sharedExposure.map((x) => `- ${x.ssc} (${x.name}): functions depending on it in ${x.modulesWhoseFunctionsItSupports.length} module(s); its loss actuates functions in ${x.modulesActuatedOnItsLoss.length} module(s)`), "");
  L.push("Dispositions needed:", ...r.crossSystem.dispositions.map((d) => `- ${d.support}: ${d.class} (${d.decision})`), "");
  if (r.phase2) L.push("## Phase 2 link", "", `Cut sets of ${r.phase2.function}: ${r.phase2.cutSets.map((c) => `{${c.join(", ")}}`).join(" ")}. Quantified: no (${r.phase2.blockedBy.length} basic events without a sourced data row). LOOP event tree: ${r.phase2.eventTree.note}.`, "");
  L.push("## Requirements", "", ...r.requirements.map((q) => `- ${q.status.id}: ${q.status.status}; missing ${q.status.missing.map((m) => m.field).join(", ") || "none"}`), "");
  L.push("## Review queue", "", ...r.reviewQueue.map((q) => `- [${q.kind}] ${q.item}: ${q.detail} (${q.decision})`), "");
  return L.join("\n");
}
