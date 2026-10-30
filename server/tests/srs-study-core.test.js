// S3 + S4 — grade previews, learning steps, honest reps/lapses, and
// deck options that govern (Review 5 F3 + F4). Scaffold follows
// srs-domain-parity.test.js. "Elapsing" a step = moving the stored
// card's due into the past, which is what the clock does.

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
const deckWith = (opts, name = "D") => call("deck-create", ctxA, { name, options: opts }).result.deck;
const add = (deckId, front) => call("card-add", ctxA, { deckId, front, back: "b-" + front }).result.card;
const elapse = (card, ms = 1000) => { card.due = new Date(Date.now() - ms).toISOString(); };

describe("srs.study-preview", () => {
  it("exists, covers all four grades, and changes no state", () => {
    const d = deckWith({});
    const c = add(d.id, "p");
    const before = JSON.stringify(c);
    const r = call("study-preview", ctxA, { cardId: c.id });
    assert.equal(r.ok, true);
    for (const k of ["again", "hard", "good", "easy"]) assert.ok(r.result.previews[k].label, k);
    assert.equal(JSON.stringify(call("card-list", ctxA, { deckId: d.id }).result.cards[0]), before);
  });
  it("the preview promise equals the scheduled outcome", () => {
    const d = deckWith({});
    const c = add(d.id, "q");
    const pv = call("study-preview", ctxA, { cardId: c.id }).result.previews;
    const ans = call("study-answer", ctxA, { cardId: c.id, rating: "good" });
    assert.equal(ans.result.intervalLabel, pv.good.label);
    const days = Math.round((new Date(ans.result.card.due).getTime() - Date.now()) / 86400000);
    assert.equal(days, pv.good.days);
  });
  it("SM-2 previews for a new card: good 1d, easy 4d", () => {
    const d = deckWith({ scheduler: "sm2" });
    const c = add(d.id, "s");
    const pv = call("study-preview", ctxA, { cardId: c.id }).result.previews;
    assert.equal(pv.good.label, "1d");
    assert.equal(pv.easy.label, "4d");
  });
});

describe("srs learning steps + reps/lapses truth", () => {
  it("Again on a graded card: minutes away, reps count it, lapse counts, resurfaces", () => {
    const d = deckWith({});
    const c = add(d.id, "a");
    call("study-answer", ctxA, { cardId: c.id, rating: "good" });
    const again = call("study-answer", ctxA, { cardId: c.id, rating: "again" });
    assert.equal(again.result.nextReviewInMinutes, 1);
    assert.equal(again.result.card.reps, 2);
    assert.equal(again.result.card.lapses, 1);
    elapse(again.result.card, 2000);
    assert.equal(call("study-next", ctxA, { deckId: d.id }).result.card.id, c.id);
  });
  it("first-ever Again: reps becomes 1, lapses stay 0", () => {
    const d = deckWith({});
    const c = add(d.id, "bravo");
    const again = call("study-answer", ctxA, { cardId: c.id, rating: "again" });
    assert.equal(again.result.card.reps, 1);
    assert.equal(again.result.card.lapses, 0);
  });
  it("steps walk 1m -> 10m -> graduate", () => {
    const d = deckWith({ learningSteps: [1, 10] });
    const c = add(d.id, "w");
    let r = call("study-answer", ctxA, { cardId: c.id, rating: "again" });
    assert.equal(r.result.nextReviewInMinutes, 1);
    elapse(r.result.card, 2000);
    assert.equal(call("study-next", ctxA, { deckId: d.id }).result.card.id, c.id);
    r = call("study-answer", ctxA, { cardId: c.id, rating: "good" });
    assert.equal(r.result.nextReviewInMinutes, 10);
    elapse(r.result.card, 2000);
    r = call("study-answer", ctxA, { cardId: c.id, rating: "good" });
    assert.equal(r.result.nextReviewInMinutes, null);
    assert.ok(r.result.nextReviewInDays >= 1);
    assert.equal(r.result.card.inSteps, false);
  });
});

describe("srs caps govern (study-next)", () => {
  it("newPerDay caps introductions; due reviews are unaffected", () => {
    const d = deckWith({ newPerDay: 3 });
    const R = add(d.id, "R");
    const A = add(d.id, "A"); add(d.id, "B"); add(d.id, "D"); add(d.id, "E");
    call("study-answer", ctxA, { cardId: R.id, rating: "good" });
    call("study-answer", ctxA, { cardId: A.id, rating: "good" });
    const third = call("study-next", ctxA, { deckId: d.id }).result.card;
    call("study-answer", ctxA, { cardId: third.id, rating: "good" });
    elapse(call("card-list", ctxA, { deckId: d.id }).result.cards.find((x) => x.id === R.id), 60000);
    const next = call("study-next", ctxA, { deckId: d.id });
    assert.equal(next.result.card.id, R.id);
    call("study-answer", ctxA, { cardId: R.id, rating: "good" });
    const after = call("study-next", ctxA, { deckId: d.id });
    assert.equal(after.result.card, null);
    assert.equal(after.result.caps.introducedToday, 3);
  });
  it("reviewsPerDay withholds further due reviews once spent", () => {
    const d = deckWith({ reviewsPerDay: 1, newPerDay: 20 });
    const R1 = add(d.id, "R1"); const R2 = add(d.id, "R2");
    call("study-answer", ctxA, { cardId: R1.id, rating: "good" });
    call("study-answer", ctxA, { cardId: R2.id, rating: "good" });
    const cards = call("card-list", ctxA, { deckId: d.id }).result.cards;
    elapse(cards.find((x) => x.id === R1.id), 60000);
    elapse(cards.find((x) => x.id === R2.id), 60000);
    const first = call("study-next", ctxA, { deckId: d.id });
    assert.ok(first.result.card);
    call("study-answer", ctxA, { cardId: first.result.card.id, rating: "good" });
    const second = call("study-next", ctxA, { deckId: d.id });
    assert.equal(second.result.card, null);
    assert.equal(second.result.caps.reviewsToday, 1);
  });
});
