// server/lib/conkay/showcase/index.js
//
// The ConKay results page's data: the showcase designs (car, Sentinel M1,
// USB Blend D, methanol-water 40 vol%, NuScale US600 screening) each run
// through its real pipeline once, offline, and normalised into one snapshot
// shape the public page can render without solving anything on page load.
//
// Nothing here computes physics. Every number is copied from a solver
// envelope, a knowledge claim or a facility fact, with the status that record
// already carries (sourced / measured / computed / estimated / design /
// unknown) and the source it already cites. A value with no source stays
// unsourced; an unknown stays unknown.
//
// Build: `node scripts/build-conkay-showcase.mjs` (needs the OCC kernel for the
// car's CAD body and drawing). Served by routes/conkay-demo.js under the same
// no-login, GET-only, rate-limited pattern as the beam demo.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SHOWCASE_VERSION = "1.0.0";
export const SNAPSHOT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "snapshots");

/** Value statuses on the page, in display order. */
export const STATUSES = Object.freeze(["sourced", "measured", "computed", "estimated", "design", "unknown"]);
export const STATUS_MEANING = Object.freeze({
  sourced: "taken from a cited document (data sheet, standard, public record)",
  measured: "a third-party measurement, cited",
  computed: "computed by a ConKay solver from the inputs shown",
  estimated: "an estimate with a stated method and range",
  design: "a design choice or requirement input, not a claim about the world",
  unknown: "not known: no source, or not computed",
});

export const SCREENING_DISCLAIMER = "Software screening only. Passing software checks is not physical validation; every result below still needs the physical tests listed.";
export const NUCLEAR_DISCLAIMER = "Nuclear outputs are screening-only. Not a safety determination. Decisions and approvals belong to qualified engineers and regulators.";

export const SHOWCASE = Object.freeze([
  { id: "car", title: "Four-seat 180 mph car", kind: "vehicle", pipeline: "carAcceptanceAsync (CAD body, tub, aero build-up, drawings)" },
  { id: "sentinel-m1", title: "Sentinel M1 ground prototype", kind: "robot", pipeline: "runSentinelM1 (iterate-to-physical loop)" },
  { id: "usb-blend-d", title: "USB Blend D formulation", kind: "material", pipeline: "buildFormulationReport (knowledge layer)" },
  { id: "methanol-water", title: "Methanol-water, 40 vol%", kind: "mixture", pipeline: "mixtureReport (PubChem + NIST WebBook, recorded responses)" },
  { id: "nuscale-us600", title: "NuScale US600 facility screening", kind: "nuclear", pipeline: "runFacilityScreen + drawFacility (public NRC sources)" },
]);

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const r = (v, d = 4) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : v);
const str = (v) => (v == null ? null : String(v));

/** Read a status off a solver output's `status` / `basis` text. Default: computed (it is a solver output). */
export function statusFromBasis(basis, fallback = "computed") {
  const s = String(basis || "").trim().toLowerCase();
  if (!s) return fallback;
  if (/^(sourced|source|published|data sheet|datasheet)\b/.test(s) || s === "s") return "sourced";
  if (/^measured\b/.test(s)) return "measured";
  if (/^estimat/.test(s)) return "estimated";
  if (/^(design|given|requirement|assumed|derived from the design|d)\b/.test(s)) return "design";
  if (/^(unknown|not computed|placeholder)\b/.test(s)) return "unknown";
  if (/^(computed|model_output|derived|c)\b/.test(s)) return "computed";
  return fallback;
}

/** Map a knowledge-layer claim's status array onto the page's statuses. */
export function statusFromClaim(statuses = []) {
  const s = new Set(statuses);
  if (s.has("unknown") || s.has("hypothesis") || s.has("contradicted")) return "unknown";
  if (s.has("measured") || s.has("validated")) return "measured";
  if (s.has("sourced")) return "sourced";
  if (s.has("estimated")) return "estimated";
  if (s.has("computed") || s.has("simulated")) return "computed";
  return "unknown";
}

