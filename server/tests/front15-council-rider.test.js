// FIX-council-008 rider (founder ruling, 2026-11-13) — proposal
// authoring requires membership. The base fix made membership
// explicit (join/leave only, reads never join); proposal-create still
// ensured the author's membership implicitly, so any signed-in viewer
// could author and was silently made a member by authoring. The rider
// closes that leg: a non-member's proposal-create is refused by name
// and joins nobody; a member authors as before; leaving revokes
// authoring again.

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

describe("council proposal authoring requires membership (FIX-council-008 rider)", () => {
  it("a non-member's proposal-create is refused and joins nobody", () => {
    const r = call("proposal-create", ctxA, { title: "Guest proposal" });
    assert.equal(r.ok, false);
    assert.match(r.error, /join the council/i);
    const list = call("member-list", ctxB);
    assert.equal(list.result.total, 0, "a refused authoring attempt must not implicitly join the author");
    const proposals = call("proposal-list", ctxB);
    assert.equal(proposals.result.total, 0, "no proposal may be created by the refused attempt");
  });

  it("a member authors as before", () => {
    call("member-join", ctxA, { authorName: "Ada" });
    const r = call("proposal-create", ctxA, { title: "Member proposal" });
    assert.equal(r.ok, true);
    assert.equal(r.result.proposal.title, "Member proposal");
    assert.equal(r.result.proposal.authorId, "user_a");
  });

  it("leaving the council revokes authoring", () => {
    call("member-join", ctxA, { authorName: "Ada" });
    call("member-leave", ctxA);
    const r = call("proposal-create", ctxA, { title: "After leaving" });
    assert.equal(r.ok, false);
    assert.match(r.error, /join the council/i);
  });
});
