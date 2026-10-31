// F5 — filtered decks must match the cards their query names.
// Re-pass 1 (2026-10-30) live evidence: a filtered deck on
// tag:PR5RPtag showed 0 cards while 3 tagged cards existed.
// Scaffold follows srs-study-core.

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

function seed() {
  const d = call("deck-create", ctxA, { name: "Main" }).result.deck;
  const a = call("card-add", ctxA, { deckId: d.id, front: "one", back: "1", tags: ["PR5RPtag"] }).result.card;
  const b = call("card-add", ctxA, { deckId: d.id, front: "two", back: "2", tags: ["PR5RPtag", "other"] }).result.card;
  const c = call("card-add", ctxA, { deckId: d.id, front: "three", back: "3", tags: ["other"] }).result.card;
  return { d, a, b, c };
}
const filteredDeck = (query) => call("filtered-deck-create", ctxA, { name: "F:" + query, query }).result.deck;
const countsFor = (deckId) => call("deck-list", ctxA, {}).result.decks.find((x) => x.id === deckId);

describe("srs filtered decks (F5)", () => {
  it("a tag: query matches cards whose tag differs only by case (the re-pass case)", () => {
    seed();
    const fd = filteredDeck("tag:PR5RPtag");
    const counts = countsFor(fd.id);
    assert.equal(counts.cardCount, 2);
    assert.equal(counts.newCount, 2);
  });

  it("the study session serves the matched cards", () => {
    seed();
    const fd = filteredDeck("tag:PR5RPtag");
    const next = call("study-next", ctxA, { deckId: fd.id });
    assert.ok(next.result.card);
    assert.ok(["one", "two"].includes(next.result.card.front));
    assert.equal(next.result.remaining, 2);
  });

  it("a lowercase query matches the same cards (no regression)", () => {
    seed();
    const fd = filteredDeck("tag:pr5rptag");
    assert.equal(countsFor(fd.id).cardCount, 2);
  });

  it("a tag nobody carries still matches nothing (no over-matching)", () => {
    seed();
    const fd = filteredDeck("tag:nosuchtag");
    assert.equal(countsFor(fd.id).cardCount, 0);
    assert.equal(call("study-next", ctxA, { deckId: fd.id }).result.card, null);
  });

  it("is:due and free-text queries keep working", () => {
    const { a } = seed();
    call("study-answer", ctxA, { cardId: a.id, rating: "good" }); // now scheduled, not due
    const fdText = filteredDeck("three");
    assert.equal(countsFor(fdText.id).cardCount, 1);
    const fdNew = filteredDeck("is:new");
    assert.equal(countsFor(fdNew.id).cardCount, 2); // two un-graded new cards remain
  });

  it("editing the query re-aims the deck", () => {
    seed();
    const fd = filteredDeck("tag:nosuchtag");
    assert.equal(countsFor(fd.id).cardCount, 0);
    const r = call("deck-options-update", ctxA, { deckId: fd.id, filterQuery: "tag:Other" });
    assert.equal(r.ok, true);
    assert.equal(countsFor(fd.id).cardCount, 2); // 'other' rides two cards, case aside
  });
});
