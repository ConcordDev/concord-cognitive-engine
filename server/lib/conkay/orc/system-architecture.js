// server/lib/conkay/orc/system-architecture.js
//
// SX-ORC-03 — orc.system-architecture: system architecture synthesis
// (catalogue wave 0, PRG-17). Composes the landed ORC-01 intent parse
// and ORC-02 requirements over compiler/architectures.js:
//
//   - KNOWN KINDS keep their compiled architecture: compileBrief's
//     nodes are the subsystems, and each subsystem's allocated
//     requirements are traced through the compiled CONTAINS tree from
//     the requirements' solver targets. architectures.js invents
//     nothing, and neither does this solver.
//   - ANY OTHER PRODUCT gets generic synthesis from the canonical
//     subsystem taxonomy the ticket itself declares (structure,
//     armor/enclosure, interior, power, propulsion/actuation,
//     thermal, electrical, compute/controls, sensors, interfaces).
//     Every subsystem is parented on the root requirement — the
//     brief, verbatim — and system requirements from ORC-02 are
//     allocated by a DECLARED metric->subsystem table. A metric the
//     table does not allocate is listed unallocated with its reason,
//     verbatim, never dropped and never force-fit.
//
// Alternatives are enumerated at the architecture level for trade
// study: when a compiled architecture exists, the generic taxonomy
// stands beside it as the alternative (and vice versa the compiled
// absence is named with compileBrief's own error). The SXE-21 engine
// leg (engine-grade architecture verification) rides as
// NOT_COMPUTED engine_unavailable:sxe-21 beside the JS synthesis,
// labelled — the synthesis is never dressed as the engine result.

import { registerSolver } from "../physics/registry.js";
import { parseIntentBrief } from "./intent-parse.js";
import { deriveRequirements } from "./requirements.js";
import { compileBrief } from "../compiler/architectures.js";

const NS = "orc.systemArchitecture";

// The canonical taxonomy, as declared in the ticket text.
export const TAXONOMY = [
  ["structure", "Structure"],
  ["armor-enclosure", "Armor / enclosure"],
  ["interior", "Interior"],
  ["power", "Power"],
  ["propulsion-actuation", "Propulsion / actuation"],
  ["thermal", "Thermal"],
  ["electrical", "Electrical"],
  ["compute-controls", "Compute / controls"],
  ["sensors", "Sensors"],
  ["interfaces", "Interfaces"],
];

// Declared allocation of ORC-02 system-requirement metrics to
// taxonomy subsystems. Metrics absent here are NOT force-fit: they
// are reported unallocated with a reason.
export const ALLOCATION = {
  mass: ["structure", "power", "propulsion-actuation"],
  topSpeed: ["propulsion-actuation", "structure"],
  power: ["power", "thermal"],
  range: ["power", "propulsion-actuation"],
  seats: ["interior"],
  designWindSpeed: ["structure"],
};

const ENGINE_TIER = {
  requested: "L2",
  status: "NOT_COMPUTED",
  reason: "engine_unavailable:sxe-21",
  hint: "engine-grade architecture verification against the CAD kernel is engine ticket SXE-21; the in-process synthesis (compiled architectures + declared taxonomy) is reported beside it, labelled",
};

