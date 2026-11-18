// server/lib/conkay/orc/iterate.js
//
// SX-ORC-08 — orc.iterate: generic iterate-to-physical loop
// (catalogue wave 0, PRG-17). Target tier L3 routes the loop's
// top-tier checks through kernel settle — engine ticket SXE-21,
// which is not available in this lane, so every run carries that
// tier as NOT_COMPUTED engine_unavailable:sxe-21.
//
// The loop itself already exists and is generic: iterate/loop.js
// compiles a Design IR, runs the registry, collects failed
// checks, and for each failure tries the bounded design variables
// the failing run actually depends on (the engine records every
// value a solver reads, so the link is computed, not declared),
// keeping a trial only when the failing check passes and nothing
// that passed before regresses. Today it is reachable only
// through the car evaluator and the Sentinel demo. This solver is
// its registry form: any design that arrives as props — an IR plus
// bounded design variables — gets the loop.
//
// The loop's own invariants ride unchanged and are surfaced, not
// reimplemented: requirements and locked inputs are hashed before
// and after and NEVER edited (a design variable touching one
// refuses the run up front, named — the ticket's adversarial
// bound); when no bounded variable can fix a check, requirement
// changes are LISTED as options, never applied; domains are
// reported side by side, never combined into one score.
//
// Standing guard: orc.iterate always excludes ITSELF from the
// inner loop's solver set. A design carrying orc.iterate props
// inside the iterated design would otherwise recurse; the
// exclusion is named in the outputs, not silent.

import { registerSolver } from "../physics/registry.js";
import { iterateToPhysical } from "../iterate/loop.js";

const NS = "orc.iterate";
const SELF = "orc.iterate";

const ENGINE_TIER = {
  requested: "L3-kernel-settle",
  status: "NOT_COMPUTED",
  reason: "engine_unavailable:sxe-21",
  hint: "the kernel-settle tier (top-tier solvers settled by the kernel) is engine ticket SXE-21; the JS iterate-to-physical loop below runs without it",
};

/** The pure solver function. Exported for direct testing. */
export function iterate(props = {}) {
  const design = props?.design;
  if (!design || typeof design !== "object" || !Array.isArray(design.nodes)) {
    return { notComputed: "missing_input:design (an IR object with a nodes array)", inputs: {} };
  }
  const variables = props?.variables;
  if (!Array.isArray(variables) || variables.length === 0) {
    return { notComputed: "missing_input:variables (bounded design variables — the loop repairs only within declared bounds)", inputs: {} };
  }
  let maxIterations = 8;
  if (props.maxIterations != null) {
    const m = Number(props.maxIterations);
    if (!Number.isInteger(m) || m < 1 || m > 64) {
      return { notComputed: "INVALID_INPUT: maxIterations must be an integer between 1 and 64", inputs: {} };
    }
    maxIterations = m;
  }
  const callerExclusions = Array.isArray(props.excludeSolvers) ? props.excludeSolvers : [];
  const excludeSolvers = [...new Set([...callerExclusions, SELF])];

  const res = iterateToPhysical(design, { designVariables: variables, excludeSolvers, maxIterations });
  if (!res.ok) {
    return { notComputed: `INVALID_INPUT: ${res.errors.join("; ")}`, inputs: {} };
  }
  const r = res.report;
  const slim = (list) => (list || []).map((c) => ({ runId: c.runId, status: c.status, domain: c.domain ?? null }));
  const warnings = [`kernel-settle tier NOT_COMPUTED: ${ENGINE_TIER.reason} (JS loop reported beside it, labelled)`];
  if (!r.converged) warnings.push(`loop did NOT converge in ${r.iterations} iteration(s) — remaining failures stand in finalChecks; requirement changes are listed as options only, never applied`);
  return {
    inputs: props,
    outputs: {
      engineTier: ENGINE_TIER,
      converged: r.converged,
      iterations: r.iterations,
      maxIterations: r.maxIterations,
      loopVersion: r.loopVersion,
      initialChecks: slim(r.initial),
      finalChecks: slim(r.checks),
      finalFailures: slim(r.checks).filter((c) => c.status === "FAIL"),
      byDomain: r.byDomain,
      repairs: r.repairs,
      requirementOptions: r.requirementOptions,
      requirementsUnchanged: r.requirementsUnchanged,
      selfExclusion: `${SELF} is always excluded from the inner loop's solver set (recursion guard)`,
      excludedSolvers: excludeSolvers,
      receipt: r.receipt,
      finalDesign: r.finalDesign,
    },
    assumptions: [],
    warnings,
  };
}

// Local targets/run pair (literal-key discipline; graph-adapter finding
// filed under SX-ORC-01).
function itTargets(graph) {
  if (!graph || !graph.nodes) return [];
  const out = [];
  for (const [id, node] of graph.nodes) {
    if (node && node.props && node.props[NS]) out.push(id);
  }
  return out;
}

function itRun(ctx, id) {
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
  return iterate(props);
}

registerSolver({
  id: "orc.iterate",
  version: "1.0.0",
  domain: "orchestration",
  domains: ["orchestration"],
  method: "iterate.bounded-repair-loop",
  fidelity: 3,
  engineDependent: ["sxe-21"],
  regime: "designs expressed as IR with bounded design variables (ordered option lists, at least two options each); the loop repairs envelope-level FAIL checks only — verdict fields inside a solver's outputs are data, not loop failures",
  units: "inherited from the iterated design's solvers; the loop introduces no quantities of its own",
  tolerance: "deterministic: identical design + variables + registry always produce the identical repair sequence (checks processed in runId order, options in declared order)",
  screening: false,
  reference: "reference case (the Sentinel M1 golden robot converges under bounded repairs) in server/tests/conkay-orc-iterate.test.js",
  graphProp: NS,
  targets: itTargets,
  run: itRun,
});

export default { iterate };
