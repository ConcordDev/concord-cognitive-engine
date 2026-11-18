// server/lib/conkay/physics/solvers/logic-sat.js
//
// math.logic-sat — SX-NUM-22 (ConKay solver catalogue,
// Wave 0).
//
// Propositional satisfiability at the JS tier: DPLL with
// unit propagation over CNF in the DIMACS literal
// convention (variable ids are positive integers; a
// negative literal is the negation). SMT and the competition
// scale instances are the Z3 engine tier, named as scope.
//
// The honesty shapes:
//   - a SAT answer ships ONLY with a model, and the model
//     is verified against every clause in code before it is
//     served — an unverified model is a solver bug, reported
//     as FAIL, never shipped;
//   - an UNSAT verdict is the exhaustive search itself, and
//     ships with its statistics (decisions, propagations);
//   - a search that exhausts its declared decision budget
//     refuses NOT_COMPUTED — it never guesses SAT or UNSAT;
//   - model counting is exact enumeration with propagation,
//     capped by the same budget discipline.
//
// Catalogue reference case: the small pigeonhole principle
// PHP(4,3) — 4 pigeons, 3 holes — is UNSAT (SAT competition
// benchmark family).

import { registerSolver } from "../registry.js";

const DECISION_BUDGET = 2_000_000;

function parseCnf(inputs) {
  const clauses = inputs.clauses;
  if (!Array.isArray(clauses) || clauses.length === 0 || !clauses.every((c) => Array.isArray(c))) {
    return { error: "missing_input:clauses (CNF as an array of literal arrays, DIMACS sign convention)" };
  }
  let maxVar = 0;
  for (const [i, clause] of clauses.entries()) {
    for (const lit of clause) {
      if (!Number.isInteger(lit) || lit === 0) {
        return { error: `invalid_input:clauses[${i}] holds a non-integer or zero literal — DIMACS literals are nonzero integers` };
      }
      maxVar = Math.max(maxVar, Math.abs(lit));
    }
  }
  const declared = inputs.variables;
  const nVars = declared === undefined ? maxVar : declared;
  if (!Number.isInteger(nVars) || nVars < maxVar) {
    return { error: "invalid_input:variables must be an integer at least the largest literal's variable" };
  }
  if (nVars > 100000 || clauses.length > 1000000) {
    return { error: "size_above_envelope:the JS-tier DPLL is capped at 100000 variables / 1000000 clauses (declared envelope; competition scale is the Z3 engine tier)" };
  }
  return { clauses, nVars };
}

function verifyModel(clauses, assignment) {
  for (const clause of clauses) {
    let sat = false;
    for (const lit of clause) {
      const v = assignment[Math.abs(lit)];
      if ((lit > 0 && v === true) || (lit < 0 && v === false)) { sat = true; break; }
    }
    if (!sat) return false;
  }
  return true;
}

// DPLL with unit propagation. assignment: Map var -> bool.
// Returns {sat, assignment} | {unsat} | {budget}.
function dpll(clauses, nVars, budget) {
  const assignment = new Map();
  const stats = { decisions: 0, propagations: 0 };

  function propagate() {
    let changed = true;
    while (changed) {
      changed = false;
      for (const clause of clauses) {
        let satisfied = false;
        let open = 0;
        let lastOpen = 0;
        for (const lit of clause) {
          const v = assignment.get(Math.abs(lit));
          if (v === undefined) { open += 1; lastOpen = lit; }
          else if ((lit > 0) === v) { satisfied = true; break; }
        }
        if (satisfied) continue;
        if (open === 0) return false; // conflict
        if (open === 1) {
          assignment.set(Math.abs(lastOpen), lastOpen > 0);
          stats.propagations += 1;
          changed = true;
        }
      }
    }
    return true;
  }

  function allSatisfied() {
    for (const clause of clauses) {
      let satisfied = false;
      for (const lit of clause) {
        const v = assignment.get(Math.abs(lit));
        if (v !== undefined && (lit > 0) === v) { satisfied = true; break; }
      }
      if (!satisfied) return false;
    }
    return true;
  }

  function search() {
    if (budget.left <= 0) return "budget";
    if (!propagate()) return "conflict";
    if (allSatisfied()) return "sat";
    // choose the first unassigned variable appearing in an open clause
    let branchVar = 0;
    for (const clause of clauses) {
      let satisfied = false;
      for (const lit of clause) {
        const v = assignment.get(Math.abs(lit));
        if (v !== undefined && (lit > 0) === v) { satisfied = true; break; }
      }
      if (satisfied) continue;
      for (const lit of clause) {
        if (!assignment.has(Math.abs(lit))) { branchVar = Math.abs(lit); break; }
      }
      if (branchVar) break;
    }
    if (!branchVar) return "sat";
    for (const value of [true, false]) {
      budget.left -= 1;
      stats.decisions += 1;
      const snapshot = new Map(assignment);
      assignment.set(branchVar, value);
      const r = search();
      if (r === "sat") return "sat";
      if (r === "budget") return "budget";
      assignment.clear();
      for (const [k, v] of snapshot) assignment.set(k, v);
    }
    return "conflict";
  }

  const r = search();
  if (r === "budget") return { budget: true, stats };
  if (r === "sat") {
    // fill don't-cares with false so the model is total
    const total = {};
    for (let v = 1; v <= nVars; v += 1) total[v] = assignment.get(v) ?? false;
    return { sat: true, model: total, stats };
  }
  return { unsat: true, stats };
}

