// Contract tests for the fashion outfit collage-canvas macro
// (fashion.outfit-set-item-position) — Wave 4 gap-closure,
// docs/lens-specs/fashion-capability-map.md item 5: "Visual drag-and-resize
// outfit collage canvas" (Whering "Dress Me" parity). This is a
// cosmetic-interaction gap, not a data gap: the outfit's itemIds have
// always been real; what's new here is genuine per-item spatial
// arrangement (x/y position + scale) on a bounded virtual canvas, mirroring
// the existing fashion.moodboard-add-item pattern (clamped position +
// deterministic cascade default when unset).

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

function newOutfit(ctx, itemIds, over = {}) {
  return call("outfit-create", ctx, { name: "Weekend fit", occasion: "casual", itemIds, ...over }).result.outfit;
}

describe("fashion.outfit-create seeds an empty layout", () => {
  it("a freshly-created outfit carries layout: []", () => {
    const item = newItem();
    const outfit = newOutfit(ctxA, [item.id]);
    assert.deepEqual(outfit.layout, []);
  });
});

describe("fashion.outfit-detail computes a default cascade layout", () => {
  it("items with no explicit position get a deterministic, non-overlapping default", () => {
    const items = [newItem(ctxA, { name: "Tee" }), newItem(ctxA, { name: "Jeans" }), newItem(ctxA, { name: "Jacket" })];
    const outfit = newOutfit(ctxA, items.map((i) => i.id));
    const detail = call("outfit-detail", ctxA, { id: outfit.id });
    assert.equal(detail.ok, true);
    assert.equal(detail.result.layout.length, 3);
    for (const entry of detail.result.layout) {
      assert.equal(entry.custom, false);
      assert.equal(entry.scale, 1);
      assert.ok(entry.x >= 0 && entry.x <= 640);
      assert.ok(entry.y >= 0 && entry.y <= 640);
    }
    // Distinct items must not stack exactly on top of each other.
    const xs = detail.result.layout.map((e) => `${e.x},${e.y}`);
    assert.equal(new Set(xs).size, xs.length, "no two default positions coincide");
  });

  it("the default cascade is deterministic across repeated reads", () => {
    const items = [newItem(ctxA), newItem(ctxA)];
    const outfit = newOutfit(ctxA, items.map((i) => i.id));
    const d1 = call("outfit-detail", ctxA, { id: outfit.id }).result.layout;
    const d2 = call("outfit-detail", ctxA, { id: outfit.id }).result.layout;
    assert.deepEqual(d1, d2);
  });
});

describe("fashion.outfit-set-item-position — drag (x/y)", () => {
  it("persists an explicit position and marks the entry custom", () => {
    const item = newItem();
    const outfit = newOutfit(ctxA, [item.id]);
    const r = call("outfit-set-item-position", ctxA, { id: outfit.id, itemId: item.id, x: 120, y: 80 });
    assert.equal(r.ok, true);
    assert.equal(r.result.item.x, 120);
    assert.equal(r.result.item.y, 80);
    assert.equal(r.result.item.scale, 1);

    const detail = call("outfit-detail", ctxA, { id: outfit.id });
    const entry = detail.result.layout.find((l) => l.itemId === item.id);
    assert.equal(entry.x, 120);
    assert.equal(entry.y, 80);
    assert.equal(entry.custom, true);
  });

  it("clamps x/y to the bounded canvas [0, OUTFIT_CANVAS_MAX]", () => {
    const item = newItem();
    const outfit = newOutfit(ctxA, [item.id]);
    const r = call("outfit-set-item-position", ctxA, { id: outfit.id, itemId: item.id, x: 99999, y: -500 });
    assert.equal(r.ok, true);
    assert.equal(r.result.item.x, 640); // clamped to OUTFIT_CANVAS_MAX
    assert.equal(r.result.item.y, 0); // clamped to 0
  });

  it("a second drag call updates the same entry in place (no duplicate layout rows)", () => {
    const item = newItem();
    const outfit = newOutfit(ctxA, [item.id]);
    call("outfit-set-item-position", ctxA, { id: outfit.id, itemId: item.id, x: 10, y: 10 });
    const r2 = call("outfit-set-item-position", ctxA, { id: outfit.id, itemId: item.id, x: 200, y: 300 });
    assert.equal(r2.result.layout.filter((l) => l.itemId === item.id).length, 1);
    assert.equal(r2.result.item.x, 200);
    assert.equal(r2.result.item.y, 300);
  });
});

