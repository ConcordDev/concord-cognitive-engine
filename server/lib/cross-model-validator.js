// server/lib/cross-model-validator.js
//
// Cohesive R-3 — cross-model validation: definitions vs their bindings.
//
// Concord validates WITHIN models well (compileDesignIR reports every
// problem in an IR document and fills in no defaults; Gate B catches
// registry drift) but nothing validated BETWEEN models: a Design IR
// requirement could name a solver that does not exist, or a node that
// is not in its own graph, and the first surface to notice was a live
// run returning a coverage surprise. This pass is the between-model
// half, over the first enrolled pair:
//
//   Design IR documents  ↔  the ConKay physics solver registry
//
// Checks, in the brief's ModelValidator order (field references
// resolve; named targets resolve), adapted to what the two models
// actually declare on current main — each adaptation is a premise
// verified in code, not an assumption:
//
//   solver-resolves — requirement.of.solver names a registered
//     solver. (compileDesignIR checks the field is PRESENT; it never
//     looks the name up. `targets` on a solver is a node-selector
//     function, not a name list, so target-coverage as membership is
//     not a checkable proposition and is not claimed.)
//   requirement-target-resolves — requirement.of.target names a node
//     in the same IR graph. (compileDesignIR gives LOAD entries this
//     check; requirements get only the presence check.)
//   screening-fitness (WARNING class) — a requirement carrying a
//     hard bound (max/min) bound to a solver declared
//     `screening: true`. The registry's own header defines screening
//     as "screening-level result, not a design check"; a bounded
//     requirement IS a design check. Reported as a warning with its
//     location — never dressed as an error.
//
// Output is an error LIST with locations, never a boolean, plus the
// run's own accounting (checked counts, and what could not be checked
// and why — a requirement whose `of` is malformed belongs to the
// within-model pass; this pass records it as unverifiable rather than
// duplicating the error or silently skipping it).
//
// Later surfaces (DTU schema pairs, macro paramSchemas, MCP tool
// shapes) enrol as adapters producing the same entry shapes — one
// validator, many surfaces, never a second tool.
//
// Clean-room note: the mechanism (an independent pass walking two
// models against each other, returning located errors) is
// reimplemented from the Research brief's description in Concord's
// idiom (compileDesignIR's error-list style). No Cohesive code was
// read or copied — that repo carries no LICENSE (ideas yes, code no).

/**
 * Validate IR documents against solver declarations.
 *
 * @param {{ solvers: Array<{id: string, screening?: boolean}>,
 *           documents: Array<{location: string, ir: object}> }} input
 *   `solvers` in listSolvers() shape (physics/registry.js);
 *   `documents` are Design IR objects with a caller-supplied location
 *   label (a file, a brief id, a fixture name) used verbatim in entries.
 * @returns {{ errors: Array, warnings: Array,
 *             checked: { documents: number, requirements: number,
 *                        solversConsulted: number },
 *             unverifiable: Array }}
 */
export function validateIrAgainstSolvers({ solvers, documents }) {
  const errors = [];
  const warnings = [];
  const unverifiable = [];
  const byId = new Map();
  for (const s of Array.isArray(solvers) ? solvers : []) {
    if (s && typeof s.id === "string") byId.set(s.id, s);
  }
  const consulted = new Set();
  let requirementsChecked = 0;

  for (const doc of Array.isArray(documents) ? documents : []) {
    const location = String(doc?.location || "(unnamed document)");
    const ir = doc?.ir;
    if (!ir || typeof ir !== "object") {
      unverifiable.push({ surface: "design-ir", location, kind: "document_not_an_ir", detail: "document carries no IR object" });
      continue;
    }
    const nodeIds = new Set(
      (Array.isArray(ir.nodes) ? ir.nodes : []).map((n) => n?.id).filter((id) => typeof id === "string"),
    );
    const reqs = Array.isArray(ir.requirements) ? ir.requirements : [];
    for (const [i, r] of reqs.entries()) {
      const where = `${location} requirements[${i}]${r?.id ? ` (${r.id})` : ""}`;
      const of = r?.of;
      if (!of || typeof of.solver !== "string" || typeof of.target !== "string") {
        unverifiable.push({
          surface: "design-ir", location: where, kind: "requirement_shape",
          detail: "of.{solver,target} missing or not strings — owned by the within-model pass (compileDesignIR)",
        });
        continue;
      }
      requirementsChecked++;
      const solver = byId.get(of.solver);
      if (!solver) {
        errors.push({
          surface: "design-ir↔solver-registry", location: where, kind: "solver_unresolved",
          detail: `requirement binds to solver "${of.solver}", which is not in the solver registry (${byId.size} registered)`,
        });
      } else {
        consulted.add(of.solver);
      }
      if (!nodeIds.has(of.target)) {
        errors.push({
          surface: "design-ir", location: where, kind: "target_unresolved",
          detail: `requirement target "${of.target}" is not a node in this IR graph (${nodeIds.size} nodes)`,
        });
      }
      if (solver && solver.screening === true && (r.max != null || r.min != null)) {
        warnings.push({
          surface: "design-ir↔solver-registry", location: where, kind: "screening_solver_bound_to_hard_requirement",
          detail: `requirement carries a hard bound but solver "${of.solver}" is declared screening:true (screening-level result, not a design check)`,
        });
      }
    }
  }

  return {
    errors,
    warnings,
    checked: {
      documents: Array.isArray(documents) ? documents.length : 0,
      requirements: requirementsChecked,
      solversConsulted: consulted.size,
    },
    unverifiable,
  };
}

export default { validateIrAgainstSolvers };
