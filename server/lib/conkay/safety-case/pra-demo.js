// server/lib/conkay/safety-case/pra-demo.js
//
// Phase 2 demo: fault trees and event trees for a TOY two-division plant
// (not a NuScale model, not any real plant): loss of offsite power (LOOP) and
// loss of condenser heat sink (LOCHS), with secondary-side decay heat removal
// by auxiliary feedwater (two motor-driven pump trains, one turbine-driven).
// Every basic event is a NUREG/CR-6928 2020 Update data row; the initiating
// events are its Table 4 rows; the beta factors are the CCF 2020 Update alpha2
// values. The architecture (what depends on what) and the mission time are the
// toy's design choices, listed as assumptions; everything not modelled is a
// listed gap. The output is a screening calculation for review, never a risk
// or safety determination.

import { BANNER, screeningStatus } from "./vocabulary.js";
import { DATA_SOURCES, COMPONENT_DATA, INITIATOR_DATA, CCF_DATA, dataClaim } from "./reliability-data.js";
import { eventTree, modelProbabilities, meanParams, monteCarlo, importance, betaFactor, PRA_VERSION } from "./pra.js";
import { buildBdd } from "./bdd.js";

export const MISSION_HOURS = 24;

const T = MISSION_HOURS;
const E = (id, data, hours) => ({ id, data, ...(hours ? { hours } : {}) });

export const DEMO_EVENTS = Object.freeze([
  ...["A", "B"].flatMap((d) => [
    E(`EDG_${d}_FTS`, "EDG-FTS"), E(`EDG_${d}_FTLR`, "EDG-FTLR", 1), E(`EDG_${d}_FTR`, "EDG-FTR", T - 1),
    E(`BUS_AC_${d}`, "BUS-FTOP-AC", T), E(`BAT_${d}`, "BAT-FTOP", T), E(`BUS_DC_${d}`, "BUS-FTOP-DC", T),
    E(`MDP_${d}_FTS`, "MDP-FTS-NS"), E(`MDP_${d}_FTR1`, "MDP-FTR<1H", 1), E(`MDP_${d}_FTR2`, "MDP-FTR>1H", T - 1),
    E(`CKV_${d}`, "CKV-FTO"),
  ]),
  E("TDP_FTS", "TDP-FTS-NS-AFW"), E("TDP_FTR1", "TDP-FTR<1H-AFW", 1), E("TDP_FTR2", "TDP-FTR>1H-AFW", T - 1), E("CKV_T", "CKV-FTO"),
]);

export const DEMO_CCF = Object.freeze([
  { id: "CCF_EDG_FTS", members: ["EDG_A_FTS", "EDG_B_FTS"], ccf: "EPS-EDG-FS" },
  { id: "CCF_EDG_LR", members: ["EDG_A_FTLR", "EDG_B_FTLR"], ccf: "EPS-EDG-LR" },
  { id: "CCF_EDG_FR", members: ["EDG_A_FTR", "EDG_B_FTR"], ccf: "EPS-EDG-FR" },
  { id: "CCF_MDP_FS", members: ["MDP_A_FTS", "MDP_B_FTS"], ccf: "AFW-MDP-FS" },
]);

const or = (...inputs) => ({ type: "or", inputs });
const and = (...inputs) => ({ type: "and", inputs });

/** Support gates shared by both conditions. */
function common() {
  const g = {};
  for (const d of ["A", "B"]) {
    g[`DC_${d}`] = or(`BAT_${d}`, `BUS_DC_${d}`);
    g[`MDP_${d}_TRAIN`] = or(`MDP_${d}_FTS`, `MDP_${d}_FTR1`, `MDP_${d}_FTR2`, `CKV_${d}`, `AC_${d}`);
  }
  g.TDP_TRAIN = or("TDP_FTS", "TDP_FTR1", "TDP_FTR2", "CKV_T", "DC_A");
  g.AFW = and("MDP_A_TRAIN", "MDP_B_TRAIN", "TDP_TRAIN");
  return g;
}

