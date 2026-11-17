// server/lib/conkay/orc/edit-commands.js
//
// SX-ORC-10 — orc.edit-commands: deterministic plain-language edits
// (catalogue wave 0, PRG-17). Generalizes compiler/edit-parser.js
// (parseEdit: sentence -> {node, path, value} ops, or an error it can
// show) into a registered solver that APPLIES the ops to the design
// IR and reports exactly what changed:
//
//   - ops: the parser's op list, verbatim;
//   - editedNodes / untouchedNodes: the full partition of the design's
//     nodes — the reference case's "edits every bracket, nothing else"
//     is checkable from the output alone;
//   - inverseOps: every op's prior value, so the edit is undoable by
//     construction (applying inverseOps restores the design);
//   - design: the edited IR.
//
// An edit the parser cannot read is NOT_COMPUTED carrying the parser's
// error verbatim — never a guessed node, never a guessed number (the
// parser's own doctrine). Rerun invalidation is NOT re-implemented
// here: it is the DesignEngine's recorded-reads staleness, and the
// edited node set this solver returns is exactly its input.

import { registerSolver } from "../physics/registry.js";
import { DesignGraph } from "../graph/design-graph.js";
import { parseEdit } from "../compiler/edit-parser.js";

const NS = "orc.edit-commands";

function getPath(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for (const k of keys.slice(0, -1)) {
    if (o[k] == null || typeof o[k] !== "object") o[k] = {};
    o = o[k];
  }
  o[keys[keys.length - 1]] = value;
}

/** Apply an op list to a design IR (pure: returns a new IR). */
export function applyOps(design, ops) {
  const next = structuredClone(design);
  const byId = new Map((next.nodes || []).map((n) => [n.id, n]));
  for (const op of ops) {
    const node = byId.get(op.node);
    if (node) setPath(node, op.path, op.value);
  }
  return next;
}

/** The pure solver function. Exported for direct testing. */
export function editCommands(props = {}) {
  const text = props?.text;
  if (typeof text !== "string" || !text.trim()) {
    return { notComputed: "missing_input:text", inputs: {} };
  }
  const design = props?.design;
  if (!design || typeof design !== "object" || !Array.isArray(design.nodes)) {
    return { notComputed: "missing_input:design", inputs: { text } };
  }
  const built = DesignGraph.fromIR(design);
  if (!built.ok) {
    return { notComputed: `INVALID_INPUT: design does not compile: ${(built.errors || []).join("; ")}`, inputs: { text } };
  }
  const parsed = parseEdit(text, built.graph);
  if (!parsed.ok) {
    return { notComputed: `edit_not_read: ${parsed.error}`, inputs: { text } };
  }
  const byId = new Map((design.nodes || []).map((n) => [n.id, n]));
  const inverseOps = parsed.ops.map((op) => ({
    node: op.node,
    path: op.path,
    value: getPath(byId.get(op.node), op.path),
  }));
  const edited = applyOps(design, parsed.ops);
  const editedNodes = [...new Set(parsed.ops.map((o) => o.node))];
  const untouchedNodes = (design.nodes || []).map((n) => n.id).filter((id) => !editedNodes.includes(id));
  return {
    inputs: { text },
    outputs: {
      ops: parsed.ops,
      notes: parsed.notes || [],
      editedNodes,
      untouchedNodes,
      inverseOps,
      design: edited,
    },
    assumptions: [],
    warnings: [],
  };
}

// Local targets/run pair (literal-key discipline; graph-adapter finding
// filed under SX-ORC-01). The typed input carries the design IR
// explicitly ({text, design}) — the same shape solve.direct /
// conkay_solve use — so the run is the pure function over the props.
function editTargets(graph) {
  if (!graph || !graph.nodes) return [];
  const out = [];
  for (const [id, node] of graph.nodes) {
    if (node && node.props && node.props[NS]) out.push(id);
  }
  return out;
}

function editRun(ctx, id) {
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
  return editCommands(props);
}

registerSolver({
  id: "orc.edit-commands",
  version: "1.0.0",
  domain: "orchestration",
  domains: ["orchestration"],
  method: "edit-commands.apply",
  fidelity: 0,
  regime: "designs in the design-IR vocabulary; edit sentences in compiler/edit-parser.js's deterministic grammar (materials, geometry params, named props, tyre speed rating)",
  units: "quantities in edit sentences are parsed by the units layer and stored SI (a 12 mm thickness lands as 0.012 m)",
  tolerance: "exact: the op list is the parser's output verbatim; the edited/untouched partition covers every node exactly once",
  screening: true,
  reference: "compiler/edit-parser.js's deterministic grammar (the cited source is the parser itself); reference case in server/tests/conkay-orc-edit-commands.test.js",
  graphProp: NS,
  targets: editTargets,
  run: editRun,
});

export default { editCommands, applyOps };
