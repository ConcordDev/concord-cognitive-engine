// server/lib/verification/model-checker.js
//
// Bounded explicit-state model checker.
//
// HONEST BOUNDARY (read this before trusting any result from this module):
// This is bounded explicit-state model checking, NOT theorem proving. It
// explores a finite, bounded region of a model's reachable state space and
// reports either a concrete counterexample or "no violation found within
// these bounds." "No violation found" is NOT a proof of correctness — an
// unbounded or larger state space may still contain one, and every result
// this module returns says so explicitly via its `bound` and `status`
// fields. There is no SMT solver, no symbolic execution, and no inductive
// invariant synthesis here. Models are hand-specified abstractions of the
// real code (see server/lib/verification/invariant-specs.js) — a bug in the
// abstraction can hide a bug in the real system, and a passing result only
// says the ABSTRACTION held up under the explored bound.
//
// A model is data:
//   {
//     initialState: <any JSON-serializable value>,
//     actions: [{ name: string, guard?(state) => boolean, apply(state) => nextState }, ...],
//     invariants: [{ name: string, check(state) => boolean, message?(state, trace) => string }, ...],
//   }
//
// `apply` MUST be a pure function of its input state (no reliance on
// external mutable data, randomness, wall-clock time, etc.) — the checker
// detects violations of this by calling `apply` twice on independent clones
// of the same state and comparing results; a mismatch is reported as
// `nondeterministic_action` rather than silently corrupting the search.
//
// checkModel() does breadth-first search from initialState, evaluating every
// invariant at every reachable state, bounded by `maxDepth` (path length)
// and `maxStates` (distinct states visited). On the first invariant
// violation found, it returns immediately with the exact action sequence
// (trace) and the state that broke it — the counterexample is the entire
// value of this tool; a bare boolean "failed" would not be actionable.
//
// Reuses server/lib/compute/formal-logic.js to EXPRESS and EVALUATE
// invariant predicates as propositional formulas over boolean "facts"
// extracted from a state (see `formulaInvariant` below). It deliberately
// does NOT reuse that module's `isSatisfiable`/`truthTable` for exploration
// — those enumerate all 2^n variable assignments and are unusable past
// ~20 booleans. Concrete-state BFS is the exploration engine here; formal
// logic is only the predicate language for invariants.

import crypto from "crypto";
import { evaluate as evaluateFormula } from "../compute/formal-logic.js";

// ---------------------------------------------------------------------------
// State hashing / cloning
// ---------------------------------------------------------------------------

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeysDeep(value[key]);
    return out;
  }
  return value;
}

/** Deterministic JSON serialization (sorted object keys) — order-independent for state comparison/hashing. */
export function stableStringify(value) {
  return JSON.stringify(sortKeysDeep(value));
}

/** SHA-256 hex digest of a state's stable serialization — used for the BFS visited-set. */
export function hashState(state) {
  return crypto.createHash("sha256").update(stableStringify(state)).digest("hex");
}

/** Deep-clone a JSON-serializable state so actions can't accidentally share mutable references. */
export function deepClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

// ---------------------------------------------------------------------------
// Invariant helpers
// ---------------------------------------------------------------------------

/**
 * Build an invariant whose truth value is a propositional FORMULA over
 * boolean "facts" derived from state, evaluated via formal-logic.js.
 *
 * @param {object} opts
 * @param {string} opts.name
 * @param {string} opts.formula — e.g. "circulatingWithinMinted", "a AND NOT b"
 * @param {(state) => Record<string, boolean>} opts.atoms — extracts the fact assignment from a state
 * @param {(state, trace) => string} [opts.message] — optional custom violation message
 */
export function formulaInvariant({ name, formula, atoms, message }) {
  if (!name || typeof name !== "string") throw new Error("formulaInvariant requires a name");
  if (!formula || typeof formula !== "string") throw new Error("formulaInvariant requires a formula string");
  if (typeof atoms !== "function") throw new Error("formulaInvariant requires atoms(state)");

  return {
    name,
    check(state) {
      const facts = atoms(state);
      return !!evaluateFormula(formula, facts);
    },
    message:
      typeof message === "function"
        ? message
        : (state) => {
            const facts = atoms(state);
            return `formula '${formula}' evaluated false — facts: ${JSON.stringify(facts)}`;
          },
  };
}