/** Offsite power lost (LOOP): each division's AC comes from its EDG, which needs its DC for start and control. */
export function loopGates() {
  const g = common();
  for (const d of ["A", "B"]) {
    g[`EDG_${d}`] = or(`EDG_${d}_FTS`, `EDG_${d}_FTLR`, `EDG_${d}_FTR`, `DC_${d}`);
    g[`AC_${d}`] = or(`EDG_${d}`, `BUS_AC_${d}`);
  }
  g.EPS = and("AC_A", "AC_B");
  return betaFactor({ gates: g }, DEMO_CCF).ft.gates;
}

/** Offsite power available (LOCHS): each division's AC comes from offsite through its bus. */
export function lochsGates() {
  const g = common();
  for (const d of ["A", "B"]) g[`AC_${d}`] = or(`BUS_AC_${d}`);
  return betaFactor({ gates: g }, DEMO_CCF.filter((c) => c.ccf === "AFW-MDP-FS")).ft.gates;
}

export const LOOP_ET = Object.freeze({
  id: "ET-LOOP", initiator: "PO.LOOP",
  headers: [{ id: "EPS", gate: "EPS", label: "Emergency AC (1 of 2 EDG divisions)" }, { id: "AFW", gate: "AFW", label: "Auxiliary feedwater (1 of 3 pump trains)" }],
  sequences: [
    { id: "L1", path: { EPS: "S", AFW: "S" }, endState: "OK" },
    { id: "L2", path: { EPS: "S", AFW: "F" }, endState: "LDHR" },
    { id: "L3", path: { EPS: "F", AFW: "S" }, endState: "SBO-TDP" },
    { id: "L4", path: { EPS: "F", AFW: "F" }, endState: "LDHR" },
  ],
});

export const LOCHS_ET = Object.freeze({
  id: "ET-LOCHS", initiator: "LOCHS PWR FI",
  headers: [{ id: "AFW", gate: "AFW", label: "Auxiliary feedwater (1 of 3 pump trains)" }],
  sequences: [
    { id: "H1", path: { AFW: "S" }, endState: "OK" },
    { id: "H2", path: { AFW: "F" }, endState: "LDHR" },
  ],
});

export const END_STATES = Object.freeze({
  OK: "decay heat removed by AFW for the mission time (toy success criterion)",
  LDHR: "loss of secondary-side decay heat removal (screening end state: feed-and-bleed, offsite-power recovery and operator actions are not modelled, so this is not a core-damage frequency)",
  "SBO-TDP": "station blackout with the turbine-driven AFW pump running; unresolved: battery depletion and offsite-power recovery are not modelled",
});

export const DEMO_ASSUMPTIONS = Object.freeze([
  `Mission time ${T} h (analysis choice): run failures over the first hour use the <1H rates, the rest the >1H rates; buses and batteries over the whole mission.`,
  "Toy architecture (design choice, not a plant): two AC/DC divisions; each EDG needs its division's DC for start and control; each MDP needs its division's AC; the TDP's control is on DC division A.",
  "AFW success: any 1 of the 3 pump trains with its check valve; no flow-path, suction-source or steam-supply failures.",
  "Beta-factor model for groups of 2: P(member independent) = (1 - β) Q and P(common cause) = β Q, Q = the NUREG/CR-6928 component unreliability, β = the CCF 2020 Update alpha2 (equal to its MGL Beta at CCCG = 2).",
  "Basic events are independent apart from the explicit common-cause events; the exact (BDD) probabilities assume this.",
  "Uncertainty: every data parameter sampled from its published distribution, one draw per data key per trial (identical components share the draw: state-of-knowledge correlation).",
]);

