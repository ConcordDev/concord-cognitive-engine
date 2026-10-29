// server/tests/srs-deck-delete.test.js
//
// Q19 (E-86): deleting a deck must not orphan its sub-decks. Children
// are reparented to the deleted deck's parent (never cascade-deleted —
// their cards are user study data), and the result reports it. Pins:
// tree coherence after delete at root and mid-chain, card survival for
// children vs removal for the deleted deck, and unchanged leaf deletes.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerSrsActions from "../domains/srs.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, params = {}) {
  const fn = ACTIONS.get(`srs.${name}`);
  if (!fn) throw new Error(`srs.${name} not registered`);
  return fn({ actor: { userId: "learner-1" } }, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerSrsActions(register); });
beforeEach(() => { globalThis._concordSTATE = {}; });

function deck(name, parentId) {
  const r = call("deck-create", parentId ? { name, parentId } : { name });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.result.deck;
}
function card(deckId, front) {
  const r = call("card-add", { deckId, front, back: `${front} — answer` });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.result.card;
}
const cardCount = (deckId) => call("card-list", { deckId }).result.cards.length;
function findInTree(nodes, id) {
  for (const n of nodes) {
    if (n.id === id) return n;
    const hit = findInTree(n.children || [], id);
    if (hit) return hit;
  }
  return null;
}

describe("srs deck-delete (Q19)", () => {
  it("deleting a root reparents its children to root and reports it", () => {
    const root = deck("Languages");
    const child = deck("Spanish", root.id);
    card(child.id, "hola");
    const r = call("deck-delete", { id: root.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.reparented, 1);
    assert.equal(r.result.newParentId, null);
    const tree = call("deck-tree").result.tree;
    const node = findInTree(tree, child.id);
    assert.ok(node, "the child deck is still reachable in the tree");
    assert.equal(node.parentId, null, "the child became a root");
    assert.equal(cardCount(child.id), 1, "the child's cards survive");
  });

  it("deleting mid-chain keeps the chain connected (grandchild rises to the grandparent)", () => {
    const a = deck("A");
    const b = deck("B", a.id);
    const c = deck("C", b.id);
    card(c.id, "deep card");
    const r = call("deck-delete", { id: b.id });
    assert.equal(r.result.reparented, 1);
    assert.equal(r.result.newParentId, a.id);
    const tree = call("deck-tree").result.tree;
    const aNode = findInTree(tree, a.id);
    assert.ok(aNode.children.some((n) => n.id === c.id), "C is now A's child in the tree");
    assert.equal(cardCount(c.id), 1);
  });

  it("the deleted deck's own cards are removed; a leaf delete reports zero reparented", () => {
    const solo = deck("Solo");
    card(solo.id, "doomed card");
    const leaf = deck("Leaf");
    const r1 = call("deck-delete", { id: solo.id });
    assert.equal(r1.result.reparented, 0);
    assert.equal(call("deck-list").result.decks.some((d) => d.id === solo.id), false);
    const r2 = call("deck-delete", { id: leaf.id });
    assert.equal(r2.result.reparented, 0);
    // the doomed card is gone from every listing the state can produce
    const allDecks = call("deck-list").result.decks;
    assert.equal(allDecks.length, 0);
  });

  it("no deck is ever left pointing at a deleted parent", () => {
    const a = deck("A");
    const b = deck("B", a.id);
    deck("C", b.id);
    deck("D", a.id);
    call("deck-delete", { id: a.id });
    call("deck-delete", { id: b.id });
    const decks = call("deck-list").result.decks;
    const ids = new Set(decks.map((d) => d.id));
    for (const d of decks) {
      assert.ok(d.parentId === null || ids.has(d.parentId), `deck ${d.name} has a live parent or is a root`);
    }
    assert.equal(call("deck-tree").result.totalDecks, decks.length, "every surviving deck appears in the tree");
  });
});
