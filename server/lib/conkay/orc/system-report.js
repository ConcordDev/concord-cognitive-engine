// server/lib/conkay/orc/system-report.js
//
// SX-ORC-12 — orc.system-report: system report with per-part
// receipts (catalogue wave 0, PRG-17). Engine: JS. The calc-sheet
// pattern (BU-20) extended to systems: an assembler over the
// landed solvers' output shapes that produces the report a human
// or a walker actually reads — and the reference case is its
// honesty rule: EVERY CLAIM LINKS TO A RECEIPT.
//
// Inputs are the upstream solvers' outputs objects (not envelopes):
// orc.system-architecture, orc.mass-bom, cad.bom-structure,
// orc.integration-checks, orc.research-gaps. For each section
// present, the assembler extracts claims and mints each claim's
// receipt — {solver, evidence} where evidence is the path of the
// value inside that solver's outputs. The assembler COPIES values;
// it computes no new engineering numbers. The one computation it
// owns is consistency: the mass total arrives by two independent
// paths (orc.mass-bom's roll-up and cad.bom-structure's tree
// roll-up) and the two must agree — a disagreement is named in
// inconsistencies and stamps the report, never silently averaged
// or picked from.
//
// Sections absent from the input are named in missingSections and
// stamp the report PARTIAL (COMPLETE only when all five are
// present) — a report that quietly omits the integration section
// reads as a pass it never earned. NOT_COMPUTED values ride as
// claims with value null and their status/reason carried — a
// massless part and an unpriced total appear in the report AS
// gaps, not as absences.
//
// A `previous` input (same section shapes, from an earlier design
// version) produces the realistic-version diff: claims keyed
// identically across versions, listed as added / removed /
// changed with before and after values.

import { registerSolver } from "../physics/registry.js";

const NS = "orc.systemReport";
const SECTIONS = ["architecture", "massBom", "bom", "integration", "gaps"];
const SECTION_SOLVER = {
  architecture: "orc.system-architecture",
  massBom: "orc.mass-bom",
  bom: "cad.bom-structure",
  integration: "orc.integration-checks",
  gaps: "orc.research-gaps",
};

function claim(section, key, value, evidence, extra = {}) {
  return { key, section, value, receipt: { solver: SECTION_SOLVER[section], evidence }, ...extra };
}

function extract(section, o) {
  const bad = (field) => `INVALID_INPUT: ${section} section does not carry ${field} — pass the producing solver's outputs object`;
  const claims = [];
  if (section === "architecture") {
    if (!o.architecture || typeof o.architecture.kind !== "string") return { error: bad("architecture.kind") };
    if (typeof o.subsystemCount !== "number") return { error: bad("subsystemCount") };
    claims.push(claim(section, "architecture.kind", o.architecture.kind, "architecture.architecture.kind"));
    claims.push(claim(section, "architecture.subsystemCount", o.subsystemCount, "architecture.subsystemCount"));
    for (const s of o.subsystems || []) {
      claims.push(claim(section, `architecture.subsystem:${s.id}`, s.parentRequirement ?? null, "architecture.subsystems", { detail: "parent requirement" }));
    }
  } else if (section === "massBom") {
    if (typeof o.totalMassKg !== "number") return { error: bad("totalMassKg") };
    if (!Array.isArray(o.parts)) return { error: bad("parts") };
    claims.push(claim(section, "mass.totalKg", o.totalMassKg, "massBom.totalMassKg"));
    for (const p of o.parts) {
      if (p.massless) {
        claims.push(claim(section, `mass.part:${p.id}`, null, "massBom.parts", { status: "NOT_COMPUTED", reason: p.reason }));
      } else {
        claims.push(claim(section, `mass.part:${p.id}`, p.massKg, "massBom.parts"));
      }
    }
    if (o.cgM) claims.push(claim(section, "mass.cgM", o.cgM, "massBom.cgM"));
    else if (o.cgNotComputed) claims.push(claim(section, "mass.cgM", null, "massBom.cgNotComputed", { status: "NOT_COMPUTED", reason: o.cgNotComputed }));
  } else if (section === "bom") {
    if (!("totalMassKg" in o) || !("totalCost" in o)) return { error: bad("totalMassKg / totalCost") };
    claims.push(claim(section, "bom.totalMassKg", o.totalMassKg, "bom.totalMassKg", o.totalMassKg == null ? { status: "PARTIAL", reason: "unmassed lines named in bom.unmassedLines" } : {}));
    claims.push(claim(section, "bom.totalCost", o.totalCost, "bom.totalCost", o.totalCost == null ? { status: "PARTIAL", reason: "unpriced lines named in bom.unpricedLines — unpriced stays null" } : {}));
    claims.push(claim(section, "bom.lineCount", o.lineCount, "bom.lineCount"));
    claims.push(claim(section, "bom.currency", o.currency ?? null, "bom.currency"));
  } else if (section === "integration") {
    if (typeof o.verdict !== "string" || !Array.isArray(o.checks)) return { error: bad("verdict / checks") };
    claims.push(claim(section, "integration.verdict", o.verdict, "integration.verdict"));
    for (const c of o.checks) {
      claims.push(claim(section, `integration.check:${c.check}`, c.status, "integration.checks"));
    }
    for (const n of o.notRun || []) {
      claims.push(claim(section, `integration.notRun:${n.check}`, null, "integration.notRun", { status: "NOT_RUN", reason: n.reason }));
    }
  } else if (section === "gaps") {
    if (typeof o.queueCount !== "number" || !Array.isArray(o.queue)) return { error: bad("queueCount / queue") };
    claims.push(claim(section, "gaps.queueCount", o.queueCount, "gaps.queueCount"));
    for (const q of o.queue) {
      claims.push(claim(section, `gaps.item:${q.property}`, q.valueStatus, "gaps.queue", { detail: `queued for ${q.engine}; ${q.valueReason}` }));
    }
  }
  return { claims };
}

function sameValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The pure solver function. Exported for direct testing. */
export function systemReport(props = {}) {
  const system = props?.system;
  if (!system || typeof system.id !== "string" || !system.id) {
    return { notComputed: "missing_input:system.id", inputs: {} };
  }
  const present = SECTIONS.filter((s) => props[s] != null);
  if (present.length === 0) {
    return { notComputed: `missing_input:sections — at least one of ${SECTIONS.join(", ")} must be given (each the producing solver's outputs object)`, inputs: {} };
  }
  const claims = [];
  for (const s of present) {
    if (typeof props[s] !== "object" || Array.isArray(props[s])) {
      return { notComputed: `INVALID_INPUT: ${s} must be the producing solver's outputs object`, inputs: {} };
    }
    const got = extract(s, props[s]);
    if (got.error) return { notComputed: got.error, inputs: {} };
    claims.push(...got.claims);
  }
  // The assembler's invariant: every claim carries a receipt.
  const unreceipted = claims.filter((c) => !c.receipt || !c.receipt.solver || !c.receipt.evidence);
  // Consistency: the mass total by two independent paths must agree.
  const inconsistencies = [];
  const massTotal = claims.find((c) => c.key === "mass.totalKg");
  const bomTotal = claims.find((c) => c.key === "bom.totalMassKg");
  if (massTotal && bomTotal && massTotal.value != null && bomTotal.value != null) {
    if (Math.abs(massTotal.value - bomTotal.value) > 1e-9) {
      inconsistencies.push({
        check: "mass-total-agreement",
        detail: `orc.mass-bom totals ${massTotal.value} kg but cad.bom-structure totals ${bomTotal.value} kg — the two roll-ups disagree; both values stand in the claims, neither is averaged or picked`,
        values: { massBom: massTotal.value, bomStructure: bomTotal.value },
      });
    }
  }
  const missingSections = SECTIONS.filter((s) => !present.includes(s));
  const completeness = missingSections.length === 0 && inconsistencies.length === 0 ? "COMPLETE" : "PARTIAL";

  let diff = null;
  if (props.previous != null) {
    const prevClaims = [];
    for (const s of SECTIONS) {
      if (props.previous[s] == null) continue;
      const got = extract(s, props.previous[s]);
      if (got.error) return { notComputed: `previous: ${got.error}`, inputs: {} };
      prevClaims.push(...got.claims);
    }
    const before = new Map(prevClaims.map((c) => [c.key, c.value]));
    const after = new Map(claims.map((c) => [c.key, c.value]));
    diff = [];
    for (const key of [...new Set([...before.keys(), ...after.keys()])].sort()) {
      if (!before.has(key)) diff.push({ key, change: "added", after: after.get(key) });
      else if (!after.has(key)) diff.push({ key, change: "removed", before: before.get(key) });
      else if (!sameValue(before.get(key), after.get(key))) diff.push({ key, change: "changed", before: before.get(key), after: after.get(key) });
    }
  }

  const warnings = [];
  if (missingSections.length) warnings.push(`report is PARTIAL: sections not provided — ${missingSections.join(", ")} (named, never silently omitted)`);
  if (inconsistencies.length) warnings.push(`${inconsistencies.length} consistency disagreement(s) named in inconsistencies — both values stand`);
  if (unreceipted.length) warnings.push(`${unreceipted.length} claim(s) without receipts — an assembler defect, named rather than hidden`);

  return {
    inputs: props,
    outputs: {
      system: { id: system.id, name: system.name ?? null },
      completeness,
      claims,
      claimCount: claims.length,
      unreceipted: unreceipted.map((c) => c.key),
      missingSections,
      inconsistencies,
      diff,
    },
    assumptions: [],
    warnings,
  };
}

// Local targets/run pair (literal-key discipline; graph-adapter finding
// filed under SX-ORC-01).
function srTargets(graph) {
  if (!graph || !graph.nodes) return [];
  const out = [];
  for (const [id, node] of graph.nodes) {
    if (node && node.props && node.props[NS]) out.push(id);
  }
  return out;
}

function srRun(ctx, id) {
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
  return systemReport(props);
}

registerSolver({
  id: "orc.system-report",
  version: "1.0.0",
  domain: "orchestration",
  domains: ["orchestration"],
  method: "system-report.claim-extraction+receipts",
  fidelity: 1,
  engineDependent: [],
  regime: "reports over the five upstream orchestration/CAD solver output shapes; values are copied from those outputs, never recomputed; the mass total is cross-checked between its two independent roll-ups",
  units: "inherited per claim from its producing solver (mass in kilograms, costs in the BOM's declared currency); the report introduces no quantities",
  tolerance: "claim values are exact copies; the mass-total agreement check compares within 1e-9 kg; version diffs compare values by exact JSON equality",
  screening: false,
  reference: "reference case (every claim links to a receipt) in server/tests/conkay-orc-system-report.test.js",
  graphProp: NS,
  targets: srTargets,
  run: srRun,
});

export default { systemReport };
