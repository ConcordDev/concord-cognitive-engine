// Contract tests for the fashion Stylebook 2026-parity digital-closet
// macros (wardrobe, outfits, wear calendar, packing, lookbooks,
// analytics). vision/compute macros covered elsewhere.

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

function newItem(ctx = ctxA, over = {}) {
  return call("item-add", ctx, { name: "White tee", category: "top", cost: 30, ...over }).result.item;
}

describe("fashion.item-* wardrobe", () => {
  it("add requires a name, scoped per user", () => {
    assert.equal(call("item-add", ctxA, {}).ok, false);
    newItem();
    assert.equal(call("item-list", ctxA, {}).result.count, 1);
    assert.equal(call("item-list", ctxB, {}).result.count, 0);
  });

  it("wearing accrues count and cost-per-wear", () => {
    const item = newItem(ctxA, { cost: 50 });
    call("item-wear", ctxA, { id: item.id });
    call("item-wear", ctxA, { id: item.id });
    const list = call("item-list", ctxA, {});
    assert.equal(list.result.items[0].timesWorn, 2);
    assert.equal(list.result.items[0].costPerWear, 25);
    assert.equal(list.result.items[0].valueRating, "moderate");
  });

  it("update and delete", () => {
    const item = newItem();
    assert.equal(call("item-update", ctxA, { id: item.id, cost: 10 }).result.item.cost, 10);
    assert.equal(call("item-delete", ctxA, { id: item.id }).ok, true);
    assert.equal(call("item-list", ctxA, {}).result.count, 0);
  });
});

describe("fashion.outfit-*", () => {
  it("create outfit from items, wearing cascades to items", () => {
    const top = newItem(ctxA, { name: "Shirt" });
    const bottom = newItem(ctxA, { name: "Jeans", category: "bottom" });
    const outfit = call("outfit-create", ctxA, { name: "Weekend", itemIds: [top.id, bottom.id] }).result.outfit;
    assert.equal(outfit.itemIds.length, 2);
    call("outfit-wear", ctxA, { id: outfit.id });
    const detail = call("outfit-detail", ctxA, { id: outfit.id });
    assert.equal(detail.result.outfit.timesWorn, 1);
    assert.equal(detail.result.items[0].timesWorn, 1);
  });

  it("outfit list + delete", () => {
    const o = call("outfit-create", ctxA, { name: "Office" }).result.outfit;
    assert.equal(call("outfit-list", ctxA, {}).result.count, 1);
    assert.equal(call("outfit-delete", ctxA, { id: o.id }).ok, true);
  });
});

describe("fashion.calendar", () => {
  it("logs wears and groups by month", () => {
    const item = newItem();
    call("calendar-log", ctxA, { itemId: item.id, date: "2026-05-10" });
    call("calendar-log", ctxA, { itemId: item.id, date: "2026-05-12" });
    const view = call("calendar-view", ctxA, { month: "2026-05" });
    assert.equal(view.result.entries.length, 2);
    assert.equal(view.result.daysLogged, 2);
  });

  it("rejects calendar log without item or outfit", () => {
    assert.equal(call("calendar-log", ctxA, { date: "2026-05-10" }).ok, false);
  });
});

describe("fashion.packing + lookbooks", () => {
  it("packing list collects items", () => {
    const item = newItem();
    const list = call("packing-create", ctxA, { name: "Beach trip", destination: "Maui" }).result.packingList;
    call("packing-add-item", ctxA, { packingId: list.id, itemId: item.id });
    assert.equal(call("packing-detail", ctxA, { id: list.id }).result.items.length, 1);
    assert.equal(call("packing-list", ctxA, {}).result.packingLists[0].itemCount, 1);
  });

  it("lookbook collects outfits", () => {
    const o = call("outfit-create", ctxA, { name: "Look 1" }).result.outfit;
    const lb = call("lookbook-create", ctxA, { name: "Spring 2026" }).result.lookbook;
    call("lookbook-add-outfit", ctxA, { lookbookId: lb.id, outfitId: o.id });
    assert.equal(call("lookbook-list", ctxA, {}).result.lookbooks[0].outfitCount, 1);
  });
});

describe("fashion.analytics", () => {
  it("closet-stats aggregates value and categories", () => {
    newItem(ctxA, { category: "top", cost: 40 });
    newItem(ctxA, { category: "bottom", cost: 60 });
    const stats = call("closet-stats", ctxA, {});
    assert.equal(stats.result.items, 2);
    assert.equal(stats.result.totalValue, 100);
    assert.equal(stats.result.neverWorn, 2);
  });

  it("wear-insights ranks most-worn and dead stock", () => {
    const a = newItem(ctxA, { name: "Worn lots" });
    newItem(ctxA, { name: "Never worn" });
    call("item-wear", ctxA, { id: a.id });
    call("item-wear", ctxA, { id: a.id });
    const ins = call("wear-insights", ctxA, {});
    assert.equal(ins.result.mostWorn[0].name, "Worn lots");
    assert.equal(ins.result.deadStock, 1);
  });

  it("fashion-dashboard aggregates", () => {
    newItem();
    call("outfit-create", ctxA, { name: "O" });
    const d = call("fashion-dashboard", ctxA, {});
    assert.equal(d.result.items, 1);
    assert.equal(d.result.outfits, 1);
    assert.equal(d.result.neverWorn, 1);
  });
});
