// server/lib/conkay/safety-case/demo.js
//
// Phase 1 demo: a GENERIC two-function, two-train-per-function support
// graph (illustrative only; not any real plant design and not derived from
// one). The design of record deliberately wires both B-train valves to the
// A-train DC bus (DC-BUS-1), so one DC bus feeds every train of both
// functions. ConKay must find it, show the path, and PROPOSE separating the
// DC buses per train, re-analysed, as proposals pending a human decision.
// It never writes the proposal into the design of record.

import { iterateToPhysical } from "../iterate/loop.js";
import { sha256 } from "../iterate/receipt.js";
import { makeRequirement, requirementStatus } from "./requirement.js";
import { ChangeLog, verifyChain } from "./change-log.js";
import { regRef } from "./sources.js";
import { BANNER, PROPOSAL_STATUS } from "./vocabulary.js";
import { BENCHMARKS, minimalCutSets, quantify } from "./fault-tree.js";
import "./solvers.js";

export const CASE_ID = "SC-DEMO";
const TOOL = { name: "ConKay", kind: "tool" };

export function demoSystem() {
  return {
    functions: {
      "SF-DHR": { name: "Decay heat removal (generic)", trains: ["DHR-A", "DHR-B"], successCriterion: { k: 1 } },
      "SF-ECCS": { name: "Emergency core cooling actuation (generic, ECCS-style)", trains: ["ECCS-A", "ECCS-B"], successCriterion: { k: 1 } },
    },
    trains: {
      "DHR-A": { function: "SF-DHR", components: ["DHR-A-VALVE", "DHR-A-HX"] },
      "DHR-B": { function: "SF-DHR", components: ["DHR-B-VALVE", "DHR-B-HX"] },
      "ECCS-A": { function: "SF-ECCS", components: ["ECCS-A-VALVE"] },
      "ECCS-B": { function: "SF-ECCS", components: ["ECCS-B-VALVE"] },
    },
    components: {
      "DHR-A-VALVE": { train: "DHR-A", dcBus: "DC-BUS-1", requires: ["IC-CH-A", "ROOM-A"] },
      "DHR-A-HX": { train: "DHR-A", requires: ["COOL-A", "ROOM-A"] },
      "DHR-B-VALVE": { train: "DHR-B", dcBus: "DC-BUS-1", requires: ["IC-CH-B", "ROOM-B"] }, // deliberate fault: should be DC-BUS-2
      "DHR-B-HX": { train: "DHR-B", requires: ["COOL-B", "ROOM-B"] },
      "ECCS-A-VALVE": { train: "ECCS-A", dcBus: "DC-BUS-1", requires: ["IC-CH-A", "ROOM-A"] },
      "ECCS-B-VALVE": { train: "ECCS-B", dcBus: "DC-BUS-1", requires: ["IC-CH-B", "ROOM-B"] }, // deliberate fault: should be DC-BUS-2
    },
    supports: {
      "OFFSITE": { supportKind: "offsite-power" },
      "EDG-1": { supportKind: "emergency-generator", requires: ["ROOM-EDG-1"] },
      "EDG-2": { supportKind: "emergency-generator", requires: ["ROOM-EDG-2"] },
      "ROOM-EDG-1": { supportKind: "room-fire-area" },
      "ROOM-EDG-2": { supportKind: "room-fire-area" },
      "AC-DIV-1": { supportKind: "ac-division", anyOf: ["OFFSITE", "EDG-1"] },
      "AC-DIV-2": { supportKind: "ac-division", anyOf: ["OFFSITE", "EDG-2"] },
      "BATT-1": { supportKind: "battery" },
      "BATT-2": { supportKind: "battery" },
      "CHGR-1": { supportKind: "battery-charger", requires: ["AC-DIV-1"] },
      "CHGR-2": { supportKind: "battery-charger", requires: ["AC-DIV-2"] },
      "DC-BUS-1": { supportKind: "dc-bus", anyOf: ["BATT-1", "CHGR-1"] },
      "DC-BUS-2": { supportKind: "dc-bus", anyOf: ["BATT-2", "CHGR-2"] },
      "HVAC-A": { supportKind: "hvac", requires: ["AC-DIV-1"] },
      "HVAC-B": { supportKind: "hvac", requires: ["AC-DIV-2"] },
      "IC-CH-A": { supportKind: "ic-channel", requires: ["HVAC-A"] },
      "IC-CH-B": { supportKind: "ic-channel", requires: ["HVAC-B"] },
      "COOL-A": { supportKind: "cooling", requires: ["AC-DIV-1"] },
      "COOL-B": { supportKind: "cooling", requires: ["AC-DIV-2"] },
      "ROOM-A": { supportKind: "room-fire-area" },
      "ROOM-B": { supportKind: "room-fire-area" },
    },
  };
}