describe("fashion.outfit-set-item-position — resize (scale)", () => {
  it("clamps scale to [OUTFIT_SCALE_MIN, OUTFIT_SCALE_MAX]", () => {
    const item = newItem();
    const outfit = newOutfit(ctxA, [item.id]);
    const tooSmall = call("outfit-set-item-position", ctxA, { id: outfit.id, itemId: item.id, scale: 0.01 });
    assert.equal(tooSmall.result.item.scale, 0.5);
    const tooBig = call("outfit-set-item-position", ctxA, { id: outfit.id, itemId: item.id, scale: 99 });
    assert.equal(tooBig.result.item.scale, 2.0);
  });

  it("a resize-only call (scale) does not reset a previously-dragged position", () => {
    const item = newItem();
    const outfit = newOutfit(ctxA, [item.id]);
    call("outfit-set-item-position", ctxA, { id: outfit.id, itemId: item.id, x: 300, y: 250 });
    const resized = call("outfit-set-item-position", ctxA, { id: outfit.id, itemId: item.id, scale: 1.5 });
    assert.equal(resized.result.item.x, 300);
    assert.equal(resized.result.item.y, 250);
    assert.equal(resized.result.item.scale, 1.5);
  });

  it("a drag-only call (x/y) does not reset a previously-set scale", () => {
    const item = newItem();
    const outfit = newOutfit(ctxA, [item.id]);
    call("outfit-set-item-position", ctxA, { id: outfit.id, itemId: item.id, scale: 1.8 });
    const dragged = call("outfit-set-item-position", ctxA, { id: outfit.id, itemId: item.id, x: 50, y: 60 });
    assert.equal(dragged.result.item.scale, 1.8);
    assert.equal(dragged.result.item.x, 50);
    assert.equal(dragged.result.item.y, 60);
  });
});

describe("fashion.outfit-set-item-position — rejection paths", () => {
  it("rejects an unknown outfit", () => {
    const item = newItem();
    const r = call("outfit-set-item-position", ctxA, { id: "nope", itemId: item.id, x: 1, y: 1 });
    assert.equal(r.ok, false);
    assert.ok(String(r.error).includes("outfit not found"));
  });

  it("rejects an itemId that is not part of the outfit", () => {
    const inOutfit = newItem(ctxA, { name: "In outfit" });
    const notInOutfit = newItem(ctxA, { name: "Not in outfit" });
    const outfit = newOutfit(ctxA, [inOutfit.id]);
    const r = call("outfit-set-item-position", ctxA, { id: outfit.id, itemId: notInOutfit.id, x: 1, y: 1 });
    assert.equal(r.ok, false);
    assert.ok(String(r.error).includes("not part of this outfit"));
  });

  it("a rejected position call does not mutate the outfit's layout", () => {
    const item = newItem();
    const outfit = newOutfit(ctxA, [item.id]);
    call("outfit-set-item-position", ctxA, { id: outfit.id, itemId: item.id, x: 100, y: 100 });
    const before = call("outfit-detail", ctxA, { id: outfit.id }).result.layout;
    call("outfit-set-item-position", ctxA, { id: outfit.id, itemId: "ghost_item", x: 999, y: 999 });
    const after = call("outfit-detail", ctxA, { id: outfit.id }).result.layout;
    assert.deepEqual(before, after);
  });
});

describe("fashion.outfit-set-item-position — ownership scoping", () => {
  it("a caller cannot position an item on another user's outfit", () => {
    const itemA = newItem(ctxA);
    const outfitA = newOutfit(ctxA, [itemA.id]);
    const r = call("outfit-set-item-position", ctxB, { id: outfitA.id, itemId: itemA.id, x: 10, y: 10 });
    assert.equal(r.ok, false);
    assert.ok(String(r.error).includes("outfit not found"));
  });

  it("each user's outfit layout is isolated", () => {
    const itemA = newItem(ctxA);
    const itemB = newItem(ctxB, { name: "B's shirt" });
    const outfitA = newOutfit(ctxA, [itemA.id]);
    const outfitB = newOutfit(ctxB, [itemB.id]);
    call("outfit-set-item-position", ctxA, { id: outfitA.id, itemId: itemA.id, x: 11, y: 22 });
    call("outfit-set-item-position", ctxB, { id: outfitB.id, itemId: itemB.id, x: 33, y: 44 });

    const detailA = call("outfit-detail", ctxA, { id: outfitA.id }).result.layout;
    const detailB = call("outfit-detail", ctxB, { id: outfitB.id }).result.layout;
    assert.equal(detailA.find((l) => l.itemId === itemA.id).x, 11);
    assert.equal(detailB.find((l) => l.itemId === itemB.id).x, 33);
  });
});

describe("fashion.outfit collage round-trip", () => {
  it("create -> drag two items -> resize one -> detail reflects both", () => {
    const items = [newItem(ctxA, { name: "Top" }), newItem(ctxA, { name: "Bottom" })];
    const outfit = newOutfit(ctxA, items.map((i) => i.id));

    call("outfit-set-item-position", ctxA, { id: outfit.id, itemId: items[0].id, x: 40, y: 40 });
    call("outfit-set-item-position", ctxA, { id: outfit.id, itemId: items[1].id, x: 300, y: 40 });
    call("outfit-set-item-position", ctxA, { id: outfit.id, itemId: items[0].id, scale: 1.3 });

    const detail = call("outfit-detail", ctxA, { id: outfit.id });
    const l0 = detail.result.layout.find((l) => l.itemId === items[0].id);
    const l1 = detail.result.layout.find((l) => l.itemId === items[1].id);
    assert.equal(l0.x, 40); assert.equal(l0.y, 40); assert.equal(l0.scale, 1.3); assert.equal(l0.custom, true);
    assert.equal(l1.x, 300); assert.equal(l1.y, 40); assert.equal(l1.scale, 1); assert.equal(l1.custom, true);
  });
});
