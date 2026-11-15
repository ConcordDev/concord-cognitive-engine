// FIX-wellness-005 — metric, mood, and CBT entries gain update +
// delete macros (workouts/goals already had delete; their FE buttons
// gain confirmations in the same ticket). Edits re-validate against
// the entry's own rules and are scoped to the caller's entries.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerWellness from "../domains/wellness.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, userId, params = {}) {
  const fn = ACTIONS.get(`wellness.${name}`);
  if (!fn) throw new Error(`wellness.${name} not registered`);
  return fn({ actor: { userId } }, params);
}

before(() => { registerWellness(register); });
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

describe("wellness entry edit/delete (FIX-wellness-005)", () => {
  it("updates and deletes a metric entry, re-validating bounds", () => {
    const e = call("metrics-log", "user_a", { type: "steps", value: 5000 }).result.entry;
    const u = call("metrics-update", "user_a", { id: e.id, value: 6500, note: "walked more" });
    assert.equal(u.ok, true);
    assert.equal(u.result.entry.value, 6500);
    assert.equal(call("metrics-update", "user_a", { id: e.id, value: 999999 }).ok, false);
    assert.equal(call("metrics-update", "user_b", { id: e.id, value: 1 }).ok, false);
    assert.equal(call("metrics-delete", "user_b", { id: e.id }).ok, false);
    assert.equal(call("metrics-delete", "user_a", { id: e.id }).ok, true);
    assert.equal(call("metrics-list", "user_a", {}).result.metrics.length, 0);
  });

  it("updates a mood entry's note/activities and recomputes score on mood change; deletes it", () => {
    const e = call("mood-log", "user_a", { mood: "bad", note: "rough", activities: ["work"] }).result.entry;
    const originalScore = e.moodScore; // entry objects are live references — capture before the update mutates
    const u = call("mood-update", "user_a", { id: e.id, mood: "great", note: "better now" });
    assert.equal(u.ok, true);
    assert.equal(u.result.entry.mood, "great");
    assert.ok(u.result.entry.moodScore > originalScore);
    assert.equal(call("mood-update", "user_a", { id: e.id, mood: "ecstatic" }).ok, false);
    assert.equal(call("mood-delete", "user_a", { id: e.id }).ok, true);
    assert.equal(call("mood-list", "user_a", {}).result.moods.length, 0);
  });

  it("updates a CBT record (relief recomputed) and deletes it", () => {
    const r = call("cbt-record-create", "user_a", {
      fieldKind: "binary_thinking", situation: "Missed a deadline", automaticThought: "I always fail",
      intensityBefore: 80, intensityAfter: 60,
    }).result.record;
    assert.equal(r.relief, 20);
    const u = call("cbt-record-update", "user_a", { id: r.id, intensityAfter: 30, reframe: "One miss is not always" });
    assert.equal(u.ok, true);
    assert.equal(u.result.record.relief, 50);
    assert.equal(call("cbt-record-update", "user_a", { id: r.id, situation: "  " }).ok, false);
    assert.equal(call("cbt-record-delete", "user_b", { id: r.id }).ok, false);
    assert.equal(call("cbt-record-delete", "user_a", { id: r.id }).ok, true);
    assert.equal(call("cbt-record-list", "user_a", {}).result.total, 0);
  });
});