function countModels(clauses, nVars, budget) {
  // exact enumeration over assignments with propagation pruning:
  // recursive DPLL counting, don't-care subtrees counted by power of two.
  const assignment = new Map();
  let count = 0n;

  function propagateCount() {
    let changed = true;
    while (changed) {
      changed = false;
      for (const clause of clauses) {
        let satisfied = false;
        let open = 0;
        let lastOpen = 0;
        for (const lit of clause) {
          const v = assignment.get(Math.abs(lit));
          if (v === undefined) { open += 1; lastOpen = lit; }
          else if ((lit > 0) === v) { satisfied = true; break; }
        }
        if (satisfied) continue;
        if (open === 0) return false;
        if (open === 1) { assignment.set(Math.abs(lastOpen), lastOpen > 0); changed = true; }
      }
    }
    return true;
  }

  function search() {
    if (budget.left <= 0) return false;
    if (!propagateCount()) return true;
    let allSat = true;
    let branchVar = 0;
    for (const clause of clauses) {
      let satisfied = false;
      for (const lit of clause) {
        const v = assignment.get(Math.abs(lit));
        if (v !== undefined && (lit > 0) === v) { satisfied = true; break; }
      }
      if (!satisfied) {
        allSat = false;
        for (const lit of clause) if (!assignment.has(Math.abs(lit))) { branchVar = Math.abs(lit); break; }
        if (branchVar) break;
      }
    }
    if (allSat) {
      let free = 0;
      for (let v = 1; v <= nVars; v += 1) if (!assignment.has(v)) free += 1;
      count += 2n ** BigInt(free);
      return true;
    }
    if (!branchVar) return true;
    for (const value of [true, false]) {
      budget.left -= 1;
      const snapshot = new Map(assignment);
      assignment.set(branchVar, value);
      if (!search()) return false;
      assignment.clear();
      for (const [k, v] of snapshot) assignment.set(k, v);
    }
    return true;
  }

  const ok = search();
  return ok ? { count } : { budget: true };
}

function runSat(ctx, target) {
  const inputs = ctx?.inputs || {};
  if (target === "smt") {
    return { notComputed: "requires_engine_tier:z3 — SMT (theories beyond propositional logic) is the Z3 engine tier; the JS tier seated here is propositional DPLL" };
  }
  const parsed = parseCnf(inputs);
  if (parsed.error) return { notComputed: parsed.error };
  const { clauses, nVars } = parsed;

  switch (target) {
    case "sat": {
      const budget = { left: DECISION_BUDGET };
      const r = dpll(clauses, nVars, budget);
      if (r.budget) return { notComputed: `search_budget_exhausted:${DECISION_BUDGET} decisions spent without a verdict — the JS tier reports its limit rather than guessing; competition scale is the Z3 engine tier` };
      if (r.unsat) {
        return {
          inputs: { variables: nVars, clauses: clauses.length },
          outputs: { satisfiable: false, search: r.stats },
          margins: [], covers: [target],
        };
      }
      // the model is verified against every clause before serving
      if (!verifyModel(clauses, r.model)) {
        return {
          inputs: {},
          outputs: { solverBug: "dpll_returned_an_unverified_model" },
          status: "FAIL",
          failures: [{ check: "model_verification", detail: "the DPLL model does not satisfy every clause — reported as a solver failure, never shipped as SAT" }],
          margins: [], covers: [target],
        };
      }
      return {
        inputs: { variables: nVars, clauses: clauses.length },
        outputs: { satisfiable: true, model: r.model, modelVerified: true, search: r.stats },
        margins: [], covers: [target],
      };
    }
    case "count": {
      const budget = { left: DECISION_BUDGET };
      const r = countModels(clauses, nVars, budget);
      if (r.budget) return { notComputed: `search_budget_exhausted:model counting hit the ${DECISION_BUDGET}-decision budget — a partial count is never served as the count` };
      return {
        inputs: { variables: nVars, clauses: clauses.length },
        outputs: { modelCount: r.count.toString() },
        margins: [], covers: [target],
      };
    }
    default:
      return { notComputed: `unknown_operation:${target}` };
  }
}

export const logicSat = registerSolver({
  id: "math.logic-sat",
  version: "1.0.0",
  domain: "math",
  domains: ["math"],
  fidelity: 1,
  method: "DPLL with unit propagation over DIMACS-convention CNF; SAT answers ship only with in-code-verified models; exact model counting by propagation-pruned enumeration; SMT and competition scale are the Z3 engine tier",
  reference: "SAT competition benchmarks (satcompetition.github.io) — reference case: the small pigeonhole principle PHP(4,3) is UNSAT",
  regime: "propositional CNF to 100000 variables / 1000000 clauses under a declared 2,000,000-decision budget; budget exhaustion refuses, never guesses",
  units: { inputs: "clauses as literal arrays (DIMACS signs), optional variable count", outputs: "satisfiable verdict with a verified model, or an exact model count as a string" },
  tolerance: "exact discrete verdicts; a model is verified against every clause before it is served",
  screening: true,
  targets: () => [], // direct-call solver (solve.direct shape)
  run: runSat,
});
