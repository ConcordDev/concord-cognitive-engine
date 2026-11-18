// server/lib/conkay/orc/chain-run.js
//
// SXC-26 — orc.chain-run: the system chain runner (catalogue
// wave 0, PRG-C1). Executes the core loop across the landed
// solvers as ONE chain with named output→input mappings, and
// assembles the chain-level receipt (SX-CHAIN-RECEIPT) over the
// run. Chain definition: docs/conkay/chains/system-chain.md.
//
// Steps, in order (each at its solver's declared tier):
//   intent        orc.intent-parse        brief text -> parsed brief
//   requirements  orc.requirements        brief text -> requirements
//   architecture  orc.system-architecture brief text -> architecture
//   parts-cad     cad.mass-properties-brep  per part: geometry+materials
//   mass-bom      orc.mass-bom            parts -> totals/CG; its
//                                         budgetKg input is MAPPED
//                                         from the requirements
//                                         link's mass bound
//   bom           cad.bom-structure       items tree -> cost/mass
//   integration   orc.integration-checks  declared closures/interfaces
//   gaps          orc.research-gaps       OPTIONAL (declared needs)
//   iterate       orc.iterate             OPTIONAL (declared props)
//   fallback      orc.realistic-fallback  NEVER RUNS in wave 0 —
//                                         SX-ORC-09 is BLOCKED on
//                                         question F10; the step is
//                                         recorded SKIPPED with F10
//                                         named, never a guessed
//                                         fallback (CB-0835 rule 2)
//   report        orc.system-report       consumes the architecture,
//                                         mass-bom, bom, integration
//                                         and gaps links' outputs
//
// Stop rule: a step that returns NOT_COMPUTED stops the chain;
// the receipt names the step and the reason and stands
// INCOMPLETE. An optional step the caller DECLARED that fails is
// a stop too (declared means wanted). Seams are evaluated over
// the links that ran; the receipt signs only when every link
// computed and every seam holds (SX-CHAIN-RECEIPT's rule).

import { registerSolver } from "../physics/registry.js";
import { parseIntentBrief } from "./intent-parse.js";
import { deriveRequirements } from "./requirements.js";
import { systemArchitecture } from "./system-architecture.js";
import { massPropertiesBrep } from "../cad/mass-properties-brep.js";
import { massBom } from "./mass-bom.js";
import { bomStructure } from "../cad/bom-structure.js";
import { integrationChecks } from "./integration-checks.js";
import { researchGaps } from "./research-gaps.js";
import { iterate } from "./iterate.js";
import { systemReport } from "./system-report.js";
import { linkReceipt, buildChainReceipt } from "../chain/receipt.js";

const NS = "orc.chainRun";
export const CHAIN_ID = "system-chain";

function runPartsCad(parts) {
  const rows = [];
  for (const p of parts) {
    if (!p || typeof p.id !== "string" || !p.massProperties) {
      return { notComputed: `INVALID_INPUT: every part needs an id and massProperties (part "${p?.id ?? "?"}")` };
    }
    const mp = massPropertiesBrep(p.massProperties);
    if (mp.notComputed) return { notComputed: `part "${p.id}": ${mp.notComputed}` };
    rows.push({ id: p.id, massKg: mp.outputs.massKg, volumeM3: mp.outputs.volumeM3, material: mp.outputs.material ?? null });
  }
  return { inputs: { parts }, outputs: { parts: rows, totalMassKg: rows.reduce((s, r) => s + r.massKg, 0) } };
}

