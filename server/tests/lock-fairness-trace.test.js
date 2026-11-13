// lock-fairness-trace.test.js
//
// FIX-lock-005: fairnessScore was the one lock analysis with no UI
// surface, and it only accepted a hand-built processWaits payload.
// With no payload supplied it now derives the waits from the
// caller's recorded lock trace (the store its sibling analyses
// read); an explicit payload still wins.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

let registerLockActions;
let actions;

before(async () => {
  ({ default: registerLockActions } = await import("../domains/lock.js"));
  actions = new Map();
  registerLockActions((domain, name, fn) => actions.set(`${domain}.${name}`, fn));
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

function call(name, userId, data = {}) {
  const fn = actions.get(`lock.${name}`);
  assert.ok(fn, `lock.${name} registered`);
  return fn({ userId }, { id: null, data, meta: {} }, data);
}

describe("lock fairnessScore trace derivation (FIX-lock-005)", () => {
  it("scores the recorded trace when no payload is supplied", () => {
    // Five threads wait evenly; a sixth starves. (The starvation
    // rule is avg > 3× the mean, so the fixture needs enough even
    // processes that one outlier does not lift the mean past itself.)
    for (let i = 0; i < 3; i++) {
      for (const t of ["t-a", "t-b", "t-c", "t-d", "t-e"]) {
        call("recordLockEvent", "u1", { thread: t, lock: "db", action: "acquire", waitMs: 10, holdMs: 5 });
      }
      call("recordLockEvent", "u1", { thread: "t-starved", lock: "db", action: "acquire", waitMs: 400, holdMs: 5 });
    }
    const r = call("fairnessScore", "u1", {});
    assert.equal(r.ok, true);
    assert.ok(typeof r.result.jainsIndex === "number", "a Jain index is computed from the trace");
    assert.ok(r.result.jainsIndex < 0.7, `an even/starved split scores poorly: ${r.result.jainsIndex}`);
    assert.equal(r.result.starvation.detected, true);
    assert.equal(r.result.starvation.starvedProcesses[0].processId, "t-starved");
    assert.equal(r.result.summary.totalProcesses, 6);
  });

  it("an explicit processWaits payload still wins over the trace", () => {
    const r = call("fairnessScore", "u1", { processWaits: [
      { processId: "x", waitMs: 50, resource: "cache" },
      { processId: "y", waitMs: 50, resource: "cache" },
    ] });
    assert.equal(r.ok, true);
    assert.equal(r.result.jainsIndex, 1);
    assert.equal(r.result.summary.totalProcesses, 2);
  });

  it("a user with no trace and no payload gets the honest empty message", () => {
    const r = call("fairnessScore", "u-empty", {});
    assert.equal(r.ok, true);
    assert.equal(r.result.message, "No wait data to analyze.");
  });
});
