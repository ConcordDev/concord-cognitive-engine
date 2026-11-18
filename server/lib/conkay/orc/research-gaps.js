// server/lib/conkay/orc/research-gaps.js
//
// SX-ORC-11 — orc.research-gaps: missing data → research queue
// (catalogue wave 0, PRG-17). Target tier L1 routes every gap to
// the research engine — literal re-find and SSRF-guarded fetch,
// engine ticket SXE-41. That engine is B2's build and is not
// available in this lane, so EVERY run carries the engine tier as
// NOT_COMPUTED engine_unavailable:sxe-41.
//
// What this solver computes now is the QUEUE, and the queue is the
// honesty mechanism: a declared data gap (a missing value, an
// unsourced property, an unreadable input) becomes a stable queue
// item naming the property, the requesting solver, the unit, and
// the source class that would satisfy it (textbook / datasheet /
// standard — free public sources only). The one thing the queue
// never does is fill the gap itself: every queued property stays
// NOT_COMPUTED with its reason until the engine returns a SOURCED
// value. A guessed allowable with a citation-shaped costume is the
// exact failure this ticket exists to prevent — the reference case
// is a missing allowable becoming a queue item while the requesting
// solver stays NOT_COMPUTED.
//
// Duplicate needs (same property for the same requester) are
// deduped into one queue item with an occurrence count — a queue
// with the same gap filed five times is one gap, counted five
// times, and the dedup is reported, not silent.

import { registerSolver } from "../physics/registry.js";

const NS = "orc.researchGaps";

const GAP_KINDS = ["missing", "unsourced", "unreadable"];
const SOURCE_CLASSES = ["textbook", "datasheet", "standard"];

const ENGINE_TIER = {
  requested: "L1-research",
  status: "NOT_COMPUTED",
  reason: "engine_unavailable:sxe-41",
  hint: "the research engine (literal re-find, SSRF-guarded fetch) is engine ticket SXE-41; this solver forms the queue it will work",
};

/** The pure solver function. Exported for direct testing. */
export function researchGaps(props = {}) {
  const needs = props?.needs;
  if (!Array.isArray(needs) || needs.length === 0) {
    return { notComputed: "missing_input:needs", inputs: {} };
  }
  const byKey = new Map();
  const queue = [];
  for (let i = 0; i < needs.length; i++) {
    const n = needs[i];
    if (!n || typeof n.property !== "string" || !n.property) {
      return { notComputed: `INVALID_INPUT: needs[${i}].property must be a non-empty string`, inputs: {} };
    }
    if (!GAP_KINDS.includes(n.gapKind)) {
      return { notComputed: `INVALID_INPUT: needs[${i}].gapKind "${n.gapKind}" is not in the vocabulary (${GAP_KINDS.join(", ")})`, inputs: {} };
    }
    if (n.sourceClass != null && !SOURCE_CLASSES.includes(n.sourceClass)) {
      return { notComputed: `INVALID_INPUT: needs[${i}].sourceClass "${n.sourceClass}" is not in the vocabulary (${SOURCE_CLASSES.join(", ")}) — free public sources only`, inputs: {} };
    }
    const forSolver = n.forSolver ?? null;
    if (forSolver != null && (typeof forSolver !== "string" || !forSolver)) {
      return { notComputed: `INVALID_INPUT: needs[${i}].forSolver must be a non-empty string when given`, inputs: {} };
    }
    const key = `${n.property}::${forSolver ?? ""}`;
    if (byKey.has(key)) {
      const item = byKey.get(key);
      item.occurrences += 1;
      continue;
    }
    const item = {
      item: queue.length + 1,
      property: n.property,
      forSolver,
      gapKind: n.gapKind,
      unit: n.unit ?? null,
      sourceClass: n.sourceClass ?? null,
      context: n.context ?? null,
      status: "QUEUED",
      engine: "sxe-41",
      valueStatus: "NOT_COMPUTED",
      valueReason: `no value is guessed for "${n.property}" — it lands only when the research engine returns a sourced value`,
      occurrences: 1,
    };
    byKey.set(key, item);
    queue.push(item);
  }
  const deduped = needs.length - queue.length;
  const warnings = [`research engine tier NOT_COMPUTED: ${ENGINE_TIER.reason} (queue reported beside it, labelled)`];
  if (deduped > 0) warnings.push(`${deduped} duplicate need(s) deduped into existing queue items (occurrences counted per item)`);
  return {
    inputs: { needs },
    outputs: {
      engineTier: ENGINE_TIER,
      queue,
      queueCount: queue.length,
      needsDeclared: needs.length,
      deduped,
      staysNotComputed: true,
      rule: "a queued property has no value until the research engine returns a sourced one; nothing in this output is a value, an estimate, or a default",
    },
    assumptions: [],
    warnings,
  };
}

// Local targets/run pair (literal-key discipline; graph-adapter finding
// filed under SX-ORC-01).
function rgTargets(graph) {
  if (!graph || !graph.nodes) return [];
  const out = [];
  for (const [id, node] of graph.nodes) {
    if (node && node.props && node.props[NS]) out.push(id);
  }
  return out;
}

function rgRun(ctx, id) {
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
  return researchGaps(props);
}

registerSolver({
  id: "orc.research-gaps",
  version: "1.0.0",
  domain: "orchestration",
  domains: ["orchestration"],
  method: "research-gaps.queue-formation",
  fidelity: 1,
  engineDependent: ["sxe-41"],
  regime: "declared data gaps of three kinds (missing, unsourced, unreadable) with free-public source classes (textbook, datasheet, standard); the queue forms in JS, the research itself is the engine tier",
  units: "each need carries its own declared unit, echoed on the queue item; the solver introduces no quantities",
  tolerance: "exact queue formation; duplicates dedupe on (property, requesting solver) with occurrences counted",
  screening: false,
  reference: "reference case (a missing allowable becomes a queue item; the value stays NOT_COMPUTED) in server/tests/conkay-orc-research-gaps.test.js",
  graphProp: NS,
  targets: rgTargets,
  run: rgRun,
});

export default { researchGaps };