/** The pure solver function. Exported for direct testing. */
export function systemArchitecture(props = {}) {
  const text = props?.text;
  if (typeof text !== "string" || !text.trim()) {
    return { notComputed: "missing_input:text", inputs: {} };
  }
  const intent = parseIntentBrief({ text });
  const reqResult = deriveRequirements({ text });
  const compiled = compileBrief(text);
  // Content-bearing if ANY leg of the chain can read the brief: ORC-01's
  // quantity vocabulary and ORC-02's requirement vocabulary differ
  // (a budget-only brief — "under $900" — is requirement content with
  // no ORC-01 quantities), so the content-free verdict requires all
  // three legs to find nothing.
  if (intent.notComputed && reqResult.notComputed && compiled.error) {
    return { notComputed: intent.notComputed, inputs: { text } };
  }
  const systemReqs = reqResult.notComputed
    ? []
    : (reqResult.outputs?.requirements || []).filter((r) => r.level === "system");
  const root = { id: "REQ-SYS-ROOT", kind: "root", source: text };

  const warnings = [`engine tier L2 verification NOT_COMPUTED: ${ENGINE_TIER.reason} (JS synthesis reported beside it, labelled)`];
  let architecture;
  let subsystems;
  let alternatives;
  let unallocated = [];
  let unmapped = [];

  if (!compiled.error && compiled.ir && Array.isArray(compiled.ir.nodes)) {
    architecture = { kind: "compiled", id: compiled.architecture };
    // Requirement coverage through the CONTAINS tree: a requirement
    // allocated to a node covers that node and its descendants.
    const children = new Map();
    for (const e of compiled.ir.edges || []) {
      if (e.type !== "CONTAINS") continue;
      if (!children.has(e.from)) children.set(e.from, []);
      children.get(e.from).push(e.to);
    }
    const descendants = (id, acc = new Set()) => {
      for (const c of children.get(id) || []) {
        if (!acc.has(c)) {
          acc.add(c);
          descendants(c, acc);
        }
      }
      return acc;
    };
    const allocByNode = new Map();
    const allocatedIds = new Set();
    for (const req of compiled.ir.requirements || []) {
      const covered = new Set([req.of.target, ...descendants(req.of.target)]);
      for (const id of covered) {
        if (!allocByNode.has(id)) allocByNode.set(id, []);
        allocByNode.get(id).push(req.id);
      }
      allocatedIds.add(req.id);
    }
    const rootNode = compiled.ir.nodes[0]?.id;
    subsystems = compiled.ir.nodes
      .filter((n) => n.id !== rootNode)
      .map((n) => ({
        id: n.id,
        name: n.name,
        kind: n.kind,
        parentRequirement: root.id,
        allocatedRequirements: allocByNode.get(n.id) || [],
      }));
    unmapped = compiled.unmapped || [];
    alternatives = [
      { id: `compiled:${compiled.architecture}`, kind: "compiled", source: "compiler/architectures.js", chosen: true },
      { id: "generic-taxonomy", kind: "generic", source: "declared canonical taxonomy (SX-ORC-03)", chosen: false },
    ];
  } else {
    architecture = { kind: "generic", id: "generic-taxonomy" };
    const allocBySub = new Map(TAXONOMY.map(([id]) => [id, []]));
    const allocatedIds = new Set();
    for (const req of systemReqs) {
      const targets = ALLOCATION[req.metric];
      if (!targets) {
        unallocated.push({
          requirement: req.id,
          metric: req.metric,
          reason: req.metric === "budget"
            ? "cost rolls up over all subsystems; it is allocated at the system report (SX-ORC-12), not to one subsystem"
            : `no declared allocation for metric "${req.metric}" in the SX-ORC-03 table`,
        });
        continue;
      }
      for (const t of targets) allocBySub.get(t).push(req.id);
      allocatedIds.add(req.id);
    }
    subsystems = TAXONOMY.map(([id, name]) => ({
      id: `SUB-${id}`,
      name,
      parentRequirement: root.id,
      allocatedRequirements: allocBySub.get(id),
    }));
    alternatives = [
      { id: "generic-taxonomy", kind: "generic", source: "declared canonical taxonomy (SX-ORC-03)", chosen: true },
    ];
    warnings.push(`no compiled architecture for this kind: ${compiled.error}`);
  }

  const allocatedIds = new Set(subsystems.flatMap((s) => s.allocatedRequirements));
  return {
    inputs: { text },
    outputs: {
      engineTier: ENGINE_TIER,
      architecture,
      rootRequirement: root,
      subsystems,
      subsystemCount: subsystems.length,
      alternatives,
      requirementCoverage: {
        allocated: [...allocatedIds],
        unallocated,
      },
      unmapped,
    },
    assumptions: [],
    warnings,
  };
}

// Local targets/run pair (literal-key discipline; graph-adapter finding
// filed under SX-ORC-01).
function saTargets(graph) {
  if (!graph || !graph.nodes) return [];
  const out = [];
  for (const [id, node] of graph.nodes) {
    if (node && node.props && node.props[NS]) out.push(id);
  }
  return out;
}

function saRun(ctx, id) {
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
  return systemArchitecture(props);
}

registerSolver({
  id: "orc.system-architecture",
  version: "1.0.0",
  domain: "orchestration",
  domains: ["orchestration"],
  method: "system-architecture.synthesize",
  fidelity: 2,
  engineDependent: ["sxe-21"],
  regime: "any product brief: known kinds (road vehicle, L-bracket) compile via compiler/architectures.js; all other kinds synthesize from the declared canonical subsystem taxonomy",
  units: "requirements carry ORC-02's SI-normalized bounds; the architecture itself is structural (no new quantities are introduced)",
  tolerance: "exact: subsystem membership and requirement allocation follow the compiled CONTAINS tree or the declared allocation table, deterministically",
  screening: true,
  reference: "the ticket's canonical subsystem taxonomy + compiler/architectures.js's compiled schemas; reference case (robot -> the ten taxonomy subsystems, each parented) in server/tests/conkay-orc-system-architecture.test.js",
  graphProp: NS,
  targets: saTargets,
  run: saRun,
});

export default { systemArchitecture, TAXONOMY, ALLOCATION };
