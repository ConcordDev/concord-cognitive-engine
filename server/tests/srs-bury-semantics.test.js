// Bury semantics — founder ruling 2026-10-29 (the Anki model): a
// buried card stays out until the next day; an "Include buried"
// session studies it anyway; suspending a buried card reports the
// bury it lifts; no op claims a change that did not happen.
// "Tomorrow" in a test = the stored buriedDay moved to yesterday,
// which is what the clock does. Scaffold follows srs-study-core.

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
const todayKey = () => new Date().toISOString().slice(0, 10);
const dayKeyDaysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

function deckWithTwo() {
  const d = call("deck-create", ctxA, { name: "D" }).result.deck;
  const a = call("card-add", ctxA, { deckId: d.id, front: "alpha", back: "a" }).result.card;
  const b = call("card-add", ctxA, { deckId: d.id, front: "beta", back: "b" }).result.card;
  return { d, a, b };
}

describe("srs bury semantics (Anki model)", () => {
  it("burying stamps the day and keeps the card out of today's study", () => {
    const { d, a } = deckWithTwo();
    const r = call("card-bury", ctxA, { ids: [a.id], buried: true });
    assert.equal(r.result.updated, 1);
    assert.equal(a.buried, true);
    assert.equal(a.buriedDay, todayKey());
    const next = call("study-next", ctxA, { deckId: d.id });
    assert.equal(next.result.card.front, "beta");
    assert.equal(call("srs-dashboard", ctxA, {}).result.buriedCards, 1);
  });

  it("Include buried admits the buried card to the session", () => {
    const { d, a, b } = deckWithTwo();
    call("card-bury", ctxA, { ids: [a.id, b.id], buried: true });
    assert.equal(call("study-next", ctxA, { deckId: d.id }).result.card, null);
    const next = call("study-next", ctxA, { deckId: d.id, includeBuried: true });
    assert.ok(next.result.card);
    assert.equal(next.result.card.front, "alpha");
  });

  it("the bury lifts at rollover: the card returns and the stored flag clears on touch", () => {
    const { d, a } = deckWithTwo();
    call("card-bury", ctxA, { ids: [a.id], buried: true });
    a.buriedDay = dayKeyDaysAgo(1); // the clock rolls over
    const next = call("study-next", ctxA, { deckId: d.id });
    assert.equal(next.result.card.front, "alpha");
    call("card-browse", ctxA, {});
    assert.equal(a.buried, false);
    assert.equal(a.buriedDay, null);
    assert.equal(call("srs-dashboard", ctxA, {}).result.buriedCards, 0);
  });

  it("a legacy bury (no stamp) is never released silently, but Include buried still reaches it", () => {
    const { d, a, b } = deckWithTwo();
    call("card-bury", ctxA, { ids: [a.id, b.id], buried: true });
    delete a.buriedDay; delete b.buriedDay; // pre-ruling rows
    call("card-browse", ctxA, {}); // a touch must not free them
    assert.equal(a.buried, true);
    assert.equal(call("study-next", ctxA, { deckId: d.id }).result.card, null);
    assert.ok(call("study-next", ctxA, { deckId: d.id, includeBuried: true }).result.card);
  });

  it("suspending a buried card lifts the bury — and says so in the result", () => {
    const { a } = deckWithTwo();
    call("card-bury", ctxA, { ids: [a.id], buried: true });
    const r = call("card-suspend", ctxA, { ids: [a.id], suspended: true });
    assert.equal(r.result.updated, 1);
    assert.equal(r.result.unburied, 1);
    assert.equal(a.buried, false);
    assert.equal(a.buriedDay, null);
  });

  it("unsuspend on a buried card claims nothing it did not do", () => {
    const { a } = deckWithTwo();
    call("card-bury", ctxA, { ids: [a.id], buried: true });
    const r = call("card-suspend", ctxA, { ids: [a.id], suspended: false });
    assert.equal(r.result.updated, 0);
    assert.equal(r.result.unchanged, 1);
    assert.equal(a.buried, true); // still buried — the banner may not say otherwise
  });

  it("unbury clears the stamp and the card studies the same day", () => {
    const { d, a } = deckWithTwo();
    call("card-bury", ctxA, { ids: [a.id], buried: true });
    const r = call("card-bury", ctxA, { ids: [a.id], buried: false });
    assert.equal(r.result.updated, 1);
    assert.equal(a.buriedDay, null);
    assert.equal(call("study-next", ctxA, { deckId: d.id }).result.card.front, "alpha");
  });

  it("Include buried never admits a suspended card", () => {
    const { d, a, b } = deckWithTwo();
    call("card-bury", ctxA, { ids: [a.id], buried: true });
    call("card-suspend", ctxA, { ids: [b.id], suspended: true });
    const next = call("study-next", ctxA, { deckId: d.id, includeBuried: true });
    assert.equal(next.result.card.front, "alpha");
    call("card-bury", ctxA, { ids: [a.id], buried: false });
    call("card-suspend", ctxA, { ids: [a.id], suspended: true });
    assert.equal(call("study-next", ctxA, { deckId: d.id, includeBuried: true }).result.card, null);
  });
});