/** A mass state (verification/mass-state.js) as a page status; a third-party measurement is "measured". */
export function statusFromMassState(state, sourceKind) {
  if (state === "sourced") return sourceKind ? "measured" : "sourced";
  if (state === "placeholder") return "unknown";
  if (["requirement", "given", "design"].includes(state)) return "design";
  return STATUSES.includes(state) ? state : "unknown";
}

function marginRow(m) {
  return {
    check: str(m.check ?? m.name ?? m.id),
    demand: r(m.demand), capacity: r(m.capacity), unit: str(m.unit),
    utilization: r(m.utilization), marginPct: r(m.marginPct, 2),
  };
}

/** One solver envelope (graph-engine or iterate-loop shape) as a check row. */
export function checkRow(e) {
  const solver = typeof e.solver === "string" ? e.solver : e.solver?.id;
  return {
    runId: e.runId, solver, target: e.target ?? null, status: e.status,
    method: typeof e.solver === "object" ? str(e.solver.method)?.slice(0, 400) ?? null : null,
    reason: str(e.reason ?? e.error)?.slice(0, 400) ?? null,
    margins: (e.margins || []).map(marginRow),
    failures: (e.failures || []).map((f) => (typeof f === "string" ? f : f.message || f.reason || JSON.stringify(f))).slice(0, 6),
    warnings: (e.warnings || []).map((w) => (typeof w === "string" ? w : w.message || JSON.stringify(w))).slice(0, 6),
  };
}

export function countStatuses(checks) {
  const out = { PASS: 0, WARN: 0, FAIL: 0, NOT_COMPUTED: 0, ERROR: 0 };
  for (const c of checks) out[c.status] = (out[c.status] || 0) + 1;
  return out;
}

function claimValue(c, { group }) {
  const ev = (c.evidence || []).find((x) => x.url) || (c.evidence || [])[0] || null;
  const asserted = c.assertedBy ? { title: c.assertedBy.source, url: null, locator: c.assertedBy.locator, quote: c.assertedBy.quote } : null;
  const source = ev ? { title: ev.title || ev.sourceId || null, url: ev.url || null, locator: ev.locator || null, quote: ev.excerpt || null, retrieved: ev.retrieved || null } : asserted;
  const range = c.range ? { low: r(c.range.min), high: r(c.range.max) } : c.uncertainty?.low != null ? { low: r(c.uncertainty.low), high: r(c.uncertainty.high) } : null;
  return {
    id: c.id, group, name: c.property ? `${c.property.replace(/_/g, " ")}` : (c.statement || c.id),
    subject: str(c.subject), statement: str(c.statement),
    value: Number.isFinite(c.value) ? r(c.value, 6) : null, unit: str(c.unit), range,
    status: statusFromClaim(c.status), statusLabel: (c.status || []).join(", "), support: c.support ?? null,
    source, sourceRole: ev ? "evidence" : asserted ? "asserted by the source text (not evidence)" : null,
    method: c.method?.kind && c.method.kind !== "none" ? str(c.method.description) : null,
    note: [c.missingConditions?.length ? `missing conditions: ${c.missingConditions.join(", ")}` : null, ...(c.flags || [])].filter(Boolean).join("; ") || null,
  };
}

function massSummary({ totalKg, lowKg, highKg, byState, unknownCount = 0, notIncluded = [], note = null, limit = null }) {
  return { totalKg: r(totalKg, 2), bandKg: lowKg != null ? [r(lowKg, 2), r(highKg, 2)] : null, byState: Object.fromEntries(STATUSES.map((s) => [s, r(byState[s] || 0, 2)])), unknownCount, notIncluded, note, limit };
}

// ─── car ────────────────────────────────────────────────────────────────────

