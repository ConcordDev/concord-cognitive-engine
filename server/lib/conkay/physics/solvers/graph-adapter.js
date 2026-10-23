// server/lib/conkay/physics/solvers/graph-adapter.js
//
// Shared helpers for making a solver reachable from the ConKay design graph.
//
// ── Why this file exists ────────────────────────────────────────────────────
//
// The registry contract in `graph/engine.js` is:
//
//     for (const target of s.targets(graph)) {
//       s.run(contextFor(target), target);
//     }
//
// `targets` must be a FUNCTION returning node ids, and `run` receives
// `(ctx, targetId)` where `ctx.get(id, "props.some.path")` reads that node's
// properties. A solver that registers `targets: () => []` is therefore
// invisible to the graph: it can only ever be called as a plain helper
// function. That is fine for a library function and useless for a solver.
//
// Every robotics solver added for the humanoid-walking work shipped with
// `targets: () => []`, which meant none of them could ever run as part of a
// design. Rather than hand-write the same five lines 24 times (and drift),
// each solver declares a prop path and gets its `targets`/`run` from here.
//
// ── How a solver declares itself ────────────────────────────────────────────
//
//     registerSolver({
//       id: "gait.slope-walking",
//       ...,
//       graphProp: "gait.slope",        // node property namespace
//       targets: graphTargets("gait.slope"),
//       run: graphRunner("gait.slope", (ctx, id, props) => {
//         return slopeWalking(props);
//       }),
//     });
//
// `graphTargets(ns)` finds every node carrying `props[ns]`. `graphRunner`
// reads the whole `props[ns]` subtree and hands it to the pure function.
//
// ── Honesty ─────────────────────────────────────────────────────────────────
//
// If a node carries the namespace but the required fields are absent, the
// runner returns `{ notComputed: ... }` naming the missing field. It NEVER
// substitutes defaults and NEVER reports a pass it could not compute.

/** True when a node carries the given top-level prop namespace. */
export function nodeHasProp(node, namespace) {
  return Boolean(node && node.props && node.props[namespace]);
}

/**
 * Build a `targets(graph)` function that selects every node carrying
 * `namespace` under its props.
 *
 * @param {string} namespace  e.g. "gait.slope"
 * @param {object} [opts]
 * @param {(node: object) => boolean} [opts.filter] extra predicate
 * @returns {(graph: {nodes: Map<string, object>}) => string[]}
 */
export function graphTargets(namespace, opts = {}) {
  return function targets(graph) {
    if (!graph || !graph.nodes) return [];
    const out = [];
    for (const [id, node] of graph.nodes) {
      if (!nodeHasProp(node, namespace)) continue;
      if (opts.filter && !opts.filter(node, id)) continue;
      out.push(id);
    }
    return out;
  };
}

/**
 * Build a `run(ctx, id)` function that reads `props[namespace]` from the node
 * and delegates to `fn(ctx, id, props)`.
 *
 * The props subtree is passed through verbatim — no field is renamed, dropped
 * or defaulted on the way through.
 */
export function graphRunner(namespace, fn) {
  return function run(ctx, id) {
    let props = null;
    try {
      props = ctx.get(id, `props.${namespace}`);
    } catch {
      props = null;
    }
    if (props === undefined) props = null;
    if (props === null || (typeof props === "object" && !Array.isArray(props) && Object.keys(props).length === 0)) {
      return { notComputed: `props.${namespace} is empty or absent on node ${id}` };
    }
    return fn(ctx, id, props);
  };
}

/**
 * Convenience: produce both halves of the registry contract at once.
 *
 *     const graph = graphBlock("gait.slope", (ctx, id, props) => slopeWalking(props));
 *     registerSolver({ id, ..., targets: graph.targets, run: graph.run });
 */
export function graphBlock(namespace, fn, opts = {}) {
  return { targets: graphTargets(namespace, opts), run: graphRunner(namespace, fn) };
}

/**
 * Wrap a pure solver result into the graph engine envelope shape.
 *
 * The engine stores whatever `run` returns as the run envelope. By default
 * we pass the raw solver result through unchanged so that callers using the
 * function directly (helpers, tests, pipelines) see exactly what the pure
 * solver produced, while the graph engine still gets a structured shape it
 * can store as `run.envelope`.
 *
 * Pass `wrap: true` to add the explicit `{status, inputs, outputs, margins,
 * assumptions}` envelope — useful when the engine's downstream screening
 * wants to read the structured form.
 */
export function envelope(result, { inputs = null, assumptions = [], wrap = false } = {}) {
  if (!result || typeof result !== "object") return result;
  if (result.notComputed || result.not_computed) return result;
  if (result.status === "not_computed") return result;
  if (!wrap) return result;
  return {
    status: result.status ?? "ok",
    inputs,
    outputs: result,
    margins: result.margins ?? [],
    assumptions,
  };
}