// server/tests/model-checker.test.js
//
// Unit tests for the bounded explicit-state model checker itself
// (server/lib/verification/model-checker.js), independent of any
// money-invariant model. Domain-specific tests live in
// server/tests/invariant-specs.test.js.
//
// Run WITHOUT --test-force-exit (per instructions — that flag has been
// observed to silently truncate runs).
//   node --test server/tests/model-checker.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { checkModel, replayTrace, hashState, stableStringify, deepClone, formulaInvariant } from "../lib/verification/model-checker.js";

// ---------------------------------------------------------------------------
// A trivial counter model used throughout: state = { n }, action increments
// n by 1 up to a bound, invariant asserts n stays below some threshold.
// ---------------------------------------------------------------------------

function buildCounterModel({ ceiling = 10, violateAt = null } = {}) {
  return {
    initialState: { n: 0 },
    actions: [
      {
        name: "increment",
        guard: (s) => s.n < ceiling,
        apply: (s) => ({ n: s.n + 1 }),
      },
    ],
    invariants: [
      {
        name: "below_violate_threshold",
        check: (s) => violateAt === null || s.n < violateAt,
        message: (s, trace) => `counter reached ${s.n} (>= ${violateAt}) after ${trace.length} actions`,
      },
    ],
  };
}

describe("model-checker: helpers", () => {
  it("stableStringify is order-independent for object keys", () => {
    const a = { x: 1, y: 2 };
    const b = { y: 2, x: 1 };
    assert.equal(stableStringify(a), stableStringify(b));
  });

  it("stableStringify is NOT order-independent for arrays", () => {
    assert.notEqual(stableStringify([1, 2]), stableStringify([2, 1]));
  });

  it("hashState is deterministic and collision-free for distinct simple states", () => {
    const h1 = hashState({ n: 1 });
    const h2 = hashState({ n: 1 });
    const h3 = hashState({ n: 2 });
    assert.equal(h1, h2);
    assert.notEqual(h1, h3);
  });

  it("deepClone produces an independent copy", () => {
    const original = { rows: [{ a: 1 }] };
    const clone = deepClone(original);
    clone.rows[0].a = 999;
    assert.equal(original.rows[0].a, 1);
  });

  it("formulaInvariant evaluates a propositional formula over derived facts", () => {
    const inv = formulaInvariant({
      name: "both_true",
      formula: "a AND b",
      atoms: (s) => ({ a: s.x > 0, b: s.y > 0 }),
    });
    assert.equal(inv.check({ x: 1, y: 1 }), true);
    assert.equal(inv.check({ x: 1, y: -1 }), false);
  });

  it("formulaInvariant default message reports the failing facts", () => {
    const inv = formulaInvariant({ name: "n", formula: "a", atoms: () => ({ a: false }) });
    const msg = inv.message({});
    assert.match(msg, /formula 'a' evaluated false/);
    assert.match(msg, /"a":false/);
  });
});

describe("model-checker: checkModel validation", () => {
  it("throws on missing initialState", () => {
    assert.throws(() => checkModel({ actions: [{ name: "a", apply: (s) => s }], invariants: [{ name: "i", check: () => true }] }));
  });

  it("throws on empty actions array", () => {
    assert.throws(() => checkModel({ initialState: {}, actions: [], invariants: [{ name: "i", check: () => true }] }));
  });

  it("throws on empty invariants array", () => {
    assert.throws(() => checkModel({ initialState: {}, actions: [{ name: "a", apply: (s) => s }], invariants: [] }));
  });

  it("throws on duplicate action names", () => {
    assert.throws(() =>
      checkModel({
        initialState: {},
        actions: [
          { name: "dup", apply: (s) => s },
          { name: "dup", apply: (s) => s },
        ],
        invariants: [{ name: "i", check: () => true }],
      }),
    );
  });
});

describe("model-checker: exploration + violation reporting", () => {
  it("reports a violation on the initial state immediately (depth 0, empty trace)", () => {
    // invariant requires n < violateAt; at violateAt=0 the initial n=0 already fails (0 < 0 is false).
    const model = buildCounterModel({ violateAt: 0 });
    const result = checkModel(model, { maxStates: 100, maxDepth: 5 });
    assert.equal(result.status, "violation");
    assert.deepEqual(result.trace, []);
    assert.equal(result.state.n, 0);
  });

  it("finds a violation via BFS and returns the exact action-sequence trace", () => {
    const model = buildCounterModel({ ceiling: 20, violateAt: 5 });
    const result = checkModel(model, { maxStates: 1000, maxDepth: 20 });
    assert.equal(result.status, "violation");
    assert.deepEqual(result.trace, ["increment", "increment", "increment", "increment", "increment"]);
    assert.equal(result.state.n, 5);
  });

  it("returns no_violation_found + exhaustive:true when the bounded graph is fully explored clean", () => {
    const model = buildCounterModel({ ceiling: 3, violateAt: null });
    const result = checkModel(model, { maxStates: 1000, maxDepth: 20 });
    assert.equal(result.status, "no_violation_found");
    assert.equal(result.exhaustive, true);
    // ceiling=3 -> reachable states are n=0,1,2,3 (increment disabled at n>=3) = 4 distinct states
    assert.equal(result.statesExplored, 4);
  });

  it("never claims proof language in a clean no_violation_found result", () => {
    const model = buildCounterModel({ ceiling: 3 });
    const result = checkModel(model, { maxStates: 1000, maxDepth: 20 });
    assert.equal(result.status, "no_violation_found");
    assert.match(result.note, /NOT a proof of correctness/);
  });
});