export const DEMO_GAPS = Object.freeze([
  "Test and maintenance unavailability (NUREG/CR-6928 2020 Table 2) not modelled: its distributions are printed as normal with negative lower bounds; a truncation would be an analyst choice not made here.",
  "Offsite-power recovery, battery depletion (DC coping time) and EDG/room cooling support systems not modelled.",
  "Feed-and-bleed, operator actions and human reliability not modelled.",
  "Common cause modelled only for EDG start / load-run / run and AFW MDP start; pump run, check valves, batteries and buses have no CCF events.",
  "NUREG-0492 three-motor example: not reproduced; the handbook PDF could not be retrieved in this session (nrc.gov refuses scripted download), and its tree and numbers are not transcribed from memory.",
]);

function quantifyEt(et, gates, params) {
  const p = modelProbabilities({ events: DEMO_EVENTS, ccf: et === LOOP_ET ? DEMO_CCF : DEMO_CCF.filter((c) => c.ccf === "AFW-MDP-FS") }, params);
  return eventTree(et, gates, p, params[et.initiator]);
}

/** Run the demo: point estimates, uncertainty, importance and the data trail. */
export function runPraDemo({ samples = 4000, seed = "conkay-pra-demo" } = {}) {
  const lg = loopGates(), hg = lochsGates();
  const keys = [...new Set([...DEMO_EVENTS.map((e) => e.data), ...DEMO_CCF.map((c) => c.ccf), "PO.LOOP", "LOCHS PWR FI"])].sort();
  const mean = meanParams({ events: DEMO_EVENTS, ccf: DEMO_CCF, initiators: ["PO.LOOP", "LOCHS PWR FI"] });
  const loop = quantifyEt(LOOP_ET, lg, mean);
  const lochs = quantifyEt(LOCHS_ET, hg, mean);

  const pLoop = modelProbabilities({ events: DEMO_EVENTS, ccf: DEMO_CCF }, mean);
  const pLochs = modelProbabilities({ events: DEMO_EVENTS, ccf: DEMO_CCF.filter((c) => c.ccf === "AFW-MDP-FS") }, mean);
  const imp = {
    "EPS|LOOP": importance({ gates: lg }, "EPS", pLoop, { built: buildBdd(lg, ["EPS"]) }),
    "AFW|LOOP": importance({ gates: lg }, "AFW", pLoop, { built: buildBdd(lg, ["AFW"]) }),
    "AFW|LOCHS": importance({ gates: hg }, "AFW", pLochs, { built: buildBdd(hg, ["AFW"]) }),
  };
  const ccfShare = Object.fromEntries(Object.entries(imp).map(([k, v]) => [k, v.measures.filter((m) => m.event.startsWith("CCF_")).map((m) => ({ event: m.event, fussellVesely: m.fussellVesely }))]));

  const uncertainty = monteCarlo(keys, (params) => {
    const a = quantifyEt(LOOP_ET, lg, params), b = quantifyEt(LOCHS_ET, hg, params);
    return { "LOOP:LDHR": a.endStates.LDHR, "LOOP:SBO-TDP": a.endStates["SBO-TDP"], "LOCHS:LDHR": b.endStates.LDHR, "LDHR (both initiators)": a.endStates.LDHR + b.endStates.LDHR };
  }, { n: samples, seed });

  const data = keys.map((k) => {
    const c = dataClaim(k);
    return { key: k, description: c.description, distribution: c.dist, mean: c.mean, p5: c.p5, p95: c.p95, unit: c.unit || (COMPONENT_DATA[k]?.kind === "rate" ? "1/h" : "per demand"), source: c.source, locator: c.locator, note: c.note || null };
  });
  const findings = [
    ...["LOOP:LDHR", "LOCHS:LDHR"].map((k) => ({ kind: "end-state", key: k, mean: uncertainty[k].mean, p05: uncertainty[k].p05, p95: uncertainty[k].p95 })),
  ];
  return {
    ok: true,
    banner: BANNER,
    status: screeningStatus("needs_review"),
    version: PRA_VERSION,
    plant: "toy two-division PWR-like decay-heat-removal model (not a real plant, not NuScale)",
    missionHours: T,
    eventTrees: { loop, lochs },
    endStateDefinitions: END_STATES,
    importance: Object.fromEntries(Object.entries(imp).map(([k, v]) => [k, { top: v.top, measures: v.measures.slice(0, 12) }])),
    importanceDefinitions: imp["EPS|LOOP"].definitions,
    commonCauseContribution: ccfShare,
    uncertainty,
    findings,
    data,
    sources: DATA_SOURCES,
    assumptions: DEMO_ASSUMPTIONS,
    gaps: DEMO_GAPS,
    signOffs: ["model review by a qualified PRA analyst", "data applicability review (NUREG/CR-6928 industry averages vs the design)", "success criteria and mission time review"],
  };
}

