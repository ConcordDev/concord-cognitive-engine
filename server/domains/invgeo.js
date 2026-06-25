// server/domains/invgeo.js
//
// Invariant Geometry Mapper (#20) — macro over lib/invariant-geometry.js.
// Surfaces the LIVE invariant co-violation graph (real telemetry from
// emergent/atlas-invariants.js) in the {nodes, edges} shape GraphView renders,
// plus a Betti-style topological summary. Read-only, no DB.
//
// Registered from server.js: registerInvgeoMacros(register).

import { invariantGraph } from "../lib/invariant-geometry.js";

export default function registerInvgeoMacros(register) {
  register("invgeo", "graph", async (_ctx, input = {}) => {
    return invariantGraph({ windowMs: input.windowMs });
  }, { note: "live invariant co-violation graph + topological summary for GraphView (#20)" });
}
