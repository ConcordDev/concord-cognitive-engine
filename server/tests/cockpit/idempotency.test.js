import test from "node:test";
import assert from "node:assert/strict";
import { memDb } from "./_helpers.js";
import { effectKey, claimEffect, completeEffect, failEffect, markEffectUnknown, getEffect } from "../../lib/cockpit/idempotency.js";

const a = { runId: "run_1", stepId: "stp_1", tool: "create_dtu", args: { title: "A", tags: ["x"] } };

test("same inputs give the same key; different args differ; key order does not matter", () => {
  assert.equal(effectKey("r", "s", "t", { a: 1, b: 2 }), effectKey("r", "s", "t", { b: 2, a: 1 }));
  assert.notEqual(effectKey("r", "s", "t", { a: 1 }), effectKey("r", "s", "t", { a: 2 }));
  assert.match(effectKey("r", "s", "t", {}), /^[0-9a-f]{64}$/);
});
test("claim then claim again is in_flight", () => {
  const db = memDb();
  assert.equal(claimEffect(db, a).state, "claimed");
  assert.equal(claimEffect(db, a).state, "in_flight");
});
test("claim, complete, claim again is replay with the stored result", () => {
  const db = memDb();
  const c = claimEffect(db, a);
  completeEffect(db, c.key, { ok: true, result: { dtuId: "d1" } });
  const again = claimEffect(db, a);
  assert.equal(again.state, "replay");
  assert.deepEqual(again.result, { ok: true, result: { dtuId: "d1" } });
});
test("claim, fail, claim again is claimed", () => {
  const db = memDb();
  const c = claimEffect(db, a);
  failEffect(db, c.key);
  assert.equal(claimEffect(db, a).state, "claimed");
});
test("an unknown effect still blocks a second claim", () => {
  const db = memDb();
  const c = claimEffect(db, a);
  markEffectUnknown(db, c.key);
  assert.equal(getEffect(db, c.key).status, "unknown");
  assert.equal(claimEffect(db, a).state, "in_flight");
});
