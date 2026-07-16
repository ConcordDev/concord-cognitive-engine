import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerActions from "../domains/retail.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`retail.${name}`);
  if (!fn) throw new Error(`retail.${name} not registered`);
  return fn(ctx, { id: null, data: params, meta: {} }, params);
}

before(() => { registerActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const ctxA = { actor: { userId: "u" }, userId: "u" };
const ctxB = { actor: { userId: "v" }, userId: "v" };

describe("retail — richer product schema (Wave 4, final deferred item)", () => {
  describe("non-destructive preserve — the landmine", () => {
    it("a minimal {sku,name,price,stock} upsert after a richer one does NOT wipe supplier/leadTimeDays/dailySalesRate", () => {
      call("product-upsert", ctxA, {
        sku: "P1", name: "Widget", price: 10, stock: 5,
        supplier: "Acme Supply Co", leadTimeDays: 14, dailySalesRate: 3,
      });
      const minimal = call("product-upsert", ctxA, { sku: "P1", name: "Widget", price: 10, stock: 5 });
      assert.equal(minimal.ok, true);
      assert.equal(minimal.result.product.supplier, "Acme Supply Co");
      assert.equal(minimal.result.product.leadTimeDays, 14);
      assert.equal(minimal.result.product.dailySalesRate, 3);
    });

    it("stock-only-touching re-upsert (the POS decrement shape) also preserves catalog depth", () => {
      call("product-upsert", ctxA, {
        sku: "P2", name: "Gadget", price: 20, stock: 10, supplier: "Beta Corp", leadTimeDays: 7,
      });
      // Exactly the shape cart-tender's internal stock decrement writes would use
      // if it ever went through this macro (it mutates in place instead, but this
      // proves the contract for any future/external caller using the same shape).
      const again = call("product-upsert", ctxA, { sku: "P2", name: "Gadget", price: 20, stock: 8 });
      assert.equal(again.ok, true);
      assert.equal(again.result.product.supplier, "Beta Corp");
      assert.equal(again.result.product.leadTimeDays, 7);
      assert.equal(again.result.product.stock, 8);
    });

    it("an explicit empty/null leadTimeDays DOES clear it (the deliberate unset path)", () => {
      call("product-upsert", ctxA, { sku: "P3", name: "X", price: 5, stock: 1, leadTimeDays: 21 });
      const cleared = call("product-upsert", ctxA, { sku: "P3", name: "X", price: 5, stock: 1, leadTimeDays: null });
      assert.equal(cleared.ok, true);
      assert.equal(cleared.result.product.leadTimeDays, null);
    });

    it("an explicit new supplier value DOES overwrite the prior one", () => {
      call("product-upsert", ctxA, { sku: "P4", name: "X", price: 5, stock: 1, supplier: "Old Co" });
      const updated = call("product-upsert", ctxA, { sku: "P4", name: "X", price: 5, stock: 1, supplier: "New Co" });
      assert.equal(updated.ok, true);
      assert.equal(updated.result.product.supplier, "New Co");
    });

    it("defaults on true create: supplier='', leadTimeDays=null, dailySalesRate=0", () => {
      const r = call("product-upsert", ctxA, { sku: "P5", name: "Fresh", price: 1, stock: 1 });
      assert.equal(r.ok, true);
      assert.equal(r.result.product.supplier, "");
      assert.equal(r.result.product.leadTimeDays, null);
      assert.equal(r.result.product.dailySalesRate, 0);
    });

    it("rejects a negative leadTimeDays", () => {
      const r = call("product-upsert", ctxA, { sku: "P6", name: "X", price: 1, stock: 1, leadTimeDays: -1 });
      assert.equal(r.ok, false);
      assert.match(r.error, /leadTimeDays/);
    });

    it("rejects a negative dailySalesRate", () => {
      const r = call("product-upsert", ctxA, { sku: "P7", name: "X", price: 1, stock: 1, dailySalesRate: -2 });
      assert.equal(r.ok, false);
      assert.match(r.error, /dailySalesRate/);
    });
  });

  describe("priceHistory — server-computed, never caller-supplied", () => {
    it("seeds one entry on create: oldPrice null, newPrice the initial price", () => {
      const r = call("product-upsert", ctxA, { sku: "H1", name: "X", price: 10, stock: 5 });
      assert.equal(r.result.product.priceHistory.length, 1);
      assert.equal(r.result.product.priceHistory[0].oldPrice, null);
      assert.equal(r.result.product.priceHistory[0].newPrice, 10);
    });

    it("appends an entry when price actually changes", () => {
      call("product-upsert", ctxA, { sku: "H2", name: "X", price: 10, stock: 5 });
      const r = call("product-upsert", ctxA, { sku: "H2", name: "X", price: 12, stock: 5 });
      assert.equal(r.result.product.priceHistory.length, 2);
      const last = r.result.product.priceHistory[1];
      assert.equal(last.oldPrice, 10);
      assert.equal(last.newPrice, 12);
      assert.ok(last.changedAt);
    });

    it("does NOT append when price is unchanged across multiple re-upserts", () => {
      call("product-upsert", ctxA, { sku: "H3", name: "X", price: 10, stock: 5 });
      call("product-upsert", ctxA, { sku: "H3", name: "X", price: 10, stock: 4 });
      const r = call("product-upsert", ctxA, { sku: "H3", name: "X", price: 10, stock: 3 });
      assert.equal(r.result.product.priceHistory.length, 1); // only the create-seed entry
    });

    it("a caller-supplied priceHistory param is ignored — it is never trusted", () => {
      const r = call("product-upsert", ctxA, {
        sku: "H4", name: "X", price: 10, stock: 5,
        priceHistory: [{ oldPrice: 1, newPrice: 999999, changedAt: "2000-01-01" }],
      });
      assert.equal(r.result.product.priceHistory.length, 1);
      assert.equal(r.result.product.priceHistory[0].newPrice, 10);
    });

    it("product-price-history returns the same trail for a real sku", () => {
      call("product-upsert", ctxA, { sku: "H5", name: "X", price: 10, stock: 5 });
      call("product-upsert", ctxA, { sku: "H5", name: "X", price: 15, stock: 5 });
      const r = call("product-price-history", ctxA, { sku: "H5" });
      assert.equal(r.ok, true);
      assert.equal(r.result.priceHistory.length, 2);
      assert.equal(r.result.priceHistory[1].newPrice, 15);
    });

    it("product-price-history rejects an unknown sku", () => {
      const r = call("product-price-history", ctxA, { sku: "BOGUS" });
      assert.equal(r.ok, false);
    });

    it("product-price-history is scoped per-user", () => {
      call("product-upsert", ctxA, { sku: "H6", name: "X", price: 10, stock: 5 });
      const r = call("product-price-history", ctxB, { sku: "H6" });
      assert.equal(r.ok, false);
    });
  });

  describe("turnoverRate — annual units sold ÷ average units on hand", () => {
    it("computes exactly: dailySalesRate=2, stock=10 → (2*365)/10 = 73", () => {
      const r = call("product-upsert", ctxA, { sku: "T1", name: "X", price: 5, stock: 10, dailySalesRate: 2 });
      assert.equal(r.result.product.turnoverRate, 73);
    });

    it("computes exactly with a fractional result: dailySalesRate=1, stock=7 → 365/7 = 52.14 (rounded to 2dp)", () => {
      const r = call("product-upsert", ctxA, { sku: "T2", name: "X", price: 5, stock: 7, dailySalesRate: 1 });
      assert.equal(r.result.product.turnoverRate, 52.14);
    });

    it("is 0 (not null) when dailySalesRate is 0 but stock > 0", () => {
      const r = call("product-upsert", ctxA, { sku: "T3", name: "X", price: 5, stock: 10, dailySalesRate: 0 });
      assert.equal(r.result.product.turnoverRate, 0);
    });

    it("is honestly null (never Infinity/NaN) when stock is 0", () => {
      const r = call("product-upsert", ctxA, { sku: "T4", name: "X", price: 5, stock: 0, dailySalesRate: 4 });
      assert.equal(r.result.product.turnoverRate, null);
    });

    it("recomputes on every upsert as stock/dailySalesRate change", () => {
      call("product-upsert", ctxA, { sku: "T5", name: "X", price: 5, stock: 10, dailySalesRate: 2 });
      const r = call("product-upsert", ctxA, { sku: "T5", name: "X", price: 5, stock: 20 });
      assert.equal(r.result.product.turnoverRate, 36.5); // dailySalesRate preserved at 2, stock now 20
    });
  });

  describe("abcClass — whole-catalog ranking via product-list", () => {
    it("a single revenue-driving product classifies as A, not C (the boundary-overshoot trap)", () => {
      call("product-upsert", ctxA, { sku: "ONE", name: "Only Item", price: 100, stock: 10, dailySalesRate: 5 });
      const list = call("product-list", ctxA);
      const p = list.result.products.find((x) => x.sku === "ONE");
      assert.equal(p.abcClass, "A");
    });

    it("known catalog: revenue shares 50/20/15/10/5 → A/A/A/B/C", () => {
      // price*dailySalesRate: 500,200,150,100,50 respectively (total=1000, shares 50/20/15/10/5%)
      call("product-upsert", ctxA, { sku: "R50", name: "R50", price: 100, stock: 100, dailySalesRate: 5 });
      call("product-upsert", ctxA, { sku: "R20", name: "R20", price: 100, stock: 100, dailySalesRate: 2 });
      call("product-upsert", ctxA, { sku: "R15", name: "R15", price: 100, stock: 100, dailySalesRate: 1.5 });
      call("product-upsert", ctxA, { sku: "R10", name: "R10", price: 100, stock: 100, dailySalesRate: 1 });
      call("product-upsert", ctxA, { sku: "R05", name: "R05", price: 100, stock: 100, dailySalesRate: 0.5 });
      const list = call("product-list", ctxA);
      const byS = Object.fromEntries(list.result.products.map((p) => [p.sku, p.abcClass]));
      // cumulative-before: R50:0% -> A; R20:50% -> A; R15:70% -> A; R10:85% -> B; R05:95% -> C
      assert.equal(byS.R50, "A");
      assert.equal(byS.R20, "A");
      assert.equal(byS.R15, "A");
      assert.equal(byS.R10, "B");
      assert.equal(byS.R05, "C");
      assert.deepEqual(list.result.abcSummary, { A: 3, B: 1, C: 1, unclassified: 0 });
    });

    it("honest null (not fabricated C) when the whole catalog has zero modeled revenue", () => {
      call("product-upsert", ctxA, { sku: "Z1", name: "X", price: 10, stock: 10 }); // dailySalesRate default 0
      call("product-upsert", ctxA, { sku: "Z2", name: "Y", price: 20, stock: 5 });
      const list = call("product-list", ctxA);
      assert.ok(list.result.products.every((p) => p.abcClass === null));
      assert.deepEqual(list.result.abcSummary, { A: 0, B: 0, C: 0, unclassified: 2 });
    });

    it("classification is per-catalog (per-user), never cross-tenant", () => {
      call("product-upsert", ctxA, { sku: "SAME", name: "X", price: 100, stock: 10, dailySalesRate: 10 });
      call("product-upsert", ctxB, { sku: "SAME", name: "X", price: 1, stock: 10, dailySalesRate: 0.01 });
      const a = call("product-list", ctxA).result.products.find((p) => p.sku === "SAME");
      const b = call("product-list", ctxB).result.products.find((p) => p.sku === "SAME");
      assert.equal(a.abcClass, "A"); // only product in its own catalog
      assert.equal(b.abcClass, "A"); // also only product in its own catalog
    });

    it("empty catalog returns an empty abcSummary, never throws", () => {
      const list = call("product-list", ctxA);
      assert.equal(list.ok, true);
      assert.deepEqual(list.result.products, []);
      assert.deepEqual(list.result.abcSummary, { A: 0, B: 0, C: 0, unclassified: 0 });
    });
  });

  describe("product-variant-* — real sub-SKU family", () => {
    beforeEach(() => {
      call("product-upsert", ctxA, { sku: "SHIRT", name: "T-Shirt", price: 20, stock: 100 });
    });

    it("requires a real parentSku", () => {
      const r = call("product-variant-upsert", ctxA, { sku: "SHIRT-RED-M", parentSku: "BOGUS", size: "M", color: "Red", stock: 10 });
      assert.equal(r.ok, false);
      assert.match(r.error, /parent product not found/);
    });

    it("requires at least one of size/color/style on create", () => {
      const r = call("product-variant-upsert", ctxA, { sku: "SHIRT-X", parentSku: "SHIRT", stock: 5 });
      assert.equal(r.ok, false);
      assert.match(r.error, /size\/color\/style/);
    });

    it("rejects a variant sku colliding with an existing product sku", () => {
      const r = call("product-variant-upsert", ctxA, { sku: "SHIRT", parentSku: "SHIRT", size: "M", stock: 1 });
      assert.equal(r.ok, false);
      assert.match(r.error, /collides/);
    });

    it("creates a variant with computed price = parent price + priceDelta", () => {
      const r = call("product-variant-upsert", ctxA, {
        sku: "SHIRT-RED-M", parentSku: "SHIRT", size: "M", color: "Red", stock: 15, priceDelta: 5,
      });
      assert.equal(r.ok, true);
      assert.equal(r.result.variant.price, 25);
      assert.equal(r.result.variant.stock, 15);
    });

    it("rejects a priceDelta that would make the variant price negative", () => {
      const r = call("product-variant-upsert", ctxA, {
        sku: "SHIRT-X2", parentSku: "SHIRT", size: "XL", stock: 1, priceDelta: -100,
      });
      assert.equal(r.ok, false);
      assert.match(r.error, /negative/);
    });

    it("partial update: touching only stock does not wipe size/color/priceDelta", () => {
      call("product-variant-upsert", ctxA, {
        sku: "SHIRT-BLU-L", parentSku: "SHIRT", size: "L", color: "Blue", stock: 8, priceDelta: 2,
      });
      const r = call("product-variant-upsert", ctxA, { sku: "SHIRT-BLU-L", stock: 3 });
      assert.equal(r.ok, true);
      assert.equal(r.result.variant.stock, 3);
      assert.equal(r.result.variant.size, "L");
      assert.equal(r.result.variant.color, "Blue");
      assert.equal(r.result.variant.priceDelta, 2);
      assert.equal(r.result.variant.price, 22);
    });

    it("product-variant-list filters by parentSku", () => {
      call("product-upsert", ctxA, { sku: "HAT", name: "Cap", price: 12, stock: 30 });
      call("product-variant-upsert", ctxA, { sku: "SHIRT-M", parentSku: "SHIRT", size: "M", stock: 5 });
      call("product-variant-upsert", ctxA, { sku: "HAT-BLK", parentSku: "HAT", color: "Black", stock: 5 });
      const shirtVariants = call("product-variant-list", ctxA, { parentSku: "SHIRT" }).result.variants;
      assert.equal(shirtVariants.length, 1);
      assert.equal(shirtVariants[0].sku, "SHIRT-M");
      const all = call("product-variant-list", ctxA, {}).result.variants;
      assert.equal(all.length, 2);
    });

    it("product-variant-delete removes it", () => {
      call("product-variant-upsert", ctxA, { sku: "SHIRT-S", parentSku: "SHIRT", size: "S", stock: 5 });
      const del = call("product-variant-delete", ctxA, { sku: "SHIRT-S" });
      assert.equal(del.ok, true);
      assert.equal(call("product-variant-list", ctxA, {}).result.variants.length, 0);
    });

    it("product-variant-delete rejects an unknown sku", () => {
      const r = call("product-variant-delete", ctxA, { sku: "NOPE" });
      assert.equal(r.ok, false);
    });

    it("variants are scoped per-user", () => {
      call("product-upsert", ctxB, { sku: "SHIRT", name: "T-Shirt", price: 20, stock: 100 });
      call("product-variant-upsert", ctxA, { sku: "SHIRT-M", parentSku: "SHIRT", size: "M", stock: 5 });
      const bList = call("product-variant-list", ctxB, {}).result.variants;
      assert.equal(bList.length, 0);
    });

    it("CASCADE: deleting the parent product removes its variants", () => {
      call("product-variant-upsert", ctxA, { sku: "SHIRT-M2", parentSku: "SHIRT", size: "M", stock: 5 });
      call("product-variant-upsert", ctxA, { sku: "SHIRT-L2", parentSku: "SHIRT", size: "L", stock: 5 });
      call("product-delete", ctxA, { sku: "SHIRT" });
      const remaining = call("product-variant-list", ctxA, {}).result.variants;
      assert.equal(remaining.length, 0);
    });

    it("degrade-graceful when STATE is unavailable", () => {
      const priorSTATE = globalThis._concordSTATE;
      globalThis._concordSTATE = undefined;
      try {
        for (const name of ["product-variant-upsert", "product-variant-list", "product-variant-delete", "product-price-history"]) {
          const r = call(name, ctxA, { sku: "X", parentSku: "X" });
          assert.equal(r.ok, false);
        }
      } finally {
        globalThis._concordSTATE = priorSTATE;
      }
    });
  });
});