export const CAR_BRIEF = "Design a car that weighs 2,500 lb, can go 180 mph, seats 4 people, and has a futuristic aerodynamic look.";
const CAR_HEADLINE_SOLVERS = ["vehicle.top-speed", "aero.drag-buildup", "structure.frame", "cad.body", "vehicle.required-power", "vehicle.axle-loads", "tire.speed-rating", "tire.load-index", "package.tub-fit", "vehicle.gearing"];

function solverOutputValues(results, solvers, group) {
  const out = [];
  for (const e of results) {
    const sid = e.solver?.id;
    if (!solvers.includes(sid) || !e.outputs) continue;
    for (const [k, o] of Object.entries(e.outputs)) {
      if (!o || !Number.isFinite(o.value)) continue;
      const statusText = o.status || o.basis || "";
      out.push({
        id: `${e.runId}:${k}`, group, name: `${sid} · ${k.replace(/([A-Z])/g, " $1").toLowerCase()}`, subject: e.target,
        value: r(o.value, 6), unit: str(o.unit), range: null,
        status: statusFromBasis(statusText), statusLabel: str(statusText)?.slice(0, 200) || "solver output",
        source: { title: `${sid} ${e.solver.version} (${e.solver.reference || "ConKay solver"})`, url: null, locator: e.runId },
        sourceRole: "solver", method: str(e.solver.method)?.slice(0, 300) ?? null, note: str(o.note)?.slice(0, 300) ?? null,
      });
    }
  }
  return out;
}

