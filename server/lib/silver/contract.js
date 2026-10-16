// server/lib/silver/contract.js
//
// Universal Silver, phase 1: the solver contract and how each existing source
// measures against it (~/.zuko/remaining-work/CONKAY-UNIVERSAL-SILVER-NORTHSTAR-2026-10-15.md
// sec. 6.2). Read-only: this module scores what is declared, it changes no
// solver and promotes nothing.
//
// Every field gets one state:
//   declared  stated statically by the solver / capability / macro
//   runtime   only reported per run (e.g. a ConKay envelope's inputs), not declared up front
//   inferred  derived by a heuristic here (the macro classifier), not stated by the owner
//   hint      an informal doc-comment hint (scripts/extract-macro-input-hints.mjs)
//   missing   nowhere
// Validation is always `uncertified` in v0. Evidence (tests that exist, an
// oracle case that invokes it) is listed beside it and never upgrades it:
// `benchmarked` needs a cited benchmark passing within tolerance, which this
// module cannot see.

export const CONTRACT_VERSION = "0.1.0";

/** The Silver solver contract, in display order, with what each field means. */
export const CONTRACT_FIELDS = Object.freeze([
  { id: "identity", label: "id + version", meaning: "a stable id and a version that changes when behaviour changes" },
  { id: "domain", label: "domain", meaning: "the physical / scientific domain it belongs to" },
  { id: "fidelity", label: "fidelity", meaning: "L0 symbolic, L1 analytical, L2 reduced numerical, L3 full numerical, L4 external" },
  { id: "inputs", label: "inputs", meaning: "named inputs" },
  { id: "outputs", label: "outputs", meaning: "named outputs" },
  { id: "units", label: "units", meaning: "a unit for every input and output" },
  { id: "frame", label: "frame", meaning: "the coordinate frame positions and vectors are in" },
  { id: "assumptions", label: "assumptions", meaning: "the modelling assumptions" },
  { id: "limits", label: "limits", meaning: "the validity range: out-of-range inputs are flagged, never passed" },
  { id: "method", label: "method + reference", meaning: "the method and where it comes from" },
  { id: "provenance", label: "provenance", meaning: "a receipt per run: inputs, version, hash" },
  { id: "risk", label: "risk + authorization", meaning: "side effects and who may run it" },
]);

export const VALIDATION_LEVELS = Object.freeze(["uncertified", "benchmarked", "accepted"]);

const fieldStates = (obj) => Object.fromEntries(CONTRACT_FIELDS.map((f) => [f.id, obj[f.id] || "missing"]));

/** Test files a ConKay solver's `reference` names (e.g. "...; benchmarks in tests/conkay-frame-fe.test.js"). */
export function referencedTests(reference) {
  return [...new Set(String(reference || "").match(/tests\/[\w./-]+\.test\.js/g) || [])];
}

/** A ConKay solver (physics/registry.js listSolvers() row). */
export function assessConkaySolver(s, { testExists = () => false } = {}) {
  const tests = referencedTests(s.reference);
  return {
    key: `conkay:${s.id}`,
    source: "conkay-solver",
    id: s.id,
    domain: s.domain,
    domains: s.domains || [s.domain],
    version: s.version,
    fidelity: s.fidelity,
    fields: fieldStates({
      identity: s.id && s.version ? "declared" : "missing",
      domain: s.domain ? "declared" : "missing",
      fidelity: Number.isInteger(s.fidelity) ? "declared" : "missing",
      // every ConKay run returns its inputs, outputs and assumptions in the receipt envelope
      inputs: "runtime",
      outputs: "runtime",
      units: s.units ? "declared" : "missing",
      assumptions: "runtime",
      limits: s.regime || s.tolerance ? "declared" : "missing",
      method: s.method && s.reference ? "declared" : s.method ? "declared" : "missing",
      provenance: "declared",
      risk: "inferred", // compute-only by construction (solvers read the design graph, write nothing)
    }),
    validation: "uncertified",
    evidence: {
      referencedTests: tests.map((t) => ({ path: t, exists: testExists(t) })),
      screening: s.screening ?? null,
      regime: s.regime ?? null,
    },
  };
}

