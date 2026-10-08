// server/lib/conkay/physics/solvers/package.js
//
// Occupant package. package.seat-count counts the Seat nodes a vehicle (or
// any assembly) contains, so a "seats 4" requirement is judged on the design,
// not on the brief. Seat geometry and occupant envelopes (hip point,
// headroom, legroom) are not checked yet: coverage reports that gap.

import { registerSolver } from "../registry.js";

function seatsIn(ctx, id, seen = new Set()) {
  let n = 0;
  for (const c of ctx.children(id, "CONTAINS")) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    if (c.kind === "Seat") n += 1;
    if (c.kind === "Assembly") n += seatsIn(ctx, c.id, seen);
  }
  return n;
}

export const seatCount = registerSolver({
  id: "package.seat-count",
  version: "1.0.0",
  domain: "package.seating",
  fidelity: 0,
  method: "count of Seat nodes contained by the assembly",
  targets: (g) => g.nodesOfKind("Assembly").filter((n) => n.props?.vehicle).map((n) => n.id),
  run(ctx, id) {
    const n = seatsIn(ctx, id);
    return {
      inputs: {},
      outputs: { seats: { value: n, unit: "1" } },
      assumptions: ["Counts seats only; occupant envelope and ergonomics are not checked."],
    };
  },
});
