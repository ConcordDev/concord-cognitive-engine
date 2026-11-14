// FIX-fashion-005 — outfit, wishlist, capsule and packing records had
// create/list/delete but no update action anywhere (closet items and
// moodboards were the only editable fashion records). Each new update
// mirrors its create's validation and is owner-scoped like
// moodboard-update.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerFashionActions from "../domains/fashion.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`fashion.${name}`);
  assert.ok(fn, `fashion.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerFashionActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("fashion update actions (FIX-fashion-005)", () => {
  it("outfit-update renames and re-seasons, persisting to outfit-list; another user's outfit is not found", async () => {
    const outfit = (await call("outfit-create", ctxA, { name: "qa-zt4-fashion-2026-11-12-b" })).result.outfit;
    const r = await call("outfit-update", ctxA, { id: outfit.id, name: "qa-zt4-fashion-2026-11-12-b-edited", season: "winter" });
    assert.equal(r.ok, true);
    assert.equal(r.result.outfit.name, "qa-zt4-fashion-2026-11-12-b-edited");
    assert.equal(r.result.outfit.season, "winter");
    const listed = (await call("outfit-list", ctxA, {})).result.outfits;
    assert.equal(listed.find((o) => o.id === outfit.id).name, "qa-zt4-fashion-2026-11-12-b-edited");
    const alien = await call("outfit-update", ctxB, { id: outfit.id, name: "hijack" });
    assert.equal(alien.ok, false);
    const empty = await call("outfit-update", ctxA, { id: outfit.id, name: "   " });
    assert.equal(empty.ok, false);
  });

  it("wishlist-update edits name/price/note with add's validation", async () => {
    const entry = (await call("wishlist-add", ctxA, { name: "qa-zt4-fashion-2026-11-12-c", price: 10 })).result.entry;
    const r = await call("wishlist-update", ctxA, { id: entry.id, name: "edited boots", price: 42.5, note: "wait for sale" });
    assert.equal(r.ok, true);
    assert.equal(r.result.entry.name, "edited boots");
    assert.equal(r.result.entry.price, 42.5);
    assert.equal(r.result.entry.note, "wait for sale");
    const bad = await call("wishlist-update", ctxA, { id: entry.id, price: -1 });
    assert.equal(bad.ok, false);
    const alien = await call("wishlist-update", ctxB, { id: entry.id, name: "hijack" });
    assert.equal(alien.ok, false);
  });

  it("capsule-update renames within create's clamps", async () => {
    const capsule = (await call("capsule-create", ctxA, { name: "qa capsule" })).result.capsule;
    const r = await call("capsule-update", ctxA, { id: capsule.id, name: "qa capsule edited", targetSize: 999 });
    assert.equal(r.ok, true);
    assert.equal(r.result.capsule.name, "qa capsule edited");
    assert.equal(r.result.capsule.targetSize, 60);
    const alien = await call("capsule-update", ctxB, { id: capsule.id, name: "hijack" });
    assert.equal(alien.ok, false);
  });

  it("packing-update renames and sets a destination", async () => {
    const list = (await call("packing-create", ctxA, { name: "qa trip" })).result.packingList;
    const r = await call("packing-update", ctxA, { id: list.id, name: "qa trip edited", destination: "Lisbon" });
    assert.equal(r.ok, true);
    assert.equal(r.result.packingList.name, "qa trip edited");
    assert.equal(r.result.packingList.destination, "Lisbon");
    const alien = await call("packing-update", ctxB, { id: list.id, name: "hijack" });
    assert.equal(alien.ok, false);
  });
});
