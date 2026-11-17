// server/lib/conkay/orc/requirements.js
//
// SX-ORC-02 — orc.requirements: requirements extraction and flow-down
// (catalogue wave 0, PRG-17). Generalizes compiler/requirement-parser.js
// (brief -> numeric targets with units and the exact source words) into
// a registered solver that emits requirements in the NASA SE Handbook
// shape (NASA/SP-2016-6105 Rev2): every requirement carries its level,
// its bound in SI with the as-given value echoed, its source (the exact
// words it came from, or the parent requirement it was derived from),
// and a verification method (analysis / test / inspection /
// demonstration) with either a verifying solver that EXISTS in the
// registry or an explicit flag saying why none is named.
//
// Flow-down at this tier: the system mass bound is allocated to
// subsystems by DECLARED fractions. The fractions are inputs
// (props.allocations); the built-in table is used only when no input
// is given, and every fraction actually used is echoed in assumptions
// as a defaulted value (SC-03) — an allocation is policy, not physics,
// and is never presented as either. Other metrics are verified at
// system level and are not silently subdivided. Part-level flow-down
// requires the architecture step (SX-ORC-03) and is named as such.
//
// Honesty: no text -> NOT_COMPUTED missing_input:text; a brief with no
// numeric targets -> NOT_COMPUTED no_requirements_extracted (ORC-01
// owns the general parse); allocation fractions outside (0, 1] or
// summing over 1 -> INVALID_INPUT naming the field.

import { registerSolver, getSolver } from "../physics/registry.js";
import { parseBrief } from "../compiler/requirement-parser.js";

const NS = "orc.requirements";

export const DEFAULT_ALLOCATIONS = Object.freeze({
  structure: 0.3,
  propulsion: 0.25,
  energyStorage: 0.25,
  payloadAndAvionics: 0.2,
});

// metric -> { method, solver } — the solver is named only when it is
// registered at this build; getSolver is consulted at run time so the
// map can never name a solver that does not exist.
const VERIFICATION = {
  mass: { method: "analysis", solver: "cad.mass-properties-brep" },
  topSpeed: { method: "analysis", solver: null },
  range: { method: "analysis", solver: null },
  power: { method: "analysis", solver: null },
  designWindSpeed: { method: "analysis", solver: null },
  seats: { method: "inspection", solver: null },
  budget: { method: "analysis", solver: null },
};

function verificationFor(metric) {
  const v = VERIFICATION[metric] || { method: "analysis", solver: null };
  if (v.solver && getSolver(v.solver)) {
    return { method: v.method, verifyingSolver: v.solver, status: "verifiable" };
  }
  if (v.method === "inspection") {
    return { method: v.method, verifyingSolver: null, status: "verifiable-by-inspection" };
  }
  return {
    method: v.method,
    verifyingSolver: null,
    status: "flagged-no-verifying-solver",
    flagReason: `no registered verifying solver for metric "${metric}" at this build`,
  };
}

function checkAllocations(input) {
  const alloc = input || DEFAULT_ALLOCATIONS;
  let sum = 0;
  for (const [k, v] of Object.entries(alloc)) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0 || n > 1) {
      return { error: `INVALID_INPUT: allocations.${k} must be a fraction in (0, 1]` };
    }
    sum += n;
  }
  if (sum > 1 + 1e-9) {
    return { error: `INVALID_INPUT: allocations sum to ${sum.toFixed(4)}, over 1 — a flow-down may not allocate more than the system bound` };
  }
  return { alloc, defaulted: !input };
}

/** The pure solver function. Exported for direct testing. */
export function deriveRequirements(props = {}) {
  const text = props?.text;
  if (typeof text !== "string" || !text.trim()) {
    return { notComputed: "missing_input:text", inputs: {} };
  }
  const chk = checkAllocations(props?.allocations);
  if (chk.error) return { notComputed: chk.error, inputs: { text } };

  const { requirements: parsed, intent } = parseBrief(text);
  if (!parsed.length) {
    return {
      notComputed: "no_requirements_extracted: the brief carries no numeric targets in the requirement vocabulary (mass, topSpeed, range, power, seats, budget, designWindSpeed)",
      inputs: { text },
    };
  }

  const assumptions = [];
  if (chk.defaulted) {
    for (const [k, v] of Object.entries(DEFAULT_ALLOCATIONS)) {
      assumptions.push({
        field: `allocations.${k}`,
        value: v,
        kind: "defaulted",
        source: "built-in allocation policy table (declared; override via props.allocations)",
      });
    }
  }

  const requirements = [];
  for (const r of parsed) {
    const boundKind = r.max ? "max" : "min";
    const bound = r[boundKind];
    const req = {
      id: `REQ-SYS-${r.metric}`,
      level: "system",
      metric: r.metric,
      bound: { kind: boundKind, si: bound.si, unit: bound.unit, dim: bound.dim, ...(bound.given != null ? { given: bound.given } : {}) },
      source: r.source,
      verification: verificationFor(r.metric),
    };
    requirements.push(req);

    if (r.metric === "mass" && boundKind === "max") {
      for (const [sub, frac] of Object.entries(chk.alloc)) {
        requirements.push({
          id: `REQ-SUB-${sub}-mass`,
          level: "subsystem",
          metric: "mass",
          subsystem: sub,
          bound: { kind: "max", si: bound.si * frac, unit: bound.unit, dim: bound.dim },
          source: `derived from REQ-SYS-mass by declared allocation fraction ${frac} (${chk.defaulted ? "defaulted policy" : "caller-supplied"})`,
          derivedFrom: "REQ-SYS-mass",
          allocationFraction: frac,
          verification: verificationFor("mass"),
        });
      }
    }
  }

  return {
    inputs: { text, allocations: chk.alloc },
    outputs: {
      requirements,
      intent: intent || null,
      flowDown: {
        levels: ["system", "subsystem"],
        partLevel: "requires orc.system-architecture (SX-ORC-03) — parts are not named at this step, and no part requirement is invented here",
      },
      flagged: requirements.filter((r) => r.verification.status === "flagged-no-verifying-solver").map((r) => r.id),
    },
    assumptions,
    warnings: [],
  };
}

// Local targets/run pair (literal-key discipline; graph-adapter finding
// filed under SX-ORC-01).
function reqTargets(graph) {
  if (!graph || !graph.nodes) return [];
  const out = [];
  for (const [id, node] of graph.nodes) {
    if (node && node.props && node.props[NS]) out.push(id);
  }
  return out;
}

function reqRun(ctx, id) {
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
  return deriveRequirements(props);
}

registerSolver({
  id: "orc.requirements",
  version: "1.0.0",
  domain: "orchestration",
  domains: ["orchestration"],
  method: "requirements.flow-down",
  fidelity: 1,
  regime: "briefs carrying numeric targets in the requirement-parser vocabulary (mass, topSpeed, range, power, seats, budget, designWindSpeed)",
  units: "SI inside; every bound echoes its as-given value and unit beside the SI value",
  tolerance: "exact arithmetic on extracted SI values; allocation fractions are declared policy, echoed in assumptions when defaulted",
  screening: true,
  reference: "NASA Systems Engineering Handbook (NASA/SP-2016-6105 Rev2) — requirements flow-down and the analysis/test/inspection/demonstration verification taxonomy",
  graphProp: NS,
  targets: reqTargets,
  run: reqRun,
});

export default { deriveRequirements, DEFAULT_ALLOCATIONS };
