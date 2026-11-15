// FIX-reasoning-005 (chains leg) — reasoning chains get an ownership model.
//
// Before: chains lived in the global STATE.reasoning.chains Map with no
// owner — list_chains showed everyone's chains and no delete existed at
// all. Now: create_chain stamps the creator's actor id (from ctx, never
// from client input), list rows carry ownerId, and delete_chain removes
// a chain only for its stamped owner. Legacy chains (ownerId null) are
// not member-deletable. HLR traces are untouched (immutable by design).

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { load } from "./depth/_harness.js";

describe("reasoning chain ownership (FIX-reasoning-005)", () => {
  let runMacro, STATE, makeInternalCtx, alice, bob;

  before(async () => {
    const t = await load();
    runMacro = t.runMacro;
    STATE = t.STATE;
    makeInternalCtx = t.makeInternalCtx;
    alice = makeInternalCtx("chain-owner-alice");
    bob = makeInternalCtx("chain-owner-bob");
    assert.notEqual(alice.actor.userId, bob.actor.userId);
  });

  it("create_chain stamps the creator's actor id as ownerId", async () => {
    const r = await runMacro("reasoning", "create_chain", { question: "Alice's chain" }, alice);
    assert.equal(r.ok, true);
    assert.equal(r.chain.ownerId, alice.actor.userId);
    assert.ok(STATE.reasoning.chains.get(r.chain.id));
  });

  it("a client-supplied ownerId in input never wins over the ctx stamp", async () => {
    const r = await runMacro("reasoning", "create_chain", { question: "spoof attempt", ownerId: "mallory" }, alice);
    assert.equal(r.ok, true);
    assert.equal(r.chain.ownerId, alice.actor.userId);
  });

  it("list_chains rows carry ownerId", async () => {
    const r = await runMacro("reasoning", "list_chains", {}, alice);
    assert.equal(r.ok, true);
    const mine = r.chains.filter((c) => c.question === "Alice's chain");
    assert.equal(mine.length, 1);
    assert.equal(mine[0].ownerId, alice.actor.userId);
  });

  it("the owner can delete their chain (and its steps go with it)", async () => {
    const c = await runMacro("reasoning", "create_chain", { question: "delete me" }, alice);
    const id = c.chain.id;
    const s = await runMacro("reasoning", "add_step", { chainId: id, conclusion: "step one", justification: "because" }, alice);
    assert.equal(s.ok, true);
    const d = await runMacro("reasoning", "delete_chain", { chainId: id }, alice);
    assert.equal(d.ok, true);
    assert.equal(d.deleted, id);
    assert.equal(STATE.reasoning.chains.get(id), undefined);
    const trace = await runMacro("reasoning", "get_trace", { chainId: id }, alice);
    assert.equal(trace.ok, false);
  });

  it("a non-owner cannot delete someone else's chain", async () => {
    const c = await runMacro("reasoning", "create_chain", { question: "bob keep out" }, alice);
    const id = c.chain.id;
    const d = await runMacro("reasoning", "delete_chain", { chainId: id }, bob);
    assert.equal(d.ok, false);
    assert.match(d.error, /forbidden/i);
    assert.ok(STATE.reasoning.chains.get(id), "chain survives a foreign delete attempt");
  });

  it("legacy chains (ownerId null) are not member-deletable", async () => {
    STATE.reasoning.chains.set("chain_legacy_test", {
      id: "chain_legacy_test", ownerId: null, question: "legacy", goal: "", type: "deductive",
      steps: [], assumptions: [], conclusion: null, status: "active", confidence: 1.0,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    const d = await runMacro("reasoning", "delete_chain", { chainId: "chain_legacy_test" }, alice);
    assert.equal(d.ok, false);
    assert.ok(STATE.reasoning.chains.get("chain_legacy_test"), "legacy chain survives");
    STATE.reasoning.chains.delete("chain_legacy_test");
  });

  it("deleting a missing chain and a missing chainId refuse honestly", async () => {
    const d1 = await runMacro("reasoning", "delete_chain", { chainId: "chain_nope" }, alice);
    assert.equal(d1.ok, false);
    assert.match(d1.error, /not found/i);
    const d2 = await runMacro("reasoning", "delete_chain", {}, alice);
    assert.equal(d2.ok, false);
    assert.match(d2.error, /chainId required/i);
  });
});
