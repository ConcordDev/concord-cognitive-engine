// S5-S9 — filtered decks + one counting rule, honest bury/suspend,
// portable scheduling, grading undo (Review 5 F5-F9). Scaffold
// follows srs-domain-parity.test.js.

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
const deck = (name, opts) => call("deck-create", ctxA, { name, options: opts }).result.deck;
const add = (deckId, front, tags) => call("card-add", ctxA, { deckId, front, back: "b-" + front, tags }).result.card;
const listed = (id) => call("deck-list", ctxA, {}).result.decks.find((d) => d.id === id);

describe("srs counts — one rule (F5/F8)", () => {
  it("a parent deck's list counts include its subdecks (the study pool)", () => {
    const p = deck("P"); const c = call("deck-create", ctxA, { name: "C", parentId: p.id }).result.deck;
    add(p.id, "p1"); add(c.id, "c1"); add(c.id, "c2");
    assert.equal(listed(p.id).cardCount, 3);
    assert.equal(listed(c.id).cardCount, 2);
  });
  it("filtered decks count their query matches in list and tree", () => {
    const a = deck("A"); const b = deck("B");
    add(a.id, "t1", ["x"]); add(a.id, "t2", ["x"]); add(b.id, "t3", ["y"]);
    const fd = call("filtered-deck-create", ctxA, { name: "F", query: "tag:x" }).result.deck;
    assert.equal(listed(fd.id).cardCount, 2);
    const node = call("deck-tree", ctxA, {}).result.tree.find((n) => n.id === fd.id);
    assert.equal(node.ownCardCount, 2);
  });
  it("a filtered deck's query is editable via deck options; regular decks refuse", () => {
    const a = deck("A");
    add(a.id, "t1", ["x"]); add(a.id, "t2", ["y"]);
    const fd = call("filtered-deck-create", ctxA, { name: "F", query: "tag:x" }).result.deck;
    assert.equal(call("deck-options-update", ctxA, { deckId: fd.id, filterQuery: "tag:y" }).ok, true);
    assert.equal(listed(fd.id).cardCount, 1);
    assert.equal(call("deck-options-update", ctxA, { deckId: a.id, filterQuery: "tag:y" }).ok, false);
  });
  it("buried cards leave due counts; the dashboard counts them separately", () => {
    const d = deck("D");
    const c1 = add(d.id, "one"); add(d.id, "two");
    call("study-answer", ctxA, { cardId: c1.id, rating: "good" });
    c1.due = new Date(Date.now() - 1000).toISOString();
    assert.equal(listed(d.id).dueCount, 1);
    call("card-bury", ctxA, { id: c1.id, buried: true });
    assert.equal(listed(d.id).dueCount, 0);
    const dash = call("srs-dashboard", ctxA, {}).result;
    assert.equal(dash.dueCards, 0);
    assert.equal(dash.buriedCards, 1);
  });
});

describe("srs bury/suspend honesty (F6)", () => {
  it("unsuspend on a buried card reports no change", () => {
    const d = deck("D");
    const c = add(d.id, "x");
    call("card-bury", ctxA, { id: c.id, buried: true });
    const r = call("card-suspend", ctxA, { id: c.id, suspended: false });
    assert.equal(r.result.updated, 0);
    assert.equal(r.result.unchanged, 1);
    assert.equal(call("card-list", ctxA, { deckId: d.id }).result.cards[0].buried, true);
  });
  it("unbury restores the card to the study pool", () => {
    const d = deck("D");
    const c = add(d.id, "x");
    call("card-bury", ctxA, { id: c.id, buried: true });
    assert.equal(call("study-next", ctxA, { deckId: d.id }).result.card, null);
    call("card-bury", ctxA, { id: c.id, buried: false });
    assert.equal(call("study-next", ctxA, { deckId: d.id }).result.card.id, c.id);
  });
});

describe("srs portability (F7)", () => {
  it("export carries scheduling and an honest .srs.json filename", () => {
    const d = deck("D");
    const c = add(d.id, "x");
    call("study-answer", ctxA, { cardId: c.id, rating: "good" });
    call("study-answer", ctxA, { cardId: c.id, rating: "good" });
    const exp = call("deck-export", ctxA, { deckId: d.id }).result;
    assert.ok(exp.filename.endsWith(".srs.json"));
    assert.equal(exp.bundle.cards[0].scheduling.reps, 2);
  });
  it("the round trip preserves reps/interval/state", () => {
    const d = deck("D");
    const c = add(d.id, "x");
    call("study-answer", ctxA, { cardId: c.id, rating: "good" });
    call("study-answer", ctxA, { cardId: c.id, rating: "good" });
    const bundle = call("deck-export", ctxA, { deckId: d.id }).result.bundle;
    const imp = call("deck-import", ctxA, { bundle });
    const back = call("card-list", ctxA, { deckId: imp.result.deck.id }).result.cards[0];
    assert.equal(back.reps, 2);
    assert.equal(back.interval, c.interval);
    assert.equal(back.state, "learning");
  });
  it("flat scheduling fields on a hand-written bundle are preserved", () => {
    const imp = call("deck-import", ctxA, {
      bundle: { deck: { name: "Hand" }, cards: [{ front: "f", back: "b", interval: 6, state: "learning", reps: 5 }] },
    });
    const back = call("card-list", ctxA, { deckId: imp.result.deck.id }).result.cards[0];
    assert.equal(back.reps, 5);
    assert.equal(back.interval, 6);
    assert.equal(back.state, "learning");
  });
});

describe("srs grading undo (F9)", () => {
  it("undo restores the card and removes the logged review", () => {
    const d = deck("D");
    const c = add(d.id, "x");
    call("study-answer", ctxA, { cardId: c.id, rating: "good" });
    assert.equal(call("study-stats", ctxA, { deckId: d.id }).result.totalReviews, 1);
    assert.equal(call("study-undo", ctxA, {}).ok, true);
    const back = call("card-list", ctxA, { deckId: d.id }).result.cards[0];
    assert.equal(back.reps, 0);
    assert.equal(back.state, "new");
    assert.equal(call("study-stats", ctxA, { deckId: d.id }).result.totalReviews, 0);
  });
  it("undo after an Again restores the graduated state exactly", () => {
    const d = deck("D");
    const c = add(d.id, "x");
    call("study-answer", ctxA, { cardId: c.id, rating: "good" });
    const graduated = JSON.parse(JSON.stringify(call("card-list", ctxA, { deckId: d.id }).result.cards[0]));
    call("study-answer", ctxA, { cardId: c.id, rating: "again" });
    call("study-undo", ctxA, {});
    const back = call("card-list", ctxA, { deckId: d.id }).result.cards[0];
    assert.equal(back.state, graduated.state);
    assert.equal(back.interval, graduated.interval);
    assert.equal(back.due, graduated.due);
    assert.equal(back.inSteps, false);
  });
  it("undo with nothing graded is an honest error", () => {
    assert.equal(call("study-undo", ctxA, {}).ok, false);
  });
});