describe("model-checker: honest incompleteness", () => {
  it("returns state_space_exhausted (not a violation, not a proof) when maxStates caps the search", () => {
    const model = buildCounterModel({ ceiling: 1000 }); // huge reachable space
    const result = checkModel(model, { maxStates: 5, maxDepth: 1000 });
    assert.equal(result.status, "state_space_exhausted");
    assert.equal(result.exhaustive, false);
    assert.match(result.note, /NOT a proof/);
    // Must never claim success language for a capped-out search.
    assert.notEqual(result.status, "no_violation_found");
  });

  it("returns depth_bound_reached (not a violation, not a proof) when maxDepth caps the search", () => {
    const model = buildCounterModel({ ceiling: 1000 });
    const result = checkModel(model, { maxStates: 1000000, maxDepth: 3 });
    assert.equal(result.status, "depth_bound_reached");
    assert.equal(result.exhaustive, false);
    assert.match(result.note, /NOT a proof/);
  });

  it("bound field on every honest-incompleteness result names the exact caps applied", () => {
    const model = buildCounterModel({ ceiling: 1000 });
    const result = checkModel(model, { maxStates: 5, maxDepth: 1000 });
    assert.deepEqual(result.bound, { maxStates: 5, maxDepth: 1000 });
  });
});

describe("model-checker: nondeterministic action detection", () => {
  it("detects an action whose apply() is not a pure function of state (uses Math.random)", () => {
    const model = {
      initialState: { n: 0 },
      actions: [
        {
          name: "flaky",
          apply: (s) => ({ n: s.n + Math.floor(Math.random() * 1000) }),
        },
      ],
      invariants: [{ name: "always_true", check: () => true }],
    };
    const result = checkModel(model, { maxStates: 100, maxDepth: 5 });
    assert.equal(result.status, "nondeterministic_action");
    assert.equal(result.action, "flaky");
  });

  it("detects an action that reads external mutable state (closure counter) as nondeterministic", () => {
    let externalCounter = 0;
    const model = {
      initialState: { n: 0 },
      actions: [
        {
          name: "leaky",
          apply: (s) => {
            externalCounter += 1; // side effect the checker's double-apply will observe as divergence
            return { n: s.n + externalCounter };
          },
        },
      ],
      invariants: [{ name: "always_true", check: () => true }],
    };
    const result = checkModel(model, { maxStates: 100, maxDepth: 5 });
    assert.equal(result.status, "nondeterministic_action");
    assert.equal(result.action, "leaky");
  });

  it("does NOT flag a genuinely pure action as nondeterministic", () => {
    const model = buildCounterModel({ ceiling: 3 });
    const result = checkModel(model, { maxStates: 100, maxDepth: 10 });
    assert.notEqual(result.status, "nondeterministic_action");
  });
});

describe("model-checker: action-throw handling", () => {
  it("surfaces a thrown action as a distinct error status, not a crash", () => {
    const model = {
      initialState: { n: 0 },
      actions: [
        {
          name: "boom",
          apply: () => {
            throw new Error("kaboom");
          },
        },
      ],
      invariants: [{ name: "always_true", check: () => true }],
    };
    const result = checkModel(model, { maxStates: 100, maxDepth: 5 });
    assert.equal(result.status, "error");
    assert.equal(result.reason, "action_threw");
    assert.equal(result.action, "boom");
    assert.match(result.message, /kaboom/);
  });

  it("treats a throwing guard as 'not enabled' rather than crashing", () => {
    const model = {
      initialState: { n: 0 },
      actions: [
        {
          name: "unstable-guard",
          guard: () => {
            throw new Error("guard exploded");
          },
          apply: (s) => ({ n: s.n + 1 }),
        },
      ],
      invariants: [{ name: "always_true", check: () => true }],
    };
    const result = checkModel(model, { maxStates: 100, maxDepth: 5 });
    // No enabled actions ever fire -> the search exhausts immediately at the single initial state.
    assert.equal(result.status, "no_violation_found");
    assert.equal(result.statesExplored, 1);
  });
});

describe("model-checker: replayTrace", () => {
  it("replays a trace and reaches the same final state the BFS found", () => {
    const model = buildCounterModel({ ceiling: 20, violateAt: 5 });
    const result = checkModel(model, { maxStates: 1000, maxDepth: 20 });
    assert.equal(result.status, "violation");
    const replay = replayTrace(model, result.trace);
    assert.equal(replay.ok, true);
    assert.deepEqual(replay.finalState, result.state);
  });

  it("returns ok:false for a trace naming an unknown action (guards against fabricated counterexamples)", () => {
    const model = buildCounterModel({ ceiling: 5 });
    const replay = replayTrace(model, ["increment", "does-not-exist"]);
    assert.equal(replay.ok, false);
    assert.match(replay.error, /unknown_action/);
  });

  it("returns ok:false when a step's guard would not actually have been enabled", () => {
    const model = buildCounterModel({ ceiling: 2 });
    // ceiling=2 -> increment disabled once n reaches 2; a 3rd increment is not a legal replay step.
    const replay = replayTrace(model, ["increment", "increment", "increment"]);
    assert.equal(replay.ok, false);
    assert.match(replay.error, /guard_failed/);
  });

  it("surfaces a thrown action during replay as ok:false, not a crash", () => {
    const model = {
      initialState: { n: 0 },
      actions: [{ name: "boom", apply: () => { throw new Error("nope"); } }],
      invariants: [{ name: "i", check: () => true }],
    };
    const replay = replayTrace(model, ["boom"]);
    assert.equal(replay.ok, false);
    assert.match(replay.error, /action_threw/);
  });
});
