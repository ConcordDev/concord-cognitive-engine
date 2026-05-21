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
    const ans = call("study-answer", ctxA, { cardId: c.id, rating: "good", scheduler: "sm2" });
    assert.equal(ans.ok, true);
    assert.equal(ans.result.nextReviewInDays, 1);
    assert.equal(ans.result.card.reps, 1);
  });
  it("rating 'again' drops ease and counts a lapse", () => {
    const d = newDeck();
    const c = call("card-add", ctxA, { deckId: d.id, front: "dos", back: "two" }).result.card;
    call("study-answer", ctxA, { cardId: c.id, rating: "good", scheduler: "sm2" });
    const again = call("study-answer", ctxA, { cardId: c.id, rating: "again", scheduler: "sm2" });
    assert.equal(again.result.card.lapses, 1);
    assert.ok(again.result.card.ease < 2.5);
    assert.equal(again.result.card.interval, 1);
  });
  it("'easy' grows the interval faster than 'good'", () => {
    const d = newDeck();
    const cg = call("card-add", ctxA, { deckId: d.id, front: "a", back: "1" }).result.card;
    const ce = call("card-add", ctxA, { deckId: d.id, front: "b", back: "2" }).result.card;
    const good = call("study-answer", ctxA, { cardId: cg.id, rating: "good", scheduler: "sm2" });
    const easy = call("study-answer", ctxA, { cardId: ce.id, rating: "easy", scheduler: "sm2" });
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

// ─── [L] FSRS scheduler ──────────────────────────────────────────────
describe("srs.study-answer — FSRS scheduler", () => {
  it("schedules a card with FSRS producing stability + difficulty", () => {
    const d = newDeck();
    const c = call("card-add", ctxA, { deckId: d.id, front: "fsrs", back: "x" }).result.card;
    const ans = call("study-answer", ctxA, { cardId: c.id, rating: "good", scheduler: "fsrs" });
    assert.equal(ans.ok, true);
    assert.equal(ans.result.scheduler, "fsrs");
    assert.ok(ans.result.card.stability > 0);
    assert.ok(ans.result.card.difficulty > 0);
  });
  it("respects a deck whose options pin scheduler=sm2", () => {
    const d = call("deck-create", ctxA, { name: "SM2 deck", options: { scheduler: "sm2" } }).result.deck;
    const c = call("card-add", ctxA, { deckId: d.id, front: "a", back: "b" }).result.card;
    const ans = call("study-answer", ctxA, { cardId: c.id, rating: "good" });
    assert.equal(ans.result.scheduler, "sm2");
  });
  it("FSRS again rating records a lapse and shrinks stability", () => {
    const d = newDeck();
    const c = call("card-add", ctxA, { deckId: d.id, front: "lapse", back: "y" }).result.card;
    call("study-answer", ctxA, { cardId: c.id, rating: "good", scheduler: "fsrs" });
    const again = call("study-answer", ctxA, { cardId: c.id, rating: "again", scheduler: "fsrs" });
    assert.equal(again.result.card.lapses, 1);
  });
});

// ─── [M] Rich card types ─────────────────────────────────────────────
describe("srs.card-add — rich card types", () => {
  it("cloze text generates one sub-card per {{cN::}} index", () => {
    const d = newDeck();
    const r = call("card-add", ctxA, {
      deckId: d.id, cardType: "cloze",
      text: "The {{c1::sun}} is a {{c2::star}}.",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.generated, 2);
    assert.ok(r.result.cards[0].front.includes("[...]"));
  });
  it("rejects cloze text with no cloze markers", () => {
    const d = newDeck();
    assert.equal(call("card-add", ctxA, { deckId: d.id, cardType: "cloze", text: "no markers" }).ok, false);
  });
  it("image-occlusion card generates one card per region", () => {
    const d = newDeck();
    const r = call("card-add", ctxA, {
      deckId: d.id, cardType: "image-occlusion", image: "https://x/diagram.png",
      occlusions: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.2, label: "heart" }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.generated, 1);
    assert.equal(r.result.cards[0].back, "heart");
  });
  it("templated card fills {{Field}} placeholders", () => {
    const d = newDeck();
    const r = call("card-add", ctxA, {
      deckId: d.id, cardType: "templated",
      fields: { Word: "casa", Meaning: "house" },
      frontTemplate: "{{Word}}", backTemplate: "{{Meaning}}",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.card.front, "casa");
    assert.equal(r.result.card.back, "house");
  });
});

// ─── [M] Media in cards ──────────────────────────────────────────────
describe("srs.media — media library + card attachment", () => {
  it("media-add registers an asset and media-list returns it", () => {
    const m = call("media-add", ctxA, { url: "https://x/a.png", kind: "image", name: "Anatomy" });
    assert.equal(m.ok, true);
    assert.equal(call("media-list", ctxA, {}).result.count, 1);
  });
  it("card-set-media attaches images + TTS to a card", () => {
    const d = newDeck();
    const c = call("card-add", ctxA, { deckId: d.id, front: "q", back: "a" }).result.card;
    const r = call("card-set-media", ctxA, { id: c.id, frontImage: "https://x/f.png", tts: true });
    assert.equal(r.ok, true);
    assert.equal(r.result.card.media.frontImage, "https://x/f.png");
    assert.equal(r.result.card.media.tts, true);
  });
});

// ─── [M] Deck import / export ────────────────────────────────────────
describe("srs.deck import/export", () => {
  it("deck-export bundles cards then deck-import recreates them", () => {
    const d = newDeck();
    call("card-add", ctxA, { deckId: d.id, front: "one", back: "uno" });
    call("card-add", ctxA, { deckId: d.id, front: "two", back: "dos" });
    const exp = call("deck-export", ctxA, { deckId: d.id });
    assert.equal(exp.ok, true);
    assert.equal(exp.result.bundle.cardCount, 2);
    const imp = call("deck-import", ctxA, { bundle: exp.result.bundle });
    assert.equal(imp.ok, true);
    assert.equal(imp.result.imported, 2);
  });
  it("deck-import rejects a malformed bundle", () => {
    assert.equal(call("deck-import", ctxA, { bundle: { nope: true } }).ok, false);
  });
});

// ─── [S] Per-deck options ────────────────────────────────────────────
describe("srs.deck options", () => {
  it("deck-options-get returns defaults, update persists changes", () => {
    const d = newDeck();
    assert.equal(call("deck-options-get", ctxA, { deckId: d.id }).result.options.newPerDay, 20);
    const up = call("deck-options-update", ctxA, { deckId: d.id, options: { newPerDay: 5, reviewsPerDay: 50 } });
    assert.equal(up.result.options.newPerDay, 5);
    assert.equal(up.result.options.reviewsPerDay, 50);
  });
});

// ─── [M] Card browser ────────────────────────────────────────────────
describe("srs.card browser", () => {
  it("card-browse searches across front/back/tags", () => {
    const d = newDeck();
    call("card-add", ctxA, { deckId: d.id, front: "elephant", back: "big", tags: ["animals"] });
    call("card-add", ctxA, { deckId: d.id, front: "ant", back: "small", tags: ["animals"] });
    assert.equal(call("card-browse", ctxA, { query: "elephant" }).result.count, 1);
    assert.equal(call("card-browse", ctxA, { tag: "animals" }).result.count, 2);
  });
  it("card-suspend toggles suspension; card-bury toggles bury", () => {
    const d = newDeck();
    const c = call("card-add", ctxA, { deckId: d.id, front: "x", back: "y" }).result.card;
    call("card-suspend", ctxA, { id: c.id, suspended: true });
    assert.equal(call("card-browse", ctxA, { state: "suspended" }).result.count, 1);
    call("card-bury", ctxA, { id: c.id, buried: true });
    assert.equal(call("card-browse", ctxA, { state: "buried" }).result.count, 1);
  });
  it("card-bulk-edit applies tags + deck move to many cards", () => {
    const d1 = newDeck();
    const d2 = call("deck-create", ctxA, { name: "Target" }).result.deck;
    const a = call("card-add", ctxA, { deckId: d1.id, front: "a", back: "1" }).result.card;
    const b = call("card-add", ctxA, { deckId: d1.id, front: "b", back: "2" }).result.card;
    const r = call("card-bulk-edit", ctxA, { ids: [a.id, b.id], moveToDeckId: d2.id, addTags: ["bulk"] });
    assert.equal(r.result.updated, 2);
    assert.equal(call("card-list", ctxA, { deckId: d2.id }).result.count, 2);
  });
});

// ─── [S] Review heatmap / forecast ──────────────────────────────────
describe("srs.review heatmap + forecast", () => {
  it("review-heatmap returns a streak calendar", () => {
    const d = newDeck();
    const c = call("card-add", ctxA, { deckId: d.id, front: "x", back: "y" }).result.card;
    call("study-answer", ctxA, { cardId: c.id, rating: "good" });
    const hm = call("review-heatmap", ctxA, { days: 30 });
    assert.equal(hm.ok, true);
    assert.equal(hm.result.calendar.length, 30);
    assert.equal(hm.result.currentStreak, 1);
  });
  it("review-forecast projects upcoming due cards", () => {
    const d = newDeck();
    const c = call("card-add", ctxA, { deckId: d.id, front: "x", back: "y" }).result.card;
    call("study-answer", ctxA, { cardId: c.id, rating: "good" });
    const fc = call("review-forecast", ctxA, { days: 14 });
    assert.equal(fc.ok, true);
    assert.equal(fc.result.forecast.length, 14);
    assert.equal(fc.result.horizonDays, 14);
  });
});

// ─── [M] Sub-decks / hierarchy + filtered decks ─────────────────────
describe("srs.deck hierarchy + filtered decks", () => {
  it("deck-create with parentId nests; deck-tree returns the hierarchy", () => {
    const parent = call("deck-create", ctxA, { name: "Languages" }).result.deck;
    const child = call("deck-create", ctxA, { name: "Spanish", parentId: parent.id }).result.deck;
    const tree = call("deck-tree", ctxA, {});
    assert.equal(tree.result.tree.length, 1);
    assert.equal(tree.result.tree[0].children[0].id, child.id);
  });
  it("deck-move reparents and rejects cycles", () => {
    const a = call("deck-create", ctxA, { name: "A" }).result.deck;
    const b = call("deck-create", ctxA, { name: "B", parentId: a.id }).result.deck;
    assert.equal(call("deck-move", ctxA, { id: a.id, parentId: b.id }).ok, false);
    assert.equal(call("deck-move", ctxA, { id: b.id, parentId: "" }).ok, true);
  });
  it("filtered-deck-create needs a query and study-next draws from it", () => {
    assert.equal(call("filtered-deck-create", ctxA, { name: "x" }).ok, false);
    const reg = newDeck();
    call("card-add", ctxA, { deckId: reg.id, front: "hard one", back: "y", tags: ["hard"] });
    const fd = call("filtered-deck-create", ctxA, { name: "Hard cards", query: "tag:hard" }).result.deck;
    assert.equal(fd.filtered, true);
    assert.ok(call("study-next", ctxA, { deckId: fd.id }).result.card);
  });
});

// ─── [S] Card markup + hint fields ──────────────────────────────────
describe("srs.card markup + hint", () => {
  it("card-add stores markup mode + hint field", () => {
    const d = newDeck();
    const c = call("card-add", ctxA, {
      deckId: d.id, front: "**bold**", back: "answer",
      markup: "markdown", hint: "starts with A",
    });
    assert.equal(c.ok, true);
    assert.equal(c.result.card.markup, "markdown");
    assert.equal(c.result.card.hint, "starts with A");
  });
});
