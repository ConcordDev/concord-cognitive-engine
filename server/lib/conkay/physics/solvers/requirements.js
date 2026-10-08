// server/lib/conkay/physics/solvers/requirements.js
//
// Requirement checks: compare one solver output against the requirement's
// max/min. The value always comes from a solver run; a requirement whose
// value was not computed is NOT_COMPUTED, never assumed to pass.

import { registerSolver } from "../registry.js";
import { dimensionOf } from "../../compiler/units.js";

export const requirementCheck = registerSolver({
  id: "requirement.check",
  version: "1.0.0",
  domain: "requirements",
  fidelity: 0,
  method: "compare a solver output with the requirement's bound",
  targets: (g) => g.requirements.map((r) => r.id),
  run(ctx, id) {
    const req = ctx.requirement(id);
    const env = ctx.result(req.of.solver, req.of.target);
    const out = env?.outputs?.[req.of.output];
    if (!env) return { notComputed: `no ${req.of.solver} run for ${req.of.target}`, covers: [req.of.target] };
    if (!out || !Number.isFinite(out.value)) return { notComputed: `${req.of.output} of ${req.of.target} not computed (${env.reason || env.status})`, covers: [req.of.target] };
    const dim = dimensionOf(out.unit);
    if (!dim) return { notComputed: `cannot compare ${req.of.output} in ${out.unit} with a requirement`, covers: [req.of.target] };
    const margins = [];
    for (const [bound, b] of Object.entries({ max: req.max, min: req.min })) {
      if (!b) continue;
      if (b.dim !== dim) return { notComputed: `requirement is a ${b.dim} but ${req.of.output} is a ${dim}`, covers: [req.of.target] };
      margins.push(bound === "max"
        ? { check: `${req.label}: ${req.of.output} ≤ max`, demand: out.value, capacity: b.si, unit: out.unit }
        : { check: `${req.label}: ${req.of.output} ≥ min`, demand: b.si, capacity: out.value, unit: out.unit });
    }
    return {
      inputs: { value: { value: out.value, unit: out.unit, source: env.runId } },
      outputs: { value: { value: out.value, unit: out.unit } },
      margins,
      covers: [req.of.target],
    };
  },
});
