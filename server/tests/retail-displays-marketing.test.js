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

// Helper: creates a real product + a real completed order (via the actual
// cart-open/cart-add-line/cart-tender flow, exactly the way a real sale
// happens) so conversion tests can attribute to a genuine order, never a
// fabricated one.
function makeRealOrder(ctx, { sku = "SKU-1", price = 25 } = {}) {
  call("product-upsert", ctx, { sku, name: "Widget", price, stock: 100 });
  const cart = call("cart-open", ctx).result.cart;
  call("cart-add-line", ctx, { cartId: cart.id, sku, qty: 2 });
  const r = call("cart-tender", ctx, { cartId: cart.id, tenders: [{ kind: "cash", amount: 1000 }] });
  assert.equal(r.ok, true, "test setup: cart-tender must succeed");
  return r.result.order; // total = price * 2
}

describe("retail — in-store marketing displays (displays-*)", () => {
  describe("displays-upsert: create", () => {
    it("requires a location", () => {
      const r = call("displays-upsert", ctxA, { displayType: "endcap" });
      assert.equal(r.ok, false);
      assert.match(r.error, /location/);
    });

    it("requires a valid displayType", () => {
      const r = call("displays-upsert", ctxA, { location: "front endcap, aisle 3" });
      assert.equal(r.ok, false);
      assert.match(r.error, /displayType/);
    });

    it("rejects an unknown displayType", () => {
      const r = call("displays-upsert", ctxA, { location: "window", displayType: "billboard" });
      assert.equal(r.ok, false);
      assert.match(r.error, /unknown displayType/);
    });

    it("accepts every real displayType enum value", () => {
      const types = ["endcap", "window", "checkout-counter", "floor-display", "shelf-talker", "promotional-table"];
      for (const displayType of types) {
        const r = call("displays-upsert", ctxA, { location: `loc for ${displayType}`, displayType });
        assert.equal(r.ok, true, `${displayType} should be accepted`);
        assert.equal(r.result.display.displayType, displayType);
      }
    });

    it("rejects a negative budget", () => {
      const r = call("displays-upsert", ctxA, { location: "aisle 3", displayType: "endcap", budget: -5 });
      assert.equal(r.ok, false);
      assert.match(r.error, /budget/);
    });

    it("rejects a non-finite budget", () => {
      const r = call("displays-upsert", ctxA, { location: "aisle 3", displayType: "endcap", budget: "abc" });
      assert.equal(r.ok, false);
      assert.match(r.error, /budget/);
    });

    it("defaults: status=planned, budget=0, empty impressions/conversions, auditable statusHistory seed", () => {
      const r = call("displays-upsert", ctxA, { location: "front window", displayType: "window" });
      assert.equal(r.ok, true);
      const d = r.result.display;
      assert.equal(d.status, "planned");
      assert.equal(d.budget, 0);
      assert.equal(d.impressions, 0);
      assert.equal(d.conversions, 0);
      assert.deepEqual(d.impressionLog, []);
      assert.deepEqual(d.attributedOrderIds, []);
      assert.equal(d.attributedRevenue, 0);
      assert.equal(d.removedAt, null);
      assert.equal(d.statusHistory.length, 1);
      assert.equal(d.statusHistory[0].to, "planned");
      assert.equal(d.statusHistory[0].from, null);
    });

    it("honors explicit budget/startDate/endDate/notes at create", () => {
      const r = call("displays-upsert", ctxA, {
        location: "checkout lane 2", displayType: "checkout-counter",
        budget: 450.5, startDate: "2026-08-01", endDate: "2026-08-31", notes: "Summer promo",
      });
      assert.equal(r.ok, true);
      assert.equal(r.result.display.budget, 450.5);
      assert.equal(r.result.display.startDate, "2026-08-01");
      assert.equal(r.result.display.endDate, "2026-08-31");
      assert.equal(r.result.display.notes, "Summer promo");
    });

    it("rejects an invalid startDate/endDate", () => {
      assert.equal(call("displays-upsert", ctxA, { location: "x", displayType: "endcap", startDate: "not-a-date" }).ok, false);
      assert.equal(call("displays-upsert", ctxA, { location: "x", displayType: "endcap", endDate: "not-a-date" }).ok, false);
    });

    it("rejects endDate before startDate", () => {
      const r = call("displays-upsert", ctxA, {
        location: "x", displayType: "endcap", startDate: "2026-08-31", endDate: "2026-08-01",
      });
      assert.equal(r.ok, false);
      assert.match(r.error, /endDate/);
    });

    it("productSkus must reference real catalog SKUs — rejects an unknown SKU", () => {
      const r = call("displays-upsert", ctxA, { location: "aisle 3", displayType: "endcap", productSkus: ["DOES-NOT-EXIST"] });
      assert.equal(r.ok, false);
      assert.match(r.error, /unknown productSku/);
    });

    it("productSkus succeeds and dedupes when every SKU exists in the caller's real catalog", () => {
      call("product-upsert", ctxA, { sku: "SKU-A", name: "A", price: 10, stock: 5 });
      const r = call("displays-upsert", ctxA, { location: "aisle 3", displayType: "endcap", productSkus: ["SKU-A", "SKU-A"] });
      assert.equal(r.ok, true);
      assert.deepEqual(r.result.display.productSkus, ["SKU-A"]);
    });

    it("productSkus must be an array", () => {
      const r = call("displays-upsert", ctxA, { location: "x", displayType: "endcap", productSkus: "SKU-A" });
      assert.equal(r.ok, false);
    });
  });

  describe("displays-upsert: update", () => {
    it("updates non-status fields in place without touching statusHistory", () => {
      const created = call("displays-upsert", ctxA, { location: "orig", displayType: "endcap" }).result.display;
      const r = call("displays-upsert", ctxA, { id: created.id, location: "renamed spot", notes: "moved closer to entrance" });
      assert.equal(r.ok, true);
      assert.equal(r.result.display.location, "renamed spot");
      assert.equal(r.result.display.notes, "moved closer to entrance");
      assert.equal(r.result.display.statusHistory.length, 1);
    });

    it("rejects a status change through displays-upsert — must go through displays-status-move", () => {
      const created = call("displays-upsert", ctxA, { location: "x", displayType: "endcap" }).result.display;
      const r = call("displays-upsert", ctxA, { id: created.id, status: "active" });
      assert.equal(r.ok, false);
      assert.match(r.error, /displays-status-move/);
      assert.equal(call("displays-list", ctxA).result.displays[0].status, "planned");
    });

    it("404s on an unknown id", () => {
      const r = call("displays-upsert", ctxA, { id: "disp_missing", location: "x" });
      assert.equal(r.ok, false);
    });

    it("rejects clearing location to blank", () => {
      const created = call("displays-upsert", ctxA, { location: "x", displayType: "endcap" }).result.display;
      const r = call("displays-upsert", ctxA, { id: created.id, location: "   " });
      assert.equal(r.ok, false);
    });

    it("re-validates endDate-before-startDate using the merged (existing + incoming) values", () => {
      const created = call("displays-upsert", ctxA, { location: "x", displayType: "endcap", startDate: "2026-08-01", endDate: "2026-08-31" }).result.display;
      const r = call("displays-upsert", ctxA, { id: created.id, startDate: "2026-09-01" }); // now after existing endDate
      assert.equal(r.ok, false);
      assert.match(r.error, /endDate/);
    });
  });

  describe("displays-status-move", () => {
    it("moves planned -> active and appends an auditable statusHistory entry", () => {
      const created = call("displays-upsert", ctxA, { location: "x", displayType: "endcap" }).result.display;
      const r = call("displays-status-move", ctxA, { id: created.id, status: "active", note: "installed today" });
      assert.equal(r.ok, true);
      assert.equal(r.result.display.status, "active");
      assert.equal(r.result.display.statusHistory.length, 2);
      assert.equal(r.result.display.statusHistory[1].from, "planned");
      assert.equal(r.result.display.statusHistory[1].to, "active");
      assert.equal(r.result.display.statusHistory[1].note, "installed today");
    });

    it("rejects moving to the same status", () => {
      const created = call("displays-upsert", ctxA, { location: "x", displayType: "endcap" }).result.display;
      const r = call("displays-status-move", ctxA, { id: created.id, status: "planned" });
      assert.equal(r.ok, false);
    });

    it("rejects an unknown status or an unknown display id", () => {
      const created = call("displays-upsert", ctxA, { location: "x", displayType: "endcap" }).result.display;
      assert.equal(call("displays-status-move", ctxA, { id: created.id, status: "torn-down" }).ok, false);
      assert.equal(call("displays-status-move", ctxA, { id: "disp_missing", status: "active" }).ok, false);
    });

    it("moving to removed stamps removedAt", () => {
      const created = call("displays-upsert", ctxA, { location: "x", displayType: "endcap" }).result.display;
      const r = call("displays-status-move", ctxA, { id: created.id, status: "removed" });
      assert.equal(r.ok, true);
      assert.ok(r.result.display.removedAt);
    });

    it("a removed display cannot move without reopen:true", () => {
      const created = call("displays-upsert", ctxA, { location: "x", displayType: "endcap" }).result.display;
      call("displays-status-move", ctxA, { id: created.id, status: "removed" });
      const r = call("displays-status-move", ctxA, { id: created.id, status: "planned" });
      assert.equal(r.ok, false);
      assert.match(r.error, /reopen/);
    });

    it("reopen:true moves a removed display back into an OPEN status, clears removedAt, and marks the entry reopened", () => {
      const created = call("displays-upsert", ctxA, { location: "x", displayType: "endcap" }).result.display;
      call("displays-status-move", ctxA, { id: created.id, status: "removed" });
      const r = call("displays-status-move", ctxA, { id: created.id, status: "active", reopen: true });
      assert.equal(r.ok, true);
      assert.equal(r.result.display.status, "active");
      assert.equal(r.result.display.removedAt, null);
      assert.equal(r.result.display.statusHistory.at(-1).reopened, true);
    });
  });

  describe("displays-log-impressions", () => {
    it("requires a positive integer count", () => {
      const created = call("displays-upsert", ctxA, { location: "x", displayType: "endcap" }).result.display;
      assert.equal(call("displays-log-impressions", ctxA, { id: created.id, count: 0 }).ok, false);
      assert.equal(call("displays-log-impressions", ctxA, { id: created.id, count: -3 }).ok, false);
      assert.equal(call("displays-log-impressions", ctxA, { id: created.id, count: 12.5 }).ok, false);
    });

    it("ACCUMULATES across multiple logs rather than overwriting — a display gets checked multiple times over its run", () => {
      const created = call("displays-upsert", ctxA, { location: "x", displayType: "endcap" }).result.display;
      call("displays-log-impressions", ctxA, { id: created.id, count: 40, note: "morning walk-by count" });
      const r = call("displays-log-impressions", ctxA, { id: created.id, count: 25, note: "afternoon count" });
      assert.equal(r.ok, true);
      assert.equal(r.result.display.impressions, 65);
      assert.equal(r.result.display.impressionLog.length, 2);
      assert.equal(r.result.display.impressionLog[0].count, 40);
      assert.equal(r.result.display.impressionLog[0].note, "morning walk-by count");
      assert.equal(r.result.display.impressionLog[1].count, 25);
    });

    it("404s on an unknown display id", () => {
      assert.equal(call("displays-log-impressions", ctxA, { id: "disp_missing", count: 5 }).ok, false);
    });
  });

  describe("displays-record-conversion: honesty gate — requires a REAL order", () => {
    it("rejects a completely fake/nonexistent orderId", () => {
      const created = call("displays-upsert", ctxA, { location: "x", displayType: "endcap" }).result.display;
      const r = call("displays-record-conversion", ctxA, { id: created.id, orderId: "ord_totally_made_up_12345" });
      assert.equal(r.ok, false);
      assert.match(r.error, /order not found/);
      // Nothing was mutated on the rejection.
      const after = call("displays-list", ctxA).result.displays[0];
      assert.equal(after.conversions, 0);
      assert.equal(after.attributedRevenue, 0);
      assert.deepEqual(after.attributedOrderIds, []);
    });

    it("requires an orderId at all", () => {
      const created = call("displays-upsert", ctxA, { location: "x", displayType: "endcap" }).result.display;
      const r = call("displays-record-conversion", ctxA, { id: created.id });
      assert.equal(r.ok, false);
      assert.match(r.error, /orderId/);
    });

    it("accepts a REAL order (completed via cart-open/add-line/tender) and attributes its exact total", () => {
      const order = makeRealOrder(ctxA, { sku: "SKU-1", price: 25 }); // total = 50
      const created = call("displays-upsert", ctxA, { location: "x", displayType: "endcap" }).result.display;
      const r = call("displays-record-conversion", ctxA, { id: created.id, orderId: order.id });
      assert.equal(r.ok, true);
      assert.equal(r.result.display.conversions, 1);
      assert.equal(r.result.display.attributedRevenue, order.total);
      assert.deepEqual(r.result.display.attributedOrderIds, [order.id]);
    });

    it("prevents double-attribution of the same order to the same display", () => {
      const order = makeRealOrder(ctxA);
      const created = call("displays-upsert", ctxA, { location: "x", displayType: "endcap" }).result.display;
      call("displays-record-conversion", ctxA, { id: created.id, orderId: order.id });
      const r = call("displays-record-conversion", ctxA, { id: created.id, orderId: order.id });
      assert.equal(r.ok, false);
      assert.match(r.error, /already attributed/);
      // conversions must still be exactly 1, not double-counted.
      assert.equal(call("displays-list", ctxA).result.displays[0].conversions, 1);
    });

    it("the SAME real order CAN be attributed to two DIFFERENT displays (no cross-display collision)", () => {
      const order = makeRealOrder(ctxA);
      const d1 = call("displays-upsert", ctxA, { location: "endcap A", displayType: "endcap" }).result.display;
      const d2 = call("displays-upsert", ctxA, { location: "window B", displayType: "window" }).result.display;
      assert.equal(call("displays-record-conversion", ctxA, { id: d1.id, orderId: order.id }).ok, true);
      assert.equal(call("displays-record-conversion", ctxA, { id: d2.id, orderId: order.id }).ok, true);
    });

    it("404s on an unknown display id even with a real order", () => {
      const order = makeRealOrder(ctxA);
      const r = call("displays-record-conversion", ctxA, { id: "disp_missing", orderId: order.id });
      assert.equal(r.ok, false);
      assert.match(r.error, /display not found/);
    });

    it("an order that exists for a DIFFERENT user is rejected (no cross-user order attribution)", () => {
      const order = makeRealOrder(ctxB);
      const created = call("displays-upsert", ctxA, { location: "x", displayType: "endcap" }).result.display;
      const r = call("displays-record-conversion", ctxA, { id: created.id, orderId: order.id });
      assert.equal(r.ok, false);
      assert.match(r.error, /order not found/);
    });
  });

  describe("displays-list: rollups", () => {
    it("computes conversionRate = conversions/impressions, guarding division by zero", () => {
      const created = call("displays-upsert", ctxA, { location: "x", displayType: "endcap" }).result.display;
      // No impressions logged yet — conversionRate must be 0, never NaN/Infinity.
      let d = call("displays-list", ctxA).result.displays[0];
      assert.equal(d.conversionRate, 0);

      call("displays-log-impressions", ctxA, { id: created.id, count: 200 });
      const order = makeRealOrder(ctxA);
      call("displays-record-conversion", ctxA, { id: created.id, orderId: order.id });
      d = call("displays-list", ctxA).result.displays[0];
      assert.equal(d.impressions, 200);
      assert.equal(d.conversions, 1);
      assert.equal(d.conversionRate, 0.5); // 1/200 * 100
    });

    it("revenuePerBudgetDollar is null when budget is 0 — never Infinity/NaN", () => {
      const created = call("displays-upsert", ctxA, { location: "x", displayType: "endcap", budget: 0 }).result.display;
      const order = makeRealOrder(ctxA);
      call("displays-record-conversion", ctxA, { id: created.id, orderId: order.id });
      const d = call("displays-list", ctxA).result.displays[0];
      assert.equal(d.revenuePerBudgetDollar, null);
      assert.equal(call("displays-list", ctxA).result.rollup.revenuePerBudgetDollar, null);
    });

    it("revenuePerBudgetDollar computes correctly when budget > 0", () => {
      const created = call("displays-upsert", ctxA, { location: "x", displayType: "endcap", budget: 100 }).result.display;
      const order = makeRealOrder(ctxA, { sku: "SKU-1", price: 25 }); // total = 50
      call("displays-record-conversion", ctxA, { id: created.id, orderId: order.id });
      const d = call("displays-list", ctxA).result.displays[0];
      assert.equal(d.attributedRevenue, 50);
      assert.equal(d.revenuePerBudgetDollar, 0.5); // 50/100
    });

    it("aggregate rollup sums impressions/conversions/revenue/budget across the FULL book and stays stable under the status filter", () => {
      const d1 = call("displays-upsert", ctxA, { location: "A", displayType: "endcap", budget: 100 }).result.display;
      const d2 = call("displays-upsert", ctxA, { location: "B", displayType: "window", budget: 50 }).result.display;
      call("displays-status-move", ctxA, { id: d2.id, status: "active" });
      call("displays-log-impressions", ctxA, { id: d1.id, count: 100 });
      call("displays-log-impressions", ctxA, { id: d2.id, count: 40 });
      const order = makeRealOrder(ctxA, { sku: "SKU-1", price: 25 }); // total = 50
      call("displays-record-conversion", ctxA, { id: d1.id, orderId: order.id });

      const full = call("displays-list", ctxA);
      assert.equal(full.result.rollup.totalDisplays, 2);
      assert.equal(full.result.rollup.plannedCount, 1);
      assert.equal(full.result.rollup.activeCount, 1);
      assert.equal(full.result.rollup.totalImpressions, 140);
      assert.equal(full.result.rollup.totalConversions, 1);
      assert.equal(full.result.rollup.totalBudget, 150);
      assert.equal(full.result.rollup.totalAttributedRevenue, 50);
      assert.equal(full.result.rollup.revenuePerBudgetDollar, Math.round((50 / 150) * 100) / 100);

      // Filtering by status narrows `displays` but NOT the rollup.
      const filtered = call("displays-list", ctxA, { status: "active" });
      assert.equal(filtered.result.displays.length, 1);
      assert.equal(filtered.result.displays[0].id, d2.id);
      assert.equal(filtered.result.rollup.totalDisplays, 2);
    });

    it("rejects an unknown status filter", () => {
      assert.equal(call("displays-list", ctxA, { status: "nope" }).ok, false);
    });
  });

  describe("displays-delete", () => {
    it("deletes and 404s a second time", () => {
      const created = call("displays-upsert", ctxA, { location: "x", displayType: "endcap" }).result.display;
      assert.equal(call("displays-delete", ctxA, { id: created.id }).ok, true);
      assert.equal(call("displays-delete", ctxA, { id: created.id }).ok, false);
      assert.equal(call("displays-list", ctxA).result.displays.length, 0);
    });
  });

  describe("INVARIANT: per-user isolation", () => {
    it("user B never sees user A's displays, and cannot move/log/convert/delete them", () => {
      const created = call("displays-upsert", ctxA, { location: "A-only", displayType: "endcap" }).result.display;
      assert.equal(call("displays-list", ctxB).result.displays.length, 0);
      assert.equal(call("displays-status-move", ctxB, { id: created.id, status: "active" }).ok, false);
      assert.equal(call("displays-log-impressions", ctxB, { id: created.id, count: 5 }).ok, false);
      assert.equal(call("displays-record-conversion", ctxB, { id: created.id, orderId: "whatever" }).ok, false);
      assert.equal(call("displays-delete", ctxB, { id: created.id }).ok, false);
      // Untouched from A's side.
      assert.equal(call("displays-list", ctxA).result.displays[0].status, "planned");
    });
  });

  describe("degrade-graceful when STATE is unavailable", () => {
    it("every displays-* macro fails soft with {ok:false}, never throws", () => {
      const saved = globalThis._concordSTATE;
      globalThis._concordSTATE = undefined;
      assert.equal(call("displays-list", ctxA).ok, false);
      assert.equal(call("displays-upsert", ctxA, { location: "x", displayType: "endcap" }).ok, false);
      assert.equal(call("displays-status-move", ctxA, { id: "x", status: "active" }).ok, false);
      assert.equal(call("displays-log-impressions", ctxA, { id: "x", count: 1 }).ok, false);
      assert.equal(call("displays-record-conversion", ctxA, { id: "x", orderId: "y" }).ok, false);
      assert.equal(call("displays-delete", ctxA, { id: "x" }).ok, false);
      globalThis._concordSTATE = saved;
    });
  });
});