export async function buildCarSnapshot() {
  const { carAcceptanceAsync } = await import("../compiler/car-from-library.js");
  const { drawingContent } = await import("../physics/solvers/ga-drawing.js");
  const a = await carAcceptanceAsync(CAR_BRIEF, { chassis: "tub" });
  if (!a.ok) throw new Error(`car pipeline failed: ${a.error}`);
  const s = a.session, rep = a.report, results = s.results();
  const checks = results.filter((e) => !["mass.part", "cost.part", "cost.assembly", "mass.assembly", "mass.cg"].includes(e.solver?.id)).map(checkRow);
  const perPart = results.filter((e) => ["mass.part", "cost.part", "cost.assembly", "mass.assembly", "mass.cg"].includes(e.solver?.id));
  const files = [], drawings = [];
  const ga = s.result("drawing.ga@VEH");
  if (ga?.status === "PASS" || ga?.status === "WARN") {
    const f = ga.outputs.files.value;
    const list = [["sheet1Svg", "Sheet 1 (side, plan, front)"], ["sheet2Svg", "Sheet 2 (BOM, dimensions)"], ["pdf", "PDF (both sheets)"]].map(([k, label]) => {
      const data = drawingContent(f[k].sha256);
      files.push({ name: f[k].name, data });
      return { label, name: f[k].name, kind: k === "pdf" ? "pdf" : "svg", bytes: f[k].bytes, sha256: f[k].sha256 };
    });
    drawings.push({ title: "General arrangement CK-GA-VEH", revision: ga.outputs.revision.value, modelHash: ga.outputs.modelHash.value, method: ga.solver.method, files: list });
  }
  let model3d = null;
  const body = s.result("cad.body@BODY_SHELL");
  const stl = body?.outputs?.files?.value?.stl;
  if (stl?.path && fs.existsSync(stl.path)) {
    const data = fs.readFileSync(stl.path);
    const name = `body-${sha256(data).slice(0, 12)}.stl`;
    files.push({ name, data });
    model3d = { name, format: "stl", bytes: data.length, sha256: sha256(data), triangles: stl.triangles ?? null, units: "m", upAxis: "z", source: `cad.body@BODY_SHELL (OpenCascade kernel ${body.outputs.kernel?.value?.requestHash || ""}); exterior skin only, no tyres or interior` };
  }
  const values = [
    ...rep.components.map((c) => ({
      id: `component:${c.node}`, group: "Component masses", name: `${c.node} · ${c.name}`, subject: c.componentId,
      value: r(c.massKg, 3), unit: "kg", range: c.uncertainty?.lowKg != null ? { low: r(c.uncertainty.lowKg, 3), high: r(c.uncertainty.highKg, 3) } : null,
      status: statusFromMassState(c.state, c.sourceKind), statusLabel: c.sourceKind ? `sourced (${c.sourceKind})` : c.state,
      source: c.source ? { title: c.sourceTitle, url: c.source, locator: null } : null, sourceRole: c.source ? "evidence" : null,
      method: c.method ?? null, note: c.excludes?.length ? `excludes: ${c.excludes.join("; ")}` : null,
    })),
    ...solverOutputValues(results, CAR_HEADLINE_SOLVERS, "Solver outputs"),
  ];
  const mb = rep.massBreakdown;
  const ts = rep.topSpeed || {};
  const physicalTests = [
    ...(ts.unverifiedDependencies || []).map((d) => `${d.what || d.id} (the top speed depends on it)`),
    "Weigh the built car: the kerb mass is a lower bound (items the published part masses exclude are listed below)",
    "Torsion rig test of the tub: the stiffness is a frame/shell model, not a measurement",
    "Coast-down or wind-tunnel test: Cd is a screening build-up range, not CFD or a wind tunnel",
    "Occupant fit and egress with real people in a buck or prototype",
  ];
  return {
    snapshot: {
      id: "car", brief: CAR_BRIEF,
      headline: { verdict: rep.verdict, status: rep.status, topSpeed: ts.mph != null ? { mph: r(ts.mph, 1), kmh: r(ts.kmh, 1), status: ts.status, basis: ts.basis } : null },
      disclaimers: [SCREENING_DISCLAIMER, "Aerodynamics is a component drag build-up and 2D panel screening, not CFD or wind-tunnel data.", "Torsional stiffness assumes rigid joints."],
      caveats: rep.caveats || [], failures: rep.failures || [],
      checks, checkCounts: countStatuses(checks), perPartRuns: countStatuses(perPart.map(checkRow)),
      values, mass: massSummary({
        totalKg: mb.totalKg, lowKg: mb.uncertaintyKg?.[0], highKg: mb.uncertaintyKg?.[1],
        byState: { sourced: mb.sourcedKgBySourceKind.manufacturerSpec, measured: mb.sourcedKgBySourceKind.thirdPartyMeasurement, computed: mb.kg.computed, estimated: mb.kg.estimated, unknown: mb.kg.placeholder },
        notIncluded: mb.notIncluded, note: `${mb.note}; ${mb.vsTarget?.note || ""}`.trim(),
        limit: mb.vsTarget ? { label: "brief: 2,500 lb", kg: mb.vsTarget.targetKg, marginKg: mb.vsTarget.marginKg } : null,
      }),
      drawings, model3d, physicalTests,
    },
    files,
  };
}

// ─── Sentinel M1 ──────────────────────────────────────────────────────────────

