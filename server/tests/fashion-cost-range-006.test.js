// FIX-fashion-006 — the closet Cost ($) field's upper-bound leg. The
// haiku lane's PARTIAL (e73205666) messaged negatives inline with no
// clamp, and no bound existed anywhere: -5 was floored to 0 silently by
// the server and 99,999,999,999 was stored as-is. One ceiling now
// governs every entry path — MAX_ITEM_COST in server/domains/fashion.js
// ($10,000,000, the sweep's standing money ceiling) — and out-of-range
// values are REFUSED by name, never floored or clamped.
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
const BOUND_WORDS = "$0 to $10,000,000";

describe("fashion cost range (FIX-fashion-006)", () => {
  it("item-add refuses a negative cost by name and stores nothing", async () => {
    const r = await call("item-add", ctxA, { name: "qa coat", cost: -5 });
    assert.equal(r.ok, false);
    assert.ok(r.error.includes(BOUND_WORDS), `error names the bound: ${r.error}`);
    const listed = (await call("item-list", ctxA, {})).result.items;
    assert.equal(listed.length, 0);
  });

  it("item-add refuses the walked absurd value 99999999999 by name", async () => {
    const r = await call("item-add", ctxA, { name: "qa coat", cost: 99999999999 });
    assert.equal(r.ok, false);
    assert.ok(r.error.includes(BOUND_WORDS), `error names the bound: ${r.error}`);
    const listed = (await call("item-list", ctxA, {})).result.items;
    assert.equal(listed.length, 0);
  });

  it("item-add accepts an ordinary cost and the ceiling itself", async () => {
    const a = await call("item-add", ctxA, { name: "qa coat", cost: 250 });
    assert.equal(a.ok, true);
    assert.equal(a.result.item.cost, 250);
    const b = await call("item-add", ctxA, { name: "qa gown", cost: 10000000 });
    assert.equal(b.ok, true);
    assert.equal(b.result.item.cost, 10000000);
    const c = await call("item-add", ctxA, { name: "qa tiara", cost: 10000001 });
    assert.equal(c.ok, false);
  });

  it("item-update refuses out-of-range costs before mutating; the stored cost is unchanged", async () => {
    const item = (await call("item-add", ctxA, { name: "qa coat", cost: 250 })).result.item;
    const neg = await call("item-update", ctxA, { id: item.id, cost: -5 });
    assert.equal(neg.ok, false);
    assert.ok(neg.error.includes(BOUND_WORDS));
    const big = await call("item-update", ctxA, { id: item.id, cost: 99999999999 });
    assert.equal(big.ok, false);
    const listed = (await call("item-list", ctxA, {})).result.items;
    assert.equal(listed.find((i) => i.id === item.id).cost, 250);
    const fine = await call("item-update", ctxA, { id: item.id, cost: 300 });
    assert.equal(fine.ok, true);
    assert.equal(fine.result.item.cost, 300);
  });

  it("wishlist-convert refuses an out-of-range effective cost and keeps the entry; an in-range convert succeeds", async () => {
    const big = (await call("wishlist-add", ctxA, { name: "qa yacht bag", price: 99999999999 })).result.entry;
    const refused = await call("wishlist-convert-to-item", ctxA, { id: big.id });
    assert.equal(refused.ok, false);
    assert.ok(refused.error.includes(BOUND_WORDS), `error names the bound: ${refused.error}`);
    const stillThere = (await call("wishlist-list", ctxA, {})).result.wishlist;
    assert.ok(stillThere.some((e) => e.id === big.id), "refused convert leaves the wishlist entry in place");
    const fine = (await call("wishlist-add", ctxA, { name: "qa scarf", price: 40 })).result.entry;
    const ok = await call("wishlist-convert-to-item", ctxA, { id: fine.id });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.item.cost, 40);
  });
});
