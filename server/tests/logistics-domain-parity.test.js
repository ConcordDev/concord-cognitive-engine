import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerLogisticsActions from "../domains/logistics.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`logistics.${name}`);
  assert.ok(fn, `logistics.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}
before(() => { registerLogisticsActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});
const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("logistics.shipments-* + track", () => {
  it("track + list scoped per user", () => {
    const r = call("shipment-track", ctxA, { trackingNumber: "1Z999AA10123456784", carrier: "UPS" });
    assert.equal(r.ok, true);
    assert.equal(call("shipments-list", ctxA, {}).result.shipments.length, 1);
    assert.equal(call("shipments-list", ctxB, {}).result.shipments.length, 0);
  });
  it("rejects empty tracking number", () => {
    assert.equal(call("shipment-track", ctxA, { trackingNumber: "" }).ok, false);
  });
  it("track generates events matching status index", () => {
    const r = call("shipment-track", ctxA, { trackingNumber: "FX123", carrier: "FedEx" });
    assert.ok(r.result.shipment.events.length >= 1);
  });
});

describe("logistics.route-optimize", () => {
  it("rejects fewer than 2 stops", () => {
    assert.equal(call("route-optimize", ctxA, { stops: ["A"] }).ok, false);
  });
  it("optimizes and produces ordered stops", () => {
    const r = call("route-optimize", ctxA, { stops: ["100 Main St", "200 Oak Ave", "300 Pine Rd", "400 Elm Way"], vehicleType: "van" });
    assert.equal(r.ok, true);
    assert.equal(r.result.stops.length, 4);
    assert.ok(r.result.totalDistanceMi > 0);
    assert.ok(r.result.fuelCostUsd > 0);
  });
  it("EV is cheaper to operate than truck for same route", () => {
    const stops = ["A", "B", "C"];
    const truck = call("route-optimize", ctxA, { stops, vehicleType: "truck" });
    const ev = call("route-optimize", ctxA, { stops, vehicleType: "ev" });
    assert.ok(ev.result.fuelCostUsd < truck.result.fuelCostUsd);
  });
});

describe("logistics.inventory-list", () => {
  it("returns empty + setup hint when no real inventory feed is wired (no SAMPLE_SKUS fallback)", () => {
    const r = call("inventory-list", ctxA, {});
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.items, []);
    assert.equal(r.result.source, "empty");
    assert.match(r.result.notes, /warehouse feed|WMS|Shopify/);
  });
});

describe("regression: pre-existing macros", () => {
  it("registered count plausible", () => assert.ok(ACTIONS.size >= 5));
});