/** A Runtime capability descriptor (runtime/capability-registry.js). */
export function assessCapability(c) {
  return {
    key: `capability:${c.capability}`,
    source: "runtime-capability",
    id: c.capability,
    domain: c.capability.split(".")[0],
    owner: c.owner,
    fields: fieldStates({
      identity: "declared",
      domain: "declared",
      inputs: Array.isArray(c.inputs) && c.inputs.length ? "declared" : "missing",
      outputs: Array.isArray(c.outputs) && c.outputs.length ? "declared" : "missing",
      method: c.description ? "declared" : "missing",
      risk: c.risk ? "declared" : "missing",
    }),
    validation: "uncertified",
    evidence: { risk: c.risk || null, authorization: c.authorization || null, dependencies: c.dependencies || [], implementation: c.implementation || "macro", ...(c.mcp_tool_name ? { mcpTool: c.mcp_tool_name } : {}) },
  };
}

/**
 * A plain macro (LENS_ACTIONS / MACROS). hint: MACRO_INPUT_HINTS row; depth: macro-depth-honest row;
 * cls: classifyMacro() result; oracle: ids of SUBSTRATE_ORACLE_CASES that invoke it.
 */
export function assessMacro({ domain, name, registries, hint, depth, cls, oracle = [] }) {
  return {
    key: `macro:${domain}.${name}`,
    source: "macro",
    id: `${domain}.${name}`,
    domain,
    registries,
    fields: fieldStates({
      identity: "inferred", // a name, no version
      domain: "declared",
      inputs: hint ? "hint" : "missing",
      risk: cls ? "inferred" : "missing",
    }),
    validation: "uncertified",
    evidence: {
      class: cls?.class ?? null,
      classReason: cls?.reason ?? null,
      headlessSafe: cls?.headlessSafe ?? null,
      behavioralTest: depth ? !!depth.hasTest : null,
      depthTier: depth?.tier ?? null,
      // from the macro-depth grader's parse of the handler (code, not names): no state, I/O, emits or writes
      pureCompute: depth ? !depth.stateTouch && !depth.externalIO && !depth.realtimeEmit && !depth.artifactWrite && !depth.runsOtherMacro && !depth.heartbeatDelegate : null,
      oracleCases: oracle,
    },
  };
}

/**
 * A macro is a promotion CANDIDATE (not a promotion) when it is a deterministic calculator by the
 * classifier and has at least one behavioural test or oracle case: the cheapest place to start
 * adding benchmarks, limits and units.
 */
export function isPromotionCandidate(e) {
  return candidateReason(e) !== null;
}

/**
 * Why a macro is a candidate, or null: "classifier" (a deterministic-calculator name) or
 * "pure-compute" (the macro-depth grader found no state, I/O, emits or writes in its handler);
 * either way it must also have a behavioural test or an oracle case.
 */
// Names that are not solvers even when the handler looks pure: mutations of a module-level store
// (which the macro-depth grader's state check does not see: it recognises STATE / db patterns
// only) and catalogue / status reads. Measured on a random sample before and after (see the
// gap report): the grader's "pure" alone included both kinds.
const NOT_A_SOLVER_NAME = /^(add|remove|delete|update|set|create|save|edit|rename|archive|restore|toggle|mark|assign|unassign|clear|reset|register|unregister|enroll|cancel|approve|reject|join|leave|follow|unfollow|like|unlike|pin|unpin|star|bookmark|tag|untag|list|get|status|health|stats|catalog|templates?|kinds|options|types|presets|categories|history|recent|search|browse|lookup|describe|info|help|ping|version|config|settings)([-_A-Z]|$)|[-_](list|kinds|types|catalog|options|templates|status)$/;

export function candidateReason(e) {
  if (e.source !== "macro") return null;
  const tested = e.evidence.behavioralTest === true || e.evidence.oracleCases.length > 0;
  if (!tested) return null;
  if (e.evidence.class === "A" && e.evidence.classReason === "deterministic_calculator") return "classifier";
  const name = e.id.slice(e.id.indexOf(".") + 1);
  if (e.evidence.pureCompute === true && !NOT_A_SOLVER_NAME.test(name)) return "pure-compute";
  return null;
}