const sci = (x) => (Number.isFinite(x) ? x.toExponential(2) : String(x));

export function renderPraMarkdown(r) {
  const et = (e) => [
    `### ${e.id} (initiator ${e.initiator}: ${sci(e.initiatorFrequency)} /rcry, mean)`,
    "",
    "| sequence | path | end state | conditional probability | frequency /rcry (exact) | ignoring shared supports and success branches |",
    "|---|---|---|---|---|---|",
    ...e.sequences.map((s) => `| ${s.id} | ${Object.entries(s.path).map(([h, b]) => `${h}:${b}`).join(" ")} | ${s.endState} | ${sci(s.conditionalProbability)} | ${sci(s.frequency)} | ${sci(s.ignoringDependenceAndSuccess)} |`),
    "",
    `Sequences partition the outcomes: conditional probabilities sum to ${e.partitionSum.toFixed(12)}.`,
    "",
  ];
  return [
    `# ConKay PRA screening demo (Phase 2)`,
    "",
    `> ${r.banner}`,
    "",
    `Status: ${r.status}. Model: ${r.plant}. Mission time ${r.missionHours} h.`,
    "",
    "## Event trees (point estimates at the data means)",
    ...et(r.eventTrees.loop),
    ...et(r.eventTrees.lochs),
    "## Uncertainty (seeded Monte Carlo over every data parameter)",
    "| output | mean | 5th | median | 95th | n |",
    "|---|---|---|---|---|---|",
    ...Object.entries(r.uncertainty).map(([k, u]) => `| ${k} | ${sci(u.mean)} | ${sci(u.p05)} | ${sci(u.p50)} | ${sci(u.p95)} | ${u.n} |`),
    "",
    "## Importance (exact, from the BDD)",
    ...Object.entries(r.importance).flatMap(([k, v]) => [
      `### ${k} (P = ${sci(v.top)})`,
      "| event | FV | RAW | RRW | Birnbaum |",
      "|---|---|---|---|---|",
      ...v.measures.map((m) => `| ${m.event} | ${m.fussellVesely.toFixed(4)} | ${sci(m.raw)} | ${Number.isFinite(m.rrw) ? m.rrw.toFixed(3) : "inf"} | ${sci(m.birnbaum)} |`),
      "",
    ]),
    "## End states",
    ...Object.entries(r.endStateDefinitions).map(([k, v]) => `- ${k}: ${v}`),
    "",
    "## Data (every value sourced)",
    ...r.data.map((d) => `- ${d.key}: ${d.description}; ${d.distribution.type}(${d.distribution.alpha}, ${d.distribution.beta}), mean ${sci(d.mean)} ${d.unit}; ${d.locator}${d.note ? `. ${d.note}` : ""}`),
    "",
    ...Object.values(r.sources).map((s) => `- ${s.title}, ${s.report}. ${s.url} (sha256 ${s.sha256}, retrieved ${s.retrieved})`),
    "",
    "## Assumptions",
    ...r.assumptions.map((a) => `- ${a}`),
    "",
    "## Gaps (not modelled)",
    ...r.gaps.map((g) => `- ${g}`),
    "",
    "## Sign-offs needed (people, not ConKay)",
    ...r.signOffs.map((s) => `- ${s}`),
    "",
  ].join("\n");
}

export { CCF_DATA, INITIATOR_DATA };