export async function buildSentinelSnapshot() {
  await import("../index.js");
  const { runSentinelM1 } = await import("../demos/sentinel-m1.js");
  const { drawingContent } = await import("../physics/solvers/ga-drawing.js");
  const run = runSentinelM1();
  if (!run.ok) throw new Error("Sentinel run failed");
  const checks = run.report.checks.filter((e) => e.solver !== "mass.part").map(checkRow);
  const at = (id) => run.report.checks.find((e) => e.runId === id);
  const mb = at("mass.budget@sentinel").outputs;
  const sources = run.sources || {};
  const values = mb.items.value.map((i) => {
    const srcId = Object.keys(sources).find((k) => String(i.source || "").includes(sources[k].title || "\u0000"));
    const src = srcId ? sources[srcId] : null;
    return {
      id: `mass:${i.id}`, group: "Mass budget", name: i.name, subject: i.id, value: r(i.mass, 4), unit: "kg",
      range: i.band && i.band[0] !== i.band[1] ? { low: r(i.band[0], 4), high: r(i.band[1], 4) } : null,
      status: statusFromMassState(i.state), statusLabel: i.state,
      source: src ? { title: src.title, url: src.url, locator: null } : i.source ? { title: String(i.source).slice(0, 300), url: null, locator: null } : null,
      sourceRole: src ? "evidence" : i.source ? "stated basis" : null, method: null, note: null,
    };
  });
  for (const u of mb.unknownItems?.value || []) values.push({ id: `mass:${u.id}`, group: "Mass budget", name: u.name || u.id, subject: u.id, value: null, unit: "kg", range: null, status: "unknown", statusLabel: "unknown", source: null, sourceRole: null, method: null, note: u.reason || null });
  for (const n of mb.notFitted?.value || []) values.push({ id: `mass:${n.id}`, group: "Not fitted on M1", name: n.name || n.id, subject: n.id, value: null, unit: "kg", range: null, status: "design", statusLabel: "not fitted (design decision)", source: null, sourceRole: null, method: null, note: n.reason || n.note || null });
  const byState = { sourced: 0, measured: 0, computed: 0, estimated: 0, design: 0, unknown: 0 };
  for (const i of mb.items.value) byState[statusFromMassState(i.state)] += i.mass;
  const frame = at("structure.frame@sentinel");
  const lim = frame?.outputs?.["single-support.loadToLimit"]?.value;
  const files = [], drawings = [];
  const ga = at("drawing.ga-assembly@sentinel");
  if (ga && ga.outputs?.files) {
    const f = ga.outputs.files.value;
    const list = [["sheet1Svg", "Sheet 1 (views)"], ["sheet2Svg", "Sheet 2 (BOM)"], ["pdf", "PDF (both sheets)"]].filter(([k]) => f[k]).map(([k, label]) => {
      files.push({ name: f[k].name, data: drawingContent(f[k].sha256) });
      return { label, name: f[k].name, kind: k === "pdf" ? "pdf" : "svg", bytes: f[k].bytes, sha256: f[k].sha256 };
    });
    drawings.push({ title: "General arrangement CK-GA-SENTINEL-M1", revision: ga.outputs.revision?.value ?? null, modelHash: ga.outputs.modelHash?.value ?? null, method: null, files: list });
  }
  return {
    snapshot: {
      id: "sentinel-m1", brief: "Sentinel / RAM spec rev 1.0, Milestone 1 ground prototype (armor not fitted on M1)",
      headline: { verdict: run.gate.accepted ? "accepted_for_screening" : "not_accepted", status: run.gate.accepted ? "PASS" : "FAIL", converged: run.report.converged, iterations: run.report.iterations },
      disclaimers: [run.gate.scope, SCREENING_DISCLAIMER],
      caveats: run.report.assumptions || [], failures: run.gate.blockers || [],
      repairs: (run.report.repairs || []).map((x) => ({ variable: x.variable, before: x.before, after: x.after, result: x.result ?? null, failingRun: x.failingRun })),
      checks, checkCounts: countStatuses(checks), perPartRuns: countStatuses(run.report.checks.filter((e) => e.solver === "mass.part").map(checkRow)),
      values, mass: massSummary({
        totalKg: mb.knownMass.value, lowKg: mb.massLow.value, highKg: mb.massHigh.value, byState, unknownCount: mb.unknownCount.value,
        notIncluded: (mb.notFitted?.value || []).map((n) => `${n.id}: not fitted on Milestone 1`),
        note: `CG (${r(mb.cgX.value, 3)}, ${r(mb.cgY.value, 3)}, ${r(mb.cgZ.value, 3)}) m`,
        limit: lim ? { label: `stance leg mass at limit (${lim.governs})`, kg: r(lim.totalMassKg, 2), marginKg: r(lim.totalMassKg - mb.massHigh.value, 2) } : null,
      }),
      drawings, model3d: null, physicalTests: run.gate.physicalTestsOutstanding || [],
    },
    files,
  };
}

// ─── USB Blend D ──────────────────────────────────────────────────────────────

