// FIX-council-008 — council membership is explicit (founder ruling A,
// 2026-11-13). Opening /lenses/council used to auto-join every
// signed-in viewer via a mount effect calling member-join, inflating
// the eligible-voter pool (quorum is a majority of members) with
// drive-by viewers. The FE auto-join is retired; this pin covers the
// server half of the explicit contract: member-join joins ONLY when
// called, member-leave removes ONLY the caller's own record, and
// both are idempotent. Reading (member-list) never joins.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerCouncilActions from "../domains/council.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`council.${name}`);
  if (!fn) throw new Error(`council.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerCouncilActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };
const ctxAnon = { actor: { userId: "" }, userId: "" };

describe("council explicit membership (FIX-council-008)", () => {
  it("reading the member list never joins the reader", () => {
    const before = call("member-list", ctxA);
    assert.equal(before.result.total, 0);
    call("member-list", ctxA);
    call("member-list", ctxB);
    const after = call("member-list", ctxA);
    assert.equal(after.result.total, 0, "member-list is a read; it must not join anyone");
  });

  it("member-join joins the caller exactly once (idempotent)", () => {
    const j1 = call("member-join", ctxA, { authorName: "Ada" });
    assert.equal(j1.ok, true);
    assert.equal(j1.result.total, 1);
    const j2 = call("member-join", ctxA, { authorName: "Ada" });
    assert.equal(j2.result.total, 1, "re-joining must not duplicate the member");
    const list = call("member-list", ctxB);
    assert.equal(list.result.total, 1);
    assert.equal(list.result.members[0].userId, "user_a");
  });

  it("member-leave removes only the caller's own record", () => {
    call("member-join", ctxA, {});
    call("member-join", ctxB, {});
    assert.equal(call("member-list", ctxA).result.total, 2);
    const left = call("member-leave", ctxA);
    assert.equal(left.ok, true);
    assert.equal(left.result.total, 1);
    const list = call("member-list", ctxA);
    assert.equal(list.result.members[0].userId, "user_b", "the other member is untouched");
  });

  it("leaving while not a member is a no-op success; anon cannot join or leave", () => {
    const left = call("member-leave", ctxA);
    assert.equal(left.ok, true);
    assert.equal(left.result.alreadyLeft, true);
    assert.equal(call("member-join", ctxAnon, {}).ok, false);
    assert.equal(call("member-leave", ctxAnon).ok, false);
  });
});