/** Plain system → design IR (one node per function, train, component, support; one case node). */
export function systemToIR(sys, caseId = CASE_ID, { name = "Generic two-function demo (not a real plant)", designId = "safety-case-demo", designName = "ConKay nuclear Phase 1 demo (generic)" } = {}) {
  const nodes = [{ id: caseId, kind: "SafetyCase", name, props: { safetyCase: true } }];
  for (const [id, f] of Object.entries(sys.functions)) nodes.push({ id, kind: "SafetyFunction", name: f.name, props: { trains: f.trains, successCriterion: f.successCriterion } });
  for (const [id, t] of Object.entries(sys.trains)) nodes.push({ id, kind: "SafetyTrain", props: { function: t.function, components: t.components } });
  for (const [id, c] of Object.entries(sys.components)) nodes.push({ id, kind: "SafetyComponent", props: { train: c.train, requires: c.requires || [], anyOf: c.anyOf || [], ...(c.dcBus ? { dcBus: c.dcBus } : {}) } });
  for (const [id, s] of Object.entries(sys.supports)) nodes.push({ id, kind: "SupportItem", props: { supportKind: s.supportKind, requires: s.requires || [], anyOf: s.anyOf || [] } });
  return {
    design: { id: designId, name: designName },
    nodes,
    // The success criteria are requirements: the loop may not touch them.
    locked: Object.keys(sys.functions).map((id) => ({ node: id, path: "props.successCriterion", reason: "safety-function success criterion (a requirement)" })),
  };
}

/**
 * Bounded design variables: which DC bus feeds each B-train valve. The
 * A-train feeds are fixed (Division 1 by the demo's design convention), so
 * only the B-train feed may move; the success criteria are locked.
 */
export function dcFeedVariables(sys, trains = ["DHR-B", "ECCS-B"]) {
  const buses = Object.entries(sys.supports).filter(([, s]) => s.supportKind === "dc-bus").map(([id]) => id).sort();
  return Object.entries(sys.components).filter(([, c]) => c.dcBus && trains.includes(c.train)).map(([id]) => ({
    id: `${id}.dcBus`, node: id,
    options: buses.map((b) => ({ label: b, set: { "props.dcBus": b } })),
  }));
}

function runsOf(list) { return list.filter((c) => c.solver?.startsWith("safety.")); }