export async function buildBlendDSnapshot() {
  const K = await import("../knowledge/index.js");
  const { text, meta } = K.loadFixture("usb-blend-d");
  const rep = K.buildFormulationReport(text, meta);
  const values = [...rep.claims.map((c) => claimValue(c, { group: "Claims in the source text" })), ...rep.computed.map((c) => claimValue(c, { group: "Computed / estimated" }))];
  const checks = [
    { runId: "composition-sum-check", solver: "composition-sum-check", target: "USB Blend D", status: rep.compositionCheck.feasible ? (rep.compositionCheck.exact ? "PASS" : "WARN") : "FAIL", method: "sum of the stated ingredient ranges", reason: rep.compositionCheck.note, margins: [], failures: [], warnings: [] },
    { runId: "self-check", solver: "schema self-check", target: "report records", status: rep.selfCheck.ok ? "PASS" : "FAIL", method: "every record and claim validated against the knowledge schema", reason: null, margins: [], failures: [], warnings: [] },
    ...rep.flags.map((f) => ({ runId: `flag:${f.id}`, solver: "formulation flags", target: "USB Blend D", status: f.severity === "error" ? "FAIL" : "WARN", method: f.title, reason: f.detail, margins: [], failures: [], warnings: [] })),
  ];
  return {
    snapshot: {
      id: "usb-blend-d", brief: `USB Blend D as written by ${meta.author}, ${meta.date} (source sha256 ${rep.sourceSha256.slice(0, 16)}…)`,
      headline: { verdict: "claims_unverified", status: "WARN", claims: rep.claims.length, unsupported: rep.unsupportedClaims.length, conditionalDensityKgM3: rep.conditionalDensity },
      disclaimers: ["No claim in the source text is established by the text itself: each one needs the test listed for it.", "The density is a conditional rule-of-mixtures estimate (assumptions A1–A4), not a measurement."],
      caveats: rep.flags.map((f) => `${f.title}: ${f.detail}`), failures: [],
      checks, checkCounts: countStatuses(checks), values, mass: null, drawings: [], model3d: null,
      physicalTests: rep.testPlan.items.map((i) => `${i.label} (${i.priority}): ${i.tests.map((t) => `${t.what}${t.standards?.length ? ` [${t.standards.join(", ")}]` : ""}`).join("; ")}`),
    },
    files: [],
  };
}

// ─── methanol-water ───────────────────────────────────────────────────────────

export async function buildMixtureSnapshot() {
  const K = await import("../knowledge/index.js");
  const { replayGetter } = await import("../knowledge/connectors/fetcher.js");
  const REC = await K.loadConnectorRecordings();
  const m = await K.mixtureReport(replayGetter(REC.recordings));
  if (!m.ok) throw new Error("mixture report failed");
  const values = [
    ...m.claims.map((c) => claimValue(c, { group: "Pure components (PubChem / NIST)" })),
    ...m.computed.map((c) => claimValue(c, { group: "Computed for the mixture" })),
    ...m.unknowns.map((c) => claimValue(c, { group: "Unknown for the mixture" })),
  ];
  const checks = m.crossChecks.map((x) => ({
    runId: `crosscheck:${x.claim}`, solver: "density cross-check", target: x.claim, status: x.agreesWithinUncertainty ? "PASS" : "WARN",
    method: `PubChem value ${x.reading ? `(${x.reading}) ` : ""}vs NIST reference`, reason: null,
    margins: [{ check: "relative difference", demand: r(x.valueKgM3, 3), capacity: r(x.referenceKgM3, 3), unit: "kg/m3", utilization: null, marginPct: r(x.relativeDifference * 100, 3) }], failures: [], warnings: [],
  }));
  return {
    snapshot: {
      id: "methanol-water", brief: `${m.spec.name} at ${m.spec.temperatureK} K, ${m.spec.pressurePa} Pa (${m.spec.basisDefinition})`,
      headline: { verdict: "computed_with_unknowns", status: m.unknowns.length ? "WARN" : "PASS", computed: m.computed.length, unknown: m.unknowns.length, pendingReview: m.reviewQueue.length },
      disclaimers: ["Responses are the recorded PubChem / NIST WebBook fetches (hash-checked), replayed offline.", "The mixture density is not the ideal-mixing value: the excess volume is unknown from these sources and needs a measurement."],
      caveats: m.limits, failures: [], checks, checkCounts: countStatuses(checks), values, mass: null, drawings: [], model3d: null,
      physicalTests: m.testPlan.map((t) => `${t.property.replace(/_/g, " ")}: ${t.tests.map((x) => `${x.what}${x.standards?.length ? ` [${x.standards.join(", ")}]` : ""}`).join("; ")} — ${t.why}`),
      reviewQueue: m.reviewQueue.map((q) => ({ id: q.id, kind: q.kind, subject: q.subject, decision: q.decision, reason: q.reason })),
    },
    files: [],
  };
}

