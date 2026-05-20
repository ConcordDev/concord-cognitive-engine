// Contract tests for the debate lens — Kialo-shape argument-tree
// substrate in server/domains/debate.js.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerDebateActions from "../domains/debate.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`debate.${name}`);
  assert.ok(fn, `debate.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerDebateActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function newDebate(ctx = ctxA) {
  return call("debate-create", ctx, { thesis: "Remote work improves productivity." }).result.debate;
}

describe("debate.debate CRUD", () => {
  it("creates a debate scoped per user", () => {
    newDebate();
    assert.equal(call("debate-list", ctxA, {}).result.count, 1);
    assert.equal(call("debate-list", ctxB, {}).result.count, 0);
  });
  it("rejects a too-short thesis", () => {
    assert.equal(call("debate-create", ctxA, { thesis: "short" }).ok, false);
  });
  it("deletes a debate", () => {
    const d = newDebate();
    call("debate-delete", ctxA, { id: d.id });
    assert.equal(call("debate-list", ctxA, {}).result.count, 0);
  });
});

describe("debate.claim tree", () => {
  it("adds pro/con claims and nests sub-claims", () => {
    const d = newDebate();
    const pro = call("claim-add", ctxA, { debateId: d.id, stance: "pro", text: "Fewer commute hours." });
    assert.equal(pro.ok, true);
    call("claim-add", ctxA, { debateId: d.id, stance: "con", text: "Harder to collaborate." });
    const sub = call("claim-add", ctxA, { debateId: d.id, parentId: pro.result.claim.id, stance: "con", text: "But more distractions at home." });
    assert.equal(sub.ok, true);
    assert.equal(call("debate-detail", ctxA, { id: d.id }).result.debate.claims.length, 3);
  });
  it("rejects a claim under an unknown parent", () => {
    const d = newDebate();
    assert.equal(call("claim-add", ctxA, { debateId: d.id, parentId: "nope", text: "orphan claim" }).ok, false);
  });
  it("claim-delete cascades to sub-claims", () => {
    const d = newDebate();
    const pro = call("claim-add", ctxA, { debateId: d.id, stance: "pro", text: "Parent claim here." }).result.claim;
    call("claim-add", ctxA, { debateId: d.id, parentId: pro.id, stance: "pro", text: "Child claim here." });
    const del = call("claim-delete", ctxA, { debateId: d.id, claimId: pro.id });
    assert.equal(del.result.deleted.length, 2);
    assert.equal(call("debate-detail", ctxA, { id: d.id }).result.debate.claims.length, 0);
  });
  it("claim-edit changes text and stance", () => {
    const d = newDebate();
    const c = call("claim-add", ctxA, { debateId: d.id, stance: "pro", text: "Original claim." }).result.claim;
    call("claim-edit", ctxA, { debateId: d.id, claimId: c.id, text: "Edited claim text.", stance: "con" });
    const claim = call("debate-detail", ctxA, { id: d.id }).result.debate.claims[0];
    assert.equal(claim.text, "Edited claim text.");
    assert.equal(claim.stance, "con");
  });
});

describe("debate.scoring", () => {
  it("pro claims push support up, con claims pull it down", () => {
    const d = newDebate();
    call("claim-add", ctxA, { debateId: d.id, stance: "pro", text: "Strong pro point." });
    const afterPro = call("debate-detail", ctxA, { id: d.id }).result.score;
    assert.ok(afterPro.supportPct > 50);
    call("claim-add", ctxA, { debateId: d.id, stance: "con", text: "Strong con point." });
    const balanced = call("debate-detail", ctxA, { id: d.id }).result.score;
    assert.equal(balanced.supportPct, 50); // equal weight pro + con
  });
  it("votes shift a claim's weight and the thesis score", () => {
    const d = newDebate();
    const pro = call("claim-add", ctxA, { debateId: d.id, stance: "pro", text: "A pro claim." }).result.claim;
    const con = call("claim-add", ctxA, { debateId: d.id, stance: "con", text: "A con claim." }).result.claim;
    call("claim-vote", ctxA, { debateId: d.id, claimId: pro.id, weight: 5 });
    call("claim-vote", ctxA, { debateId: d.id, claimId: con.id, weight: 1 });
    const score = call("debate-detail", ctxA, { id: d.id }).result.score;
    assert.ok(score.supportPct > 50);
  });
  it("debate-dashboard aggregates debates + claims", () => {
    const d = newDebate();
    call("claim-add", ctxA, { debateId: d.id, stance: "pro", text: "A claim here." });
    const dash = call("debate-dashboard", ctxA, {});
    assert.equal(dash.result.debates, 1);
    assert.equal(dash.result.totalClaims, 1);
  });
});

describe("debate — analysis macros still intact", () => {
  it("fallacyCheck handles input", () => {
    const r = call("fallacyCheck", ctxA, {});
    assert.equal(r.ok, true);
  });
});