function evaluateInvariants(invariants, state, trace) {
  for (const inv of invariants) {
    let holds;
    try {
      holds = !!inv.check(state);
    } catch (e) {
      return { name: inv.name, message: `invariant '${inv.name}' threw: ${String(e?.message || e)}` };
    }
    if (!holds) {
      let message;
      try {
        message = typeof inv.message === "function" ? inv.message(state, trace) : inv.message;
      } catch (e) {
        message = `invariant '${inv.name}' violated (message() itself threw: ${String(e?.message || e)})`;
      }
      return { name: inv.name, message: message || `invariant '${inv.name}' violated` };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Model validation
// ---------------------------------------------------------------------------

function validateModel(model) {
  if (!model || typeof model !== "object") throw new Error("model is required");
  if (model.initialState === undefined) throw new Error("model.initialState is required");
  if (!Array.isArray(model.actions) || model.actions.length === 0) {
    throw new Error("model.actions must be a non-empty array");
  }
  if (!Array.isArray(model.invariants) || model.invariants.length === 0) {
    throw new Error("model.invariants must be a non-empty array");
  }
  const seen = new Set();
  for (const action of model.actions) {
    if (!action || typeof action.name !== "string" || !action.name) {
      throw new Error("every action needs a non-empty string .name");
    }
    if (typeof action.apply !== "function") {
      throw new Error(`action '${action.name}' needs an .apply(state) function`);
    }
    if (action.guard !== undefined && typeof action.guard !== "function") {
      throw new Error(`action '${action.name}'.guard, if present, must be a function`);
    }
    if (seen.has(action.name)) throw new Error(`duplicate action name: '${action.name}'`);
    seen.add(action.name);
  }
  for (const inv of model.invariants) {
    if (!inv || typeof inv.name !== "string" || !inv.name) {
      throw new Error("every invariant needs a non-empty string .name");
    }
    if (typeof inv.check !== "function") {
      throw new Error(`invariant '${inv.name}' needs a .check(state) function`);
    }
  }
}

// ---------------------------------------------------------------------------
// checkModel — bounded BFS
// ---------------------------------------------------------------------------

/**
 * @param {object} model — { initialState, actions, invariants }
 * @param {object} [options]
 * @param {number} [options.maxStates=20000] — cap on distinct visited states
 * @param {number} [options.maxDepth=12] — cap on path length (action-sequence length) explored
 * @returns {object} one of:
 *   { status: 'violation', invariant, message, trace, state, statesExplored }
 *   { status: 'nondeterministic_action', action, trace, message }
 *   { status: 'error', reason: 'action_threw', action, message, trace }
 *   { status: 'state_space_exhausted', exhaustive: false, statesExplored, bound, note }
 *   { status: 'depth_bound_reached', exhaustive: false, statesExplored, bound, note }
 *   { status: 'no_violation_found', exhaustive: true, statesExplored, bound, note }
 */
export function checkModel(model, options = {}) {
  validateModel(model);
  const maxStates = Number.isFinite(options.maxStates) ? options.maxStates : 20000;
  const maxDepth = Number.isFinite(options.maxDepth) ? options.maxDepth : 12;
  const { actions, invariants } = model;

  const start = deepClone(model.initialState);
  const bound = { maxStates, maxDepth };

  const initViolation = evaluateInvariants(invariants, start, []);
  if (initViolation) {
    return {
      status: "violation",
      invariant: initViolation.name,
      message: initViolation.message,
      trace: [],
      state: start,
      statesExplored: 1,
      bound,
    };
  }

  const visited = new Set([hashState(start)]);
  const queue = [{ state: start, trace: [], depth: 0 }];
  let statesExplored = 1;
  let stateCapHit = false;
  let depthCapHit = false;

  while (queue.length > 0) {
    const { state, trace, depth } = queue.shift();

    if (depth >= maxDepth) {
      depthCapHit = true;
      continue; // don't expand further along this branch — it's still counted as explored
    }

    for (const action of actions) {
      let enabled;
      try {
        enabled = action.guard ? !!action.guard(deepClone(state)) : true;
      } catch {
        enabled = false; // a throwing guard is treated as "not enabled" — never crashes the search
      }
      if (!enabled) continue;

      // Purity/determinism check: apply(state) twice on independent clones must agree.
      let next1;
      let next2;
      try {
        next1 = action.apply(deepClone(state));
        next2 = action.apply(deepClone(state));
      } catch (e) {
        return {
          status: "error",
          reason: "action_threw",
          action: action.name,
          message: String(e?.message || e),
          trace: [...trace, action.name],
        };
      }

      if (stableStringify(next1) !== stableStringify(next2)) {
        return {
          status: "nondeterministic_action",
          action: action.name,
          trace: [...trace, action.name],
          message: `action '${action.name}' produced different results when applied twice to identical clones of the same state — apply(state) must be a pure function of state (no randomness, wall-clock time, or external mutable data).`,
        };
      }

      const nextState = next1;
      const nextTrace = [...trace, action.name];

      const violation = evaluateInvariants(invariants, nextState, nextTrace);
      if (violation) {
        return {
          status: "violation",
          invariant: violation.name,
          message: violation.message,
          trace: nextTrace,
          state: nextState,
          statesExplored,
          bound,
        };
      }

      const h = hashState(nextState);
      if (visited.has(h)) continue; // already explored via another path — same state, invariant already checked

      if (visited.size >= maxStates) {
        stateCapHit = true;
        continue;
      }

      visited.add(h);
      statesExplored++;
      queue.push({ state: nextState, trace: nextTrace, depth: depth + 1 });
    }
  }

  if (stateCapHit) {
    return {
      status: "state_space_exhausted",
      exhaustive: false,
      statesExplored,
      bound,
      note: "the state cap (maxStates) was reached before the reachable space was fully covered — this is NOT a proof that no violation exists beyond the explored region. Raise maxStates to search further.",
    };
  }
  if (depthCapHit) {
    return {
      status: "depth_bound_reached",
      exhaustive: false,
      statesExplored,
      bound,
      note: "some branches were truncated at the depth bound (maxDepth) before their successors were explored — this is NOT a proof of correctness beyond that depth. Raise maxDepth to search further.",
    };
  }
  return {
    status: "no_violation_found",
    exhaustive: true,
    statesExplored,
    bound,
    note: "the full reachable state graph of this bounded MODEL was explored (queue emptied naturally, no cap hit) with no invariant violation found. This is exhaustive for the abstract model only — it is NOT a proof of correctness for the real system, which the model may not faithfully capture.",
  };
}

// ---------------------------------------------------------------------------
// replayTrace — independent counterexample-reproduction check
// ---------------------------------------------------------------------------

/**
 * Re-apply a named action sequence from model.initialState, independently
 * of any BFS bookkeeping. Used to prove a checkModel() counterexample trace
 * actually reproduces (a trace that doesn't replay is a fabricated
 * counterexample and the checker itself would be the bug).
 *
 * @param {object} model
 * @param {string[]} trace — action names, in order
 * @returns {{ ok: true, finalState, states } | { ok: false, error, states }}
 */
export function replayTrace(model, trace) {
  validateModel(model);
  const index = new Map(model.actions.map((a) => [a.name, a]));

  let state = deepClone(model.initialState);
  const states = [state];

  for (const name of trace) {
    const action = index.get(name);
    if (!action) return { ok: false, error: `unknown_action:${name}`, states };

    if (action.guard) {
      let enabled;
      try {
        enabled = !!action.guard(deepClone(state));
      } catch {
        enabled = false;
      }
      if (!enabled) return { ok: false, error: `guard_failed:${name}`, states };
    }

    let next;
    try {
      next = action.apply(deepClone(state));
    } catch (e) {
      return { ok: false, error: `action_threw:${name}`, message: String(e?.message || e), states };
    }
    state = next;
    states.push(state);
  }

  return { ok: true, finalState: state, states };
}