// ─── NuScale US600 ────────────────────────────────────────────────────────────

export async function buildUs600Snapshot() {
  const SC = await import("../safety-case/index.js");
  const { drawingContent } = await import("../physics/solvers/ga-drawing.js");
  const fac = SC.buildUS600Facility();
  const scr = SC.runFacilityScreen(fac);
  const d = SC.drawFacility(fac);
  const checks = [
    ...scr.phase1.runs.map((x) => ({ runId: x.runId, solver: "safety.single-failure", target: x.runId.split("@")[1], status: x.engineStatus, method: "single-failure screen over the declared support graph", reason: x.failures ? `${x.failures} single-failure finding(s): screening findings for engineering disposition, not a safety determination` : null, margins: [], failures: [], warnings: [] })),
    ...scr.requirements.map((q) => {
      const st = q.status?.status || "";
      return { runId: `requirement:${q.record.id}`, solver: "requirement", target: q.record.id, status: /fail/.test(st) ? "FAIL" : /pass|met/.test(st) ? "PASS" : "NOT_COMPUTED", method: q.record.text, reason: [st, q.record.textNote, ...(q.status?.missing || []).map((m) => m.reason)].filter(Boolean).join("; "), margins: [], failures: [], warnings: [] };
    }),
  ];
  const values = [
    ...Object.values(SC.US600_FACTS).map((f) => {
      const src = SC.US600_SOURCES[f.source] || {};
      return { id: f.id, group: `Facts (${f.quality} source)`, name: f.id.replace(/^F-/, ""), subject: "NuScale US600", value: null, unit: null, range: null, statement: f.quote, status: "sourced", statusLabel: `sourced (${f.quality}${f.verbatim ? ", verbatim" : ""})`, source: { title: src.title || f.source, url: src.url || null, locator: f.locator, retrieved: src.retrieved || null }, sourceRole: "evidence", method: null, note: null };
    }),
    ...SC.US600_GAPS.map((g) => ({ id: g.id, group: "Gaps (unknown)", name: g.item, subject: "NuScale US600", value: null, unit: null, range: null, statement: g.effect, status: "unknown", statusLabel: "unknown", source: null, sourceRole: null, method: null, note: `where: ${g.where}` })),
  ];
  const files = [], drawings = [];
  if (d.ok) {
    const list = [["sheet1Svg", "Sheet 1 (site / plant plan)"], ["sheet2Svg", "Sheet 2 (section)"], ["pdf", "PDF (both sheets)"]].filter(([k]) => d.files[k]).map(([k, label]) => {
      files.push({ name: d.files[k].name, data: drawingContent(d.files[k].sha256) });
      return { label, name: d.files[k].name, kind: k === "pdf" ? "pdf" : "svg", bytes: d.files[k].bytes, sha256: d.files[k].sha256 };
    });
    drawings.push({ title: `Plant GA ${d.drawing || "CK-GA-US600-PLANT"}`, revision: d.revision, modelHash: d.modelHash, method: "facility skeleton laid out from public-source dimensions; unknown dimensions not drawn", files: list });
  }
  return {
    snapshot: {
      id: "nuscale-us600", brief: scr.design.name,
      headline: { verdict: "screening_findings_pending_review", status: "WARN", counts: scr.counts, pendingReview: scr.reviewQueue.length },
      disclaimers: [NUCLEAR_DISCLAIMER, scr.banner, "Single-failure FAIL rows are screening findings for engineering disposition, not determinations about the certified design."],
      caveats: [...(d.unknown || []).map((u) => `not drawn (dimension unknown): ${u}`)], failures: [],
      checks, checkCounts: countStatuses(checks), values, mass: null, drawings, model3d: null,
      physicalTests: ["Not applicable to a screening skeleton: every gap below needs the named FSAR chapter read by a qualified engineer, and every finding needs a human disposition."],
      reviewQueue: scr.reviewQueue.slice(0, 40).map((q) => ({ id: q.id, kind: q.kind, subject: q.item, decision: q.decision, reason: q.detail })),
    },
    files,
  };
}