/** The pure runner. Exported for direct testing. */
export function chainRun(props = {}) {
  const { text, system, parts, bomItems, currency, integration, needs, iterateProps } = props ?? {};
  if (typeof text !== "string" || !text.trim()) return { notComputed: "missing_input:text (the brief)", inputs: {} };
  if (!system || typeof system.id !== "string" || !system.id) return { notComputed: "missing_input:system.id", inputs: {} };
  if (!Array.isArray(parts) || parts.length === 0) return { notComputed: "missing_input:parts", inputs: {} };
  if (!Array.isArray(bomItems) || bomItems.length === 0) return { notComputed: "missing_input:bomItems", inputs: {} };
  if (!integration || typeof integration !== "object") return { notComputed: "missing_input:integration (the integration-checks input)", inputs: {} };

  const links = [];
  const skipped = [];
  const outputs = {};
  let stopped = null;

  const step = (name, solver, inputs, result) => {
    if (stopped) return;
    if (result.notComputed) {
      stopped = { step: name, solver, reason: result.notComputed };
      return;
    }
    outputs[name] = result.outputs;
    links.push(linkReceipt({ step: name, solver, inputs, outputs: result.outputs }));
  };

  step("intent", "orc.intent-parse", { text }, parseIntentBrief({ text }));
  step("requirements", "orc.requirements", { text }, deriveRequirements({ text }));
  step("architecture", "orc.system-architecture", { text }, systemArchitecture({ text }));

  if (!stopped) {
    const cad = runPartsCad(parts);
    if (cad.notComputed) stopped = { step: "parts-cad", solver: "cad.mass-properties-brep", reason: cad.notComputed };
    else {
      outputs["parts-cad"] = cad.outputs;
      links.push(linkReceipt({ step: "parts-cad", solver: "cad.mass-properties-brep", inputs: cad.inputs, outputs: cad.outputs }));
    }
  }

  // Named mapping: the requirements link's mass bound feeds the
  // mass-bom link's budget input.
  const massReq = !stopped ? (outputs.requirements?.requirements || []).find((r) => r.metric === "mass" && r.bound?.kind === "max") : null;
  step("mass-bom", "orc.mass-bom", { parts, ...(massReq ? { budgetKg: massReq.bound.si } : {}) },
    massBom({ parts, ...(massReq ? { budgetKg: massReq.bound.si } : {}) }));
  step("bom", "cad.bom-structure", { items: bomItems, ...(currency ? { currency } : {}) },
    bomStructure({ items: bomItems, ...(currency ? { currency } : {}) }));
  step("integration", "orc.integration-checks", integration, integrationChecks(integration));

  if (needs != null) step("gaps", "orc.research-gaps", { needs }, researchGaps({ needs }));
  else skipped.push({ step: "gaps", solver: "orc.research-gaps", reason: "not declared in the chain input (optional link)" });

  if (iterateProps != null) step("iterate", "orc.iterate", iterateProps, iterate(iterateProps));
  else skipped.push({ step: "iterate", solver: "orc.iterate", reason: "not declared in the chain input (optional link)" });

  skipped.push({ step: "fallback", solver: "orc.realistic-fallback", reason: "BLOCKED on question F10 (SX-ORC-09) — the infeasibility fallback is not seated; never a guessed fallback" });

  step("report", "orc.system-report",
    { system, architecture: outputs.architecture, massBom: outputs["mass-bom"], bom: outputs.bom, integration: outputs.integration, gaps: outputs.gaps },
    systemReport({ system, architecture: outputs.architecture, massBom: outputs["mass-bom"], bom: outputs.bom, integration: outputs.integration, gaps: outputs.gaps }));

  // --- seams (over the links that ran) --------------------------------
  const seams = [];
  if (outputs.requirements && outputs["mass-bom"]) {
    if (massReq) {
      const actual = outputs["mass-bom"].totalMassKg;
      seams.push({
        id: "mass-budget", from: "requirements", to: "mass-bom", quantity: "totalMassKg", unit: "kg",
        fromValue: massReq.bound.si, toValue: actual,
        status: actual <= massReq.bound.si ? "HOLDS" : "VIOLATED",
        detail: actual <= massReq.bound.si
          ? `rolled-up mass ${actual} kg is within the brief's mass bound ${massReq.bound.si} kg`
          : `rolled-up mass ${actual} kg EXCEEDS the brief's mass bound ${massReq.bound.si} kg — every link computed; the chain must not sign`,
      });
    } else {
      seams.push({ id: "mass-budget", from: "requirements", to: "mass-bom", quantity: "totalMassKg", unit: "kg", status: "NOT_APPLICABLE", detail: "the brief declares no mass bound" });
    }
  }
  if (outputs["parts-cad"] && outputs["mass-bom"]) {
    const byId = new Map(outputs["mass-bom"].parts.map((p) => [p.id, p]));
    let worst = 0, compared = 0;
    for (const p of outputs["parts-cad"].parts) {
      const q = byId.get(p.id);
      if (q && q.massKg != null) { worst = Math.max(worst, Math.abs(q.massKg - p.massKg)); compared += 1; }
    }
    seams.push({
      id: "part-mass-agreement", from: "parts-cad", to: "mass-bom", quantity: "per-part massKg", unit: "kg",
      status: compared === 0 ? "INCOMPLETE" : worst <= 1e-9 ? "HOLDS" : "VIOLATED",
      detail: compared === 0 ? "no part could be compared" : `worst per-part disagreement ${worst} kg over ${compared} part(s)`,
    });
  }
  if (outputs["mass-bom"] && outputs.bom) {
    const a = outputs["mass-bom"].totalMassKg, b = outputs.bom.totalMassKg;
    seams.push({
      id: "mass-total-agreement", from: "mass-bom", to: "bom", quantity: "totalMassKg", unit: "kg",
      fromValue: a, toValue: b,
      status: b == null ? "INCOMPLETE" : Math.abs(a - b) <= 1e-9 ? "HOLDS" : "VIOLATED",
      detail: b == null ? "the BOM total is null — unmassed lines named in the bom link's outputs" : `mass-bom totals ${a} kg, bom-structure totals ${b} kg`,
    });
  }
  if (outputs.integration && outputs.report) {
    const carried = (outputs.report.claims || []).find((c) => c.key === "integration.verdict");
    seams.push({
      id: "integration-verdict-carried", from: "integration", to: "report", quantity: "integration verdict", unit: "—",
      fromValue: outputs.integration.verdict, toValue: carried?.value ?? null,
      status: carried && carried.value === outputs.integration.verdict ? "HOLDS" : "VIOLATED",
      detail: carried ? `the report carries the integration verdict "${carried.value}"` : "the report carries no integration verdict claim",
    });
  }

  const receipt = buildChainReceipt({ chainId: CHAIN_ID, links, seams, skipped, stopped });
  const warnings = [];
  if (receipt.status === "INCOMPLETE" && stopped) warnings.push(`chain STOPPED at ${stopped.step} (${stopped.solver}): ${stopped.reason} — receipt INCOMPLETE`);
  if (receipt.status === "SEAM_VIOLATION") warnings.push("chain completed every link but a SEAM is violated — receipt SEAM_VIOLATION, unsigned (SX-CHAIN-RECEIPT rule)");
  if (skipped.length) warnings.push(`${skipped.length} step(s) skipped and recorded in the receipt: ${skipped.map((s) => s.step).join(", ")}`);

  return {
    inputs: props,
    outputs: {
      chainReceipt: receipt,
      stepsRun: links.map((l) => l.step),
      stoppedAt: stopped,
      report: outputs.report ?? null,
    },
    assumptions: [],
    warnings,
  };
}

