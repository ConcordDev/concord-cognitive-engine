// GB-1539 bounds enforcement — FIX-suffering-010 (Days-to-implement)
// and FIX-lock-002 (negative lock-event durations).
// Suffering: a huge timeToImplement flowed straight into the ROI math;
// it and its sibling candidate numbers now refuse in the policy shape,
// and intervention progress refuses out-of-percent instead of clamping.
// Lock: recordLockEvent recorded waitMs/holdMs of -1 as-is; negative
// durations now refuse with invalid_input.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerSufferingActions from "../domains/suffering.js";
import registerLockActions from "../domains/lock.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(domain, name, ctx, artifact, params = {}) {
  const fn = ACTIONS.get(`${domain}.${name}`);
  if (!fn) throw new Error(`${domain}.${name} not registered`);
  return fn(ctx, artifact, params);
}

before(() => { registerSufferingActions(register); registerLockActions(register); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "bnd_suf_a" }, userId: "bnd_suf_a" };

describe("suffering intervention bounds (FIX-suffering-010)", () => {
  const artifactWith = (intv) => ({
    id: "art1",
    data: {
      causes: [{ id: "c1", severity: 8, probability: 0.5 }],
      interventions: [intv],
    },
    meta: {},
  });

  it("a huge Days-to-implement refuses with invalid_input", () => {
    const r = call("suffering", "interventionDesign", ctxA, artifactWith({ targetCauseIds: ["c1"], cost: 100, effort: 5, expectedEffectiveness: 0.5, timeToImplement: 99999999 }));
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_input");
    assert.match(r.message, /timeToImplement/);
  });

  it("a negative Days-to-implement refuses", () => {
    const r = call("suffering", "interventionDesign", ctxA, artifactWith({ targetCauseIds: ["c1"], cost: 100, effort: 5, expectedEffectiveness: 0.5, timeToImplement: -3 }));
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_input");
  });

  it("an in-policy candidate still evaluates", () => {
    const r = call("suffering", "interventionDesign", ctxA, artifactWith({ targetCauseIds: ["c1"], cost: 100, effort: 5, expectedEffectiveness: 0.5, timeToImplement: 45 }));
    assert.equal(r.ok, true);
  });

  it("intervention-update progress of 500 refuses instead of clamping to 100", () => {
    const created = call("suffering", "intervention-track", ctxA, { id: null, data: {}, meta: {} }, { title: "Fix onboarding" });
    assert.equal(created.ok, true);
    const id = created.result.intervention.id;
    const r = call("suffering", "intervention-update", ctxA, { id: null, data: {}, meta: {} }, { id, progress: 500 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_input");
    const r2 = call("suffering", "intervention-update", ctxA, { id: null, data: {}, meta: {} }, { id, progress: 40 });
    assert.equal(r2.ok, true);
    assert.equal(r2.result.intervention.progress, 40);
  });
});

describe("lock event bounds (FIX-lock-002)", () => {
  it("a waitMs of -1 refuses with invalid_input — it is not recorded", () => {
    const r = call("lock", "recordLockEvent", ctxA, { id: null, data: {}, meta: {} }, { thread: "t1", lock: "db", action: "wait", waitMs: -1 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_input");
    assert.match(r.message, /waitMs/);
  });

  it("a holdMs of -1 refuses", () => {
    const r = call("lock", "recordLockEvent", ctxA, { id: null, data: {}, meta: {} }, { thread: "t1", lock: "db", action: "acquire", holdMs: -1 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_input");
  });

  it("an ordinary event still records", () => {
    const r = call("lock", "recordLockEvent", ctxA, { id: null, data: {}, meta: {} }, { thread: "t1", lock: "db", action: "acquire", waitMs: 12, holdMs: 340 });
    assert.equal(r.ok, true);
    assert.equal(r.result.recorded.waitMs, 12);
  });
});
