// Contract tests for the srs lens — Anki-shape deck/card/study
// substrate in server/domains/srs.js (the persistence macros; the
// pure-compute analytics are exercised elsewhere).

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

function newDeck(ctx = ctxA) {
  return call("deck-create", ctx, { name: "Spanish" }).result.deck;
}

describe("srs.deck CRUD", () => {
  it("creates a deck scoped per user", () => {
    newDeck();
    assert.equal(call("deck-list", ctxA, {}).result.count, 1);
    assert.equal(call("deck-list", ctxB, {}).result.count, 0);
  });
  it("rejects a deck with no name", () => {
    assert.equal(call("deck-create", ctxA, {}).ok, false);
  });
  it("delete removes the deck and its cards", () => {
    const d = newDeck();
    call("card-add", ctxA, { deckId: d.id, front: "hola", back: "hello" });
    call("deck-delete", ctxA, { id: d.id });
    assert.equal(call("deck-list", ctxA, {}).result.count, 0);
    assert.equal(call("card-list", ctxA, { deckId: d.id }).result.count, 0);
  });
});

describe("srs.card CRUD", () => {
  it("adds a card with new state and lists it", () => {
    const d = newDeck();
    const c = call("card-add", ctxA, { deckId: d.id, front: "gato", back: "cat", tags: ["animals"] });
    assert.equal(c.ok, true);
    assert.equal(c.result.card.state, "new");
    assert.equal(call("card-list", ctxA, { deckId: d.id }).result.count, 1);
  });
  it("rejects a card missing front/back or with an unknown deck", () => {
    const d = newDeck();
    assert.equal(call("card-add", ctxA, { deckId: d.id, front: "x" }).ok, false);
    assert.equal(call("card-add", ctxA, { deckId: "nope", front: "x", back: "y" }).ok, false);
  });
  it("updates and deletes a card", () => {
    const d = newDeck();
    const c = call("card-add", ctxA, { deckId: d.id, front: "perro", back: "dog" }).result.card;
    call("card-update", ctxA, { id: c.id, back: "the dog" });
    assert.equal(call("card-list", ctxA, { deckId: d.id }).result.cards[0].back, "the dog");
    call("card-delete", ctxA, { id: c.id });
    assert.equal(call("card-list", ctxA, { deckId: d.id }).result.count, 0);
  });
});

describe("srs.study session", () => {
  it("study-next returns a new card; study-answer schedules it forward", () => {
    const d = newDeck();
    const c = call("card-add", ctxA, { deckId: d.id, front: "uno", back: "one" }).result.card;
    const next = call("study-next", ctxA, { deckId: d.id });
    assert.equal(next.result.card.id, c.id);
    const ans = call("study-answer", ctxA, { cardId: c.id, rating: "good" });
    assert.equal(ans.ok, true);
    assert.equal(ans.result.nextReviewInDays, 1);
    assert.equal(ans.result.card.reps, 1);
  });
  it("rating 'again' drops ease and counts a lapse", () => {
    const d = newDeck();
    const c = call("card-add", ctxA, { deckId: d.id, front: "dos", back: "two" }).result.card;
    call("study-answer", ctxA, { cardId: c.id, rating: "good" });
    const again = call("study-answer", ctxA, { cardId: c.id, rating: "again" });
    assert.equal(again.result.card.lapses, 1);
    assert.ok(again.result.card.ease < 2.5);
    assert.equal(again.result.card.interval, 1);
  });
  it("'easy' grows the interval faster than 'good'", () => {
    const d = newDeck();
    const cg = call("card-add", ctxA, { deckId: d.id, front: "a", back: "1" }).result.card;
    const ce = call("card-add", ctxA, { deckId: d.id, front: "b", back: "2" }).result.card;
    const good = call("study-answer", ctxA, { cardId: cg.id, rating: "good" });
    const easy = call("study-answer", ctxA, { cardId: ce.id, rating: "easy" });
    assert.ok(easy.result.nextReviewInDays > good.result.nextReviewInDays);
  });
});

describe("srs.stats", () => {
  it("study-stats logs reviews into a 14-day heatmap", () => {
    const d = newDeck();
    const c = call("card-add", ctxA, { deckId: d.id, front: "tres", back: "three" }).result.card;
    call("study-answer", ctxA, { cardId: c.id, rating: "good" });
    call("study-answer", ctxA, { cardId: c.id, rating: "again" });
    const stats = call("study-stats", ctxA, { deckId: d.id });
    assert.equal(stats.result.totalReviews, 2);
    assert.equal(stats.result.accuracy, 50);
    assert.equal(stats.result.last14Days.length, 14);
  });
  it("srs-dashboard aggregates decks + cards", () => {
    const d = newDeck();
    call("card-add", ctxA, { deckId: d.id, front: "x", back: "y" });
    const dash = call("srs-dashboard", ctxA, {});
    assert.equal(dash.result.decks, 1);
    assert.equal(dash.result.totalCards, 1);
    assert.equal(dash.result.newCards, 1);
  });
});

describe("srs — pure-compute analytics still intact", () => {
  it("deckStats returns a guidance message with no cards", () => {
    const r = call("deckStats", ctxA, {});
    assert.equal(r.ok, true);
  });
});