// Local targets/run pair (literal-key discipline; graph-adapter finding
// filed under SX-ORC-01).
function crTargets(graph) {
  if (!graph || !graph.nodes) return [];
  const out = [];
  for (const [id, node] of graph.nodes) {
    if (node && node.props && node.props[NS]) out.push(id);
  }
  return out;
}

function crRun(ctx, id) {
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
  return chainRun(props);
}

registerSolver({
  id: "orc.chain-run",
  version: "1.0.0",
  domain: "orchestration",
  domains: ["orchestration"],
  method: "chain-run.system-chain",
  fidelity: 1,
  engineDependent: [],
  regime: "the system chain over the landed wave-0 links (docs/conkay/chains/system-chain.md); the realistic-version fallback link is declared but not runnable while SX-ORC-09 is blocked on F10; kernel settle rides inside the iterate link's own tier declaration",
  units: "inherited per link (mass in kilograms through the mass seams; costs in the BOM's declared currency); the runner introduces no quantities",
  tolerance: "mass seams compare within 1e-9 kg; the budget seam compares against the brief's declared bound exactly; verdict seams compare by equality",
  screening: false,
  reference: "golden end-to-end case (the robot brief runs every link to a SIGNED chain receipt) in server/tests/conkay-orc-chain-run.test.js",
  graphProp: NS,
  targets: crTargets,
  run: crRun,
});

export default { chainRun, CHAIN_ID };
