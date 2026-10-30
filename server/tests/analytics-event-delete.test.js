// Behaviour tests for analytics.event-delete (remainder slice F14;
// Review 4 finding A5/F14: a tracked event offered no delete control
// anywhere in the lens, and no event-delete macro existed).
//
// event-delete joins the domain's delete family (funnel-delete,
// dashboard-delete, alert-delete) in their exact idiom: resolve the
// ACTOR's own collection, findIndex by id, splice, saveAnalytics(),
// { ok: true, result: { deleted: id } } on a hit and
// { ok: false, error: "event not found" } on a miss. Because the search
// space is anEvents(state, actor) — the per-actor log — another actor's
// event id is a miss BY CONSTRUCTION; the cross-actor test below is the
// actor-scoping security pin the sanction required.
//
// Harness mirrors analytics-domain-parity.test.js: actions are invoked
// directly with (ctx, artifact, params) against a fresh
// globalThis._concordSTATE per test.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerAnalyticsActions from "../domains/analytics.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`analytics.${name}`);
  assert.ok(fn, `analytics.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerAnalyticsActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function track(ctx, name) {
  const r = call("event-track", ctx, { name, distinctId: "u1" });
  assert.equal(r.ok, true);
  return r.result.event.id;
}

describe("analytics.event-delete", () => {
  it("is registered alongside the family's other deletes", () => {
    for (const n of ["event-delete", "funnel-delete", "dashboard-delete", "alert-delete"]) {
      assert.ok(ACTIONS.has(`analytics.${n}`), `analytics.${n} missing`);
    }
  });

  it("deletes the actor's own event; it is gone from event-list", () => {
    const keep = track(ctxA, "keep-me");
    const drop = track(ctxA, "drop-me");
    const del = call("event-delete", ctxA, { id: drop });
    assert.equal(del.ok, true);
    assert.deepEqual(del.result, { deleted: drop });
    const list = call("event-list", ctxA, {});
    assert.equal(list.result.total, 1);
    assert.equal(list.result.events[0].id, keep);
  });

  it("another actor's event id is 'not found' — and the event survives (actor-scoping pin)", () => {
    const foreign = track(ctxA, "mine");
    const del = call("event-delete", ctxB, { id: foreign });
    assert.equal(del.ok, false);
    assert.equal(del.error, "event not found");
    // A's log is untouched by B's attempt.
    assert.equal(call("event-list", ctxA, {}).result.total, 1);
    assert.equal(call("event-list", ctxB, {}).result.total, 0);
  });

  it("an unknown id is a named miss, not a throw", () => {
    track(ctxA, "something");
    const del = call("event-delete", ctxA, { id: "ev_does_not_exist" });
    assert.equal(del.ok, false);
    assert.equal(del.error, "event not found");
  });

  it("a missing id is a named miss, not a throw", () => {
    const del = call("event-delete", ctxA, {});
    assert.equal(del.ok, false);
    assert.equal(del.error, "event not found");
  });
});
