/**
 * Distributed-Load-to-Nodes Lumping — tributary-length method
 *
 * server/lib/simulation/fea-solver.js's direct-stiffness solver only
 * accepts POINT loads at nodes ({ nodeId, Fx?, Fy?, Fz?, ... }) — it has
 * no concept of a uniformly distributed load (UDL) along a member. A
 * beam's own self-weight (or any other UDL: insulation weight, snow,
 * wind pressure on a flat run) is a UDL, and turning that into the point
 * loads the solver actually accepts is standard textbook beam-FEA
 * practice — "tributary length" / "consistent nodal load" lumping (see
 * any direct-stiffness-method text, e.g. Hibbeler's "Structural
 * Analysis" — this is not a novel approximation, it's how every
 * beam-frame FEA package turns a UDL into nodal loads for a discretized
 * model).
 *
 * No such helper existed anywhere in this codebase before this file —
 * the `gravity` flag `engineering.saveLoadCase` stores was never actually
 * consumed to compute a self-weight load. This is the real missing
 * plumbing, not a re-derivation of physics that already existed
 * elsewhere.
 */

/**
 * Lump a uniform load (force per unit length, e.g. self-weight = mass
 * per length * g) onto an ORDERED chain of collinear nodes as point
 * loads, via tributary-length: each node carries the UDL over half the
 * span to each of its neighbours. End nodes get one half-span; interior
 * nodes get the sum of both adjacent half-spans.
 *
 * @param {Array<{id, x, y, z}>} orderedNodes - nodes in physical order
 *   along the member chain (node[0]..node[N-1]), coordinates in meters.
 * @param {number} loadPerMeter - N/m, positive magnitude. Sign/direction
 *   is applied via `axis` + the caller's sign convention (gravity is
 *   conventionally negative Fy).
 * @param {'x'|'y'|'z'} [axis='y'] - which force component to populate.
 * @returns {Array<{nodeId, Fx?, Fy?, Fz?}>} point loads ready to append
 *   to a runFEA model's `loads` array.
 */
export function lumpUniformLoadToNodes(orderedNodes, loadPerMeter, axis = 'y') {
  const nodes = Array.isArray(orderedNodes) ? orderedNodes : [];
  if (nodes.length < 2 || !Number.isFinite(loadPerMeter)) return [];
  const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y, (b.z || 0) - (a.z || 0));
  const spans = [];
  for (let i = 0; i < nodes.length - 1; i++) spans.push(dist(nodes[i], nodes[i + 1]));
  const fKey = axis === 'x' ? 'Fx' : axis === 'z' ? 'Fz' : 'Fy';
  return nodes.map((n, i) => {
    const before = i > 0 ? spans[i - 1] / 2 : 0;
    const after = i < spans.length ? spans[i] / 2 : 0;
    const tributaryLength = before + after;
    return { nodeId: n.id, [fKey]: loadPerMeter * tributaryLength };
  });
}