export const BUILDERS = Object.freeze({
  car: buildCarSnapshot,
  "sentinel-m1": buildSentinelSnapshot,
  "usb-blend-d": buildBlendDSnapshot,
  "methanol-water": buildMixtureSnapshot,
  "nuscale-us600": buildUs600Snapshot,
});

/** Wrap a builder's snapshot with the showcase entry, file list and a content hash. */
export function finalizeSnapshot(entry, snapshot, files) {
  const fileList = files.map((f) => ({ name: f.name, bytes: Buffer.byteLength(f.data), sha256: sha256(f.data) }));
  const body = { showcaseVersion: SHOWCASE_VERSION, ...entry, ...snapshot, statuses: STATUSES, statusMeaning: STATUS_MEANING, files: fileList };
  return { ...body, snapshotSha256: sha256(JSON.stringify(body)) };
}

// ─── serving ──────────────────────────────────────────────────────────────────

const SAFE_ID = /^[a-z0-9-]{1,40}$/;
const SAFE_FILE = /^[A-Za-z0-9._-]{1,120}$/;
const cache = new Map();

/** The snapshot for `id` from disk (cached), or null. */
export function loadSnapshot(id, dir = SNAPSHOT_DIR) {
  if (!SAFE_ID.test(id) || !SHOWCASE.some((e) => e.id === id)) return null;
  const key = `${dir}:${id}`;
  if (cache.has(key)) return cache.get(key);
  let snap = null;
  try { snap = JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), "utf8")); } catch { snap = null; }
  cache.set(key, snap);
  return snap;
}

/** The index the list page shows: one card per design, or a "not built" entry. */
export function listSnapshots(dir = SNAPSHOT_DIR) {
  return SHOWCASE.map((e) => {
    const s = loadSnapshot(e.id, dir);
    if (!s) return { ...e, available: false };
    return { id: e.id, title: e.title, kind: e.kind, available: true, brief: s.brief, headline: s.headline, checkCounts: s.checkCounts, hasDrawings: s.drawings.length > 0, hasModel3d: !!s.model3d, snapshotSha256: s.snapshotSha256 };
  });
}

/** A file listed in the snapshot (and only those): { data, contentType } or null. */
export function loadSnapshotFile(id, name, dir = SNAPSHOT_DIR) {
  const s = loadSnapshot(id, dir);
  if (!s || !SAFE_FILE.test(name)) return null;
  const f = s.files.find((x) => x.name === name);
  if (!f) return null;
  let data;
  try { data = fs.readFileSync(path.join(dir, id, name)); } catch { return null; }
  if (sha256(data) !== f.sha256) return null; // a file that drifted from its snapshot is not served
  const ext = path.extname(name).toLowerCase();
  const contentType = ext === ".svg" ? "image/svg+xml" : ext === ".pdf" ? "application/pdf" : ext === ".stl" ? "model/stl" : "application/octet-stream";
  return { data, contentType, sha256: f.sha256 };
}
