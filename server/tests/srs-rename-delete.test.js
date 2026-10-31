// S2 — deck rename + delete re-parenting (Review 5 F2).
// Rename rides deck-options-update (a name field in deck options);
// deleting a deck moves its subdecks up instead of orphaning them
// out of the deck tree. Scaffold follows srs-domain-parity.test.js.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerSrsActions from "../domains/srs.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`srs.${name}`);
  assert.ok(fn, `srs.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerSrsActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("srs.rename via deck options", () => {
  it("renames and the new name persists in deck-list", () => {
    const d = call("deck-create", ctxA, { name: "Old Name" }).result.deck;
    const r = call("deck-options-update", ctxA, { deckId: d.id, name: "New Name 1234" });
    assert.equal(r.ok, true);
    assert.equal(r.result.name, "New Name 1234");
    assert.equal(call("deck-list", ctxA, {}).result.decks[0].name, "New Name 1234");
  });
  it("rejects an empty rename and another user's deck", () => {
    const d = call("deck-create", ctxA, { name: "Mine" }).result.deck;
    assert.equal(call("deck-options-update", ctxA, { deckId: d.id, name: "   " }).ok, false);
    assert.equal(call("deck-options-update", ctxB, { deckId: d.id, name: "Stolen" }).ok, false);
    assert.equal(call("deck-list", ctxA, {}).result.decks[0].name, "Mine");
  });
  it("an options update without a name leaves the name untouched", () => {
    const d = call("deck-create", ctxA, { name: "Keep Me" }).result.deck;
    assert.equal(call("deck-options-update", ctxA, { deckId: d.id, options: { newPerDay: 7 } }).ok, true);
    assert.equal(call("deck-list", ctxA, {}).result.decks[0].name, "Keep Me");
  });
});

describe("srs.delete re-parents subdecks", () => {
  it("children move to the deleted deck's parent; their cards survive", () => {
    const gp = call("deck-create", ctxA, { name: "GP" }).result.deck;
    const parent = call("deck-create", ctxA, { name: "P", parentId: gp.id }).result.deck;
    const child = call("deck-create", ctxA, { name: "C", parentId: parent.id }).result.deck;
    call("card-add", ctxA, { deckId: parent.id, front: "pf", back: "pb" });
    call("card-add", ctxA, { deckId: child.id, front: "cf", back: "cb" });
    assert.equal(call("deck-delete", ctxA, { id: parent.id }).ok, true);
    const decks = call("deck-list", ctxA, {}).result.decks;
    assert.equal(decks.length, 2);
    assert.equal(decks.find((x) => x.id === child.id).parentId, gp.id);
    assert.equal(call("card-list", ctxA, { deckId: parent.id }).result.count, 0);
    assert.equal(call("card-list", ctxA, { deckId: child.id }).result.count, 1);
    const tree = call("deck-tree", ctxA, {}).result.tree;
    assert.equal(tree[0].children[0].id, child.id);
  });
  it("children of a top-level deck land at the top level", () => {
    const parent = call("deck-create", ctxA, { name: "Top" }).result.deck;
    call("deck-create", ctxA, { name: "Kid", parentId: parent.id });
    call("deck-delete", ctxA, { id: parent.id });
    const decks = call("deck-list", ctxA, {}).result.decks;
    assert.equal(decks.length, 1);
    assert.equal(decks[0].parentId, null);
  });
});
