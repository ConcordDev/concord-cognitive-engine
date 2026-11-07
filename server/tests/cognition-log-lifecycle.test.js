// S-COG-1/2/3 pins for the cognition question log (branch (b)):
// dedup offers the standing record, edit works in place, the answered
// state round-trips, and the entity store summary counts registrations.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerCognitionMacros from "../domains/cognition.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(name, fn); }
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`cognition.${name} not registered`);
  return fn(ctx, input);
}

const ctxA = { actor: { userId: "user_cog_a" }, userId: "user_cog_a" };

before(() => { registerCognitionMacros(register); });
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

function openTrace(title, question) {
  return call("exportTrace", ctxA, { title, trace: { input: { question } } });
}

describe("cognition log lifecycle (S-COG-1/2/3)", () => {
  it("an identical re-create returns the standing record, not a duplicate", () => {
    const first = openTrace("Why is the sky blue?", "Why is the sky blue?");
    assert.equal(first.ok, true, JSON.stringify(first));
    const again = openTrace("Why is the sky blue?", "Why is the sky blue?");
    assert.equal(again.result.duplicate, true);
    assert.equal(again.result.exportId, first.result.exportId);
    const list = call("listExports", ctxA, {});
    assert.equal(list.result.count, 1);
  });

  it("updateExport edits the title and question in place", () => {
    const first = openTrace("Draft title", "What is 2+2?");
    const upd = call("updateExport", ctxA, {
      exportId: first.result.exportId,
      title: "Arithmetic",
      question: "What is 3+3?",
    });
    assert.equal(upd.ok, true, JSON.stringify(upd));
    const got = call("getExport", ctxA, { exportId: first.result.exportId });
    assert.equal(got.result.export.title, "Arithmetic");
    assert.equal(got.result.export.trace.input.question, "What is 3+3?");
  });

  it("the answered state round-trips through list and get, and clears", () => {
    const first = openTrace("Settled?", "Is this settled?");
    const ans = call("answerExport", ctxA, {
      exportId: first.result.exportId,
      answer: "Yes — checked against the docs.",
    });
    assert.equal(ans.ok, true, JSON.stringify(ans));
    assert.equal(ans.result.answered.note, "Yes — checked against the docs.");
    const list = call("listExports", ctxA, {});
    assert.equal(list.result.exports[0].answered.note, "Yes — checked against the docs.");
    const cleared = call("answerExport", ctxA, { exportId: first.result.exportId, clear: true });
    assert.equal(cleared.result.answered, null);
  });

  it("entityStoreSummary counts registrations and labels the origin as system", () => {
    globalThis._concordSTATE.emergents = new Map([["e1", {}], ["e2", {}], ["e3", {}]]);
    const r = call("entityStoreSummary", ctxA, {});
    assert.equal(r.result.registered, 3);
    assert.equal(r.result.origin, "system");
    assert.match(r.result.label, /registrations, not activity/);
  });
});
