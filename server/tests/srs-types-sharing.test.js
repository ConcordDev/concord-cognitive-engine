// S10-S14 — reversed generation, media upload/removal, desired
// retention governing FSRS, pool-scoped study stats (Review 5
// F10-F14). Scaffold follows srs-domain-parity.test.js.

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
const deck = (name, opts) => call("deck-create", ctxA, { name, options: opts }).result.deck;
const add = (deckId, front) => call("card-add", ctxA, { deckId, front, back: "b-" + front }).result.card;

describe("srs card types (F10)", () => {
  it("alsoReversed generates the swapped twin under one note", () => {
    const d = deck("R");
    const r = call("card-add", ctxA, { deckId: d.id, front: "q", back: "a", alsoReversed: true });
    assert.equal(r.result.generated, 2);
    const cards = call("card-list", ctxA, { deckId: d.id }).result.cards;
    assert.equal(cards.length, 2);
    assert.ok(cards[0].noteId && cards[0].noteId === cards[1].noteId);
    assert.ok(cards.some((c) => c.front === "a" && c.back === "q"));
  });
  it("drawn occlusion regions are stored verbatim; hiddenRegion indexes them", () => {
    const d = deck("O");
    const r = call("card-add", ctxA, {
      deckId: d.id, cardType: "image-occlusion", image: "https://img/x.png",
      occlusions: [{ x: 0.5, y: 0.25, w: 0.3, h: 0.2, label: "lung" }],
    });
    assert.equal(r.result.generated, 1);
    assert.equal(r.result.cards[0].occlusions[0].x, 0.5);
    assert.equal(r.result.cards[0].hiddenRegion, 0);
  });
});

describe("srs media (F11)", () => {
  it("a data-URL upload is stored; a non-media data URL is refused", () => {
    const ok = call("media-add", ctxA, { dataUrl: "data:image/png;base64,iVBORw0KGgo=", name: "dot.png" });
    assert.equal(ok.ok, true);
    assert.ok(ok.result.media.url.startsWith("data:image/png"));
    assert.equal(call("media-add", ctxA, { dataUrl: "data:text/html;base64,PHNjcmlwdD4=" }).ok, false);
  });
  it("media-remove removes only the caller's own asset, once", () => {
    const m = call("media-add", ctxA, { url: "https://x/y.png", name: "testimage" }).result.media;
    assert.equal(call("media-remove", ctxB, { id: m.id }).ok, false);
    assert.equal(call("media-remove", ctxA, { id: m.id }).ok, true);
    assert.equal(call("media-list", ctxA, {}).result.count, 0);
    assert.equal(call("media-remove", ctxA, { id: m.id }).ok, false);
  });
});

describe("srs desired retention (F12)", () => {
  it("options round-trip clamps retention to [0.7, 0.97]", () => {
    const d = deck("T", { desiredRetention: 0.5 });
    assert.equal(call("deck-options-get", ctxA, { deckId: d.id }).result.options.desiredRetention, 0.7);
  });
  it("higher retention promises shorter intervals in preview", () => {
    const hi = deck("Hi", { desiredRetention: 0.97 });
    const lo = deck("Lo", { desiredRetention: 0.8 });
    const phi = call("study-preview", ctxA, { cardId: add(hi.id, "x").id }).result.previews.good;
    const plo = call("study-preview", ctxA, { cardId: add(lo.id, "x").id }).result.previews.good;
    assert.equal(phi.days, 1);
    assert.equal(plo.days, 6);
  });
});

describe("srs study stats pool scope (F14)", () => {
  it("reviewsToday/againToday span subdecks; nextDueAt skips buried cards", () => {
    const p = deck("P");
    const child = call("deck-create", ctxA, { name: "C", parentId: p.id }).result.deck;
    call("study-answer", ctxA, { cardId: add(child.id, "kid").id, rating: "good" });
    const pc = add(p.id, "own");
    call("study-answer", ctxA, { cardId: pc.id, rating: "again" });
    let stats = call("study-stats", ctxA, { deckId: p.id }).result;
    assert.equal(stats.reviewsToday, 2);
    assert.equal(stats.againToday, 1);
    assert.ok(stats.nextDueAt && new Date(stats.nextDueAt).getTime() < Date.now() + 10 * 60 * 1000);
    call("card-bury", ctxA, { id: pc.id, buried: true });
    stats = call("study-stats", ctxA, { deckId: p.id }).result;
    assert.ok(new Date(stats.nextDueAt).getTime() > Date.now() + 60 * 60 * 1000);
  });
});