export function runSafetyCaseDemo({ at = "2026-10-09T00:00:00Z", system = demoSystem() } = {}) {
  const ir = systemToIR(system);
  const irSha = sha256(ir);
  const loop = iterateToPhysical(ir, { designVariables: dcFeedVariables(system) });
  if (!loop.ok) return { ok: false, errors: loop.errors };
  const R = loop.report;
  if (sha256(ir) !== irSha) throw new Error("design of record was modified");
  const before = runsOf(R.initial);
  const after = runsOf(R.checks);
  const receipt = R.receipt.sha256;

  const findings = before.flatMap((c) => [...(c.outputs.commonCauseFindings?.value || []), ...(c.outputs.crossFunctionFindings?.value || [])]);
  const findingsAfter = after.flatMap((c) => [...(c.outputs.commonCauseFindings?.value || []), ...(c.outputs.crossFunctionFindings?.value || [])]);
  const cutSets = Object.fromEntries(before.filter((c) => c.solver === "safety.single-failure").map((c) => [c.target, { order1: c.outputs.cutSetsOrder1.value, order2: c.outputs.cutSetsOrder2.value }]));
  const cutSetsAfter = Object.fromEntries(after.filter((c) => c.solver === "safety.single-failure").map((c) => [c.target, { order1: c.outputs.cutSetsOrder1.value, order2: c.outputs.cutSetsOrder2.value }]));

  const log = new ChangeLog();
  const proposals = R.repairs.filter((x) => x.result === "accepted").map((x, i) => ({
    id: `P-${i + 1}`,
    change: { node: x.variable.replace(/\.dcBus$/, ""), path: "props.dcBus", from: x.before, to: x.after },
    rationale: `${x.failingRun}: FAIL → ${x.targetStatus}; re-ran ${x.rerun.length} dependent check(s), no new failures; separates the DC supply of train ${system.components[x.variable.replace(/\.dcBus$/, "")].train} from the other train`,
    status: PROPOSAL_STATUS,
    appliedToDesignOfRecord: false,
  }));

  const ref = (id) => regRef(id);
  const reqs = [
    makeRequirement({
      id: "R-SF-DHR-SF", text: "SF-DHR shall remain available after any single failure of a component or support item in its support graph.",
      textNote: "Demo requirement written for this generic example; not regulatory text. Regulatory locators below are context.",
      source: [ref("gdc-34"), ref("10cfr50-appA-single-failure"), ref("ssr-2/1-req-25")],
      implementation: { nodes: ["SF-DHR", "DHR-A", "DHR-B", "DHR-A-VALVE", "DHR-A-HX", "DHR-B-VALVE", "DHR-B-HX"] },
      analysis: [{ runId: "safety.single-failure@SF-DHR", receiptSha256: receipt }],
      acceptanceCriterion: { statement: "No order-1 minimal cut set for loss of SF-DHR in the declared support graph.", metric: { runId: "safety.single-failure@SF-DHR", output: "cutSetsOrder1", comparator: "==", value: 0 }, source: [ref("10cfr50-appA-single-failure")] },
      verification: { method: "analysis (screening) + independent engineering review", status: "pending" },
    }),
    makeRequirement({
      id: "R-SF-ECCS-SF", text: "SF-ECCS shall remain available after any single failure of a component or support item in its support graph.",
      textNote: "Demo requirement written for this generic example; not regulatory text. Regulatory locators below are context.",
      source: [ref("gdc-35"), ref("gdc-21"), ref("gdc-22"), ref("10cfr50-appA-single-failure")],
      implementation: { nodes: ["SF-ECCS", "ECCS-A", "ECCS-B", "ECCS-A-VALVE", "ECCS-B-VALVE"] },
      analysis: [{ runId: "safety.single-failure@SF-ECCS", receiptSha256: receipt }],
      acceptanceCriterion: { statement: "No order-1 minimal cut set for loss of SF-ECCS in the declared support graph.", metric: { runId: "safety.single-failure@SF-ECCS", output: "cutSetsOrder1", comparator: "==", value: 0 }, source: [ref("10cfr50-appA-single-failure"), ref("gdc-21")] },
      verification: { method: "analysis (screening) + independent engineering review", status: "pending" },
    }),
    makeRequirement({
      id: "R-DC-INDEP", text: "No single support item (DC bus, battery, charger, AC division, room/fire area, cooling, I&C channel, HVAC) shall defeat more than one safety function.",
      textNote: "Demo requirement written for this generic example; not regulatory text. Regulatory locators below are context.",
      source: [ref("gdc-17"), ref("srp-8.3.2"), ref("ssr-2/1-req-21"), ref("ssr-2/1-req-24")],
      implementation: { nodes: [CASE_ID, "DC-BUS-1", "DC-BUS-2"] },
      analysis: [{ runId: `safety.cross-function@${CASE_ID}`, receiptSha256: receipt }],
      acceptanceCriterion: { statement: "Zero cross-function findings in the declared support graph.", metric: { runId: `safety.cross-function@${CASE_ID}`, output: "crossFunctionFindings", comparator: "==", value: 0 }, source: [ref("gdc-17"), ref("ssr-2/1-req-24")] },
      verification: { method: "analysis (screening) + independent engineering review", status: "pending" },
    }),
  ];
  for (const r of reqs) {
    log.append({ at, actor: TOOL, action: "create", target: r.id, change: { text: r.text, draft: true } });
    log.append({ at, actor: TOOL, action: "link-analysis", target: r.id, change: r.analysis });
  }
  for (const p of proposals) log.append({ at, actor: TOOL, action: "propose", target: p.change.node, change: { proposal: p.id, ...p.change, status: p.status } });
  for (const r of reqs) r.history = { head: log.head(), entries: log.for(r.id).length };

  const nodeIds = new Set(ir.nodes.map((n) => n.id));
  const runIds = new Set(before.map((c) => c.runId));
  const ctx = { nodeIds, runIds, receipts: new Set([receipt]) };
  const requirements = reqs.map((r) => ({
    record: r,
    designOfRecord: requirementStatus(r, before, ctx),
    proposedDesign: requirementStatus(r, after, ctx),
  }));

  const signOffs = [
    ...reqs.flatMap((r) => requirementStatus(r, before, ctx).missing.filter((m) => ["owner", "reviewer", "verification"].includes(m.field)).map((m) => ({ item: r.id, needed: m.field, reason: m.reason }))),
    ...proposals.map((p) => ({ item: p.id, needed: "accept-proposal or reject-proposal", reason: `${p.change.node}: ${p.change.from} → ${p.change.to} is ${PROPOSAL_STATUS}; only a qualified engineer can accept it into the design of record` })),
  ];
  const openItems = [
    "Order-2 cut sets are listed, not judged: their significance needs component failure data (NUREG/CR-6928 family, Phase 2) and engineering judgement.",
    "The support graph is a generic, illustrative topology; it is not any real plant and not derived from one.",
    "Not modelled: timing (battery coping time), partial degradation, spurious actuation, operator actions, diversity, passive-failure exemptions, hazards (fire/flood/seismic) beyond the declared room/fire-area items.",
    "Requirement owners, reviewers and verification performers are unassigned: every requirement is incomplete until named qualified engineers take these roles.",
  ];

  const benchmarks = Object.entries(BENCHMARKS).map(([id, b]) => {
    const cs = minimalCutSets(b.ft, b.top);
    const q = b.probabilities ? quantify(cs, b.probabilities) : null;
    const same = JSON.stringify(cs.map((s) => [...s].sort()).sort()) === JSON.stringify(b.published.cutSets.map((s) => [...s].sort()).sort());
    return { id, title: b.title, cutSets: cs, published: b.published, cutSetsMatch: same, quantification: q };
  });

  return {
    ok: true,
    banner: BANNER,
    caseId: CASE_ID,
    designOfRecord: { irSha256: irSha, unchanged: sha256(ir) === irSha, note: "Proposals are evaluated on a copy; the design of record is never modified by ConKay." },
    findings,
    cutSets,
    proposals,
    reanalysis: { findingsAfter, cutSetsAfter, checksAfter: after.map((c) => ({ runId: c.runId, engineStatus: c.status })), checksBefore: before.map((c) => ({ runId: c.runId, engineStatus: c.status })) },
    requirements,
    signOffs,
    openItems,
    changeLog: { entries: log.entries(), verification: verifyChain(log.entries()) },
    loop: { converged: R.converged, iterations: R.iterations, repairs: R.repairs, requirementsUnchanged: R.requirementsUnchanged, receipt: R.receipt },
    benchmarks,
  };
}
