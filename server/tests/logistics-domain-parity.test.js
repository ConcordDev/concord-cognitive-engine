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

describe("logistics.shipments-* + track (real carrier API)", () => {
  it("returns error pointing to SHIPENGINE_API_KEY / EASYPOST_API_KEY when no broker wired", async () => {
    delete process.env.SHIPENGINE_API_KEY;
    delete process.env.EASYPOST_API_KEY;
    const r = await call("shipment-track", ctxA, { trackingNumber: "1Z999AA10123456784", carrier: "UPS" });
    assert.equal(r.ok, false);
    assert.match(r.error, /SHIPENGINE_API_KEY|EASYPOST_API_KEY/);
  });
  it("rejects empty tracking number", async () => {
    assert.equal((await call("shipment-track", ctxA, { trackingNumber: "" })).ok, false);
  });
  it("parses ShipEngine response when key set + fetch mocked", async () => {
    process.env.SHIPENGINE_API_KEY = "test-key";
    globalThis.fetch = async (url) => {
      assert.match(url, /shipengine\.com\/v1\/tracking/);
      return {
        ok: true,
        json: async () => ({
          status_code: "in_transit", estimated_delivery_date: "2026-05-20",
          events: [{ occurred_at: "2026-05-16T09:00:00Z", city_locality: "Los Angeles", state_province: "CA", country_code: "US", description: "Picked up by carrier" }],
        }),
      };
    };
    const r = await call("shipment-track", ctxA, { trackingNumber: "1Z999", carrier: "UPS" });
    assert.equal(r.ok, true);
    assert.equal(r.result.shipment.source, "shipengine");
    assert.equal(r.result.shipment.status, "in_transit");
    delete process.env.SHIPENGINE_API_KEY;
  });
});

describe("logistics.route-optimize (real OSRM routing)", () => {
  it("rejects fewer than 2 stops", async () => {
    assert.equal((await call("route-optimize", ctxA, { stops: ["A"] })).ok, false);
  });
  it("rejects when coords not supplied and Nominatim unreachable", async () => {
    const r = await call("route-optimize", ctxA, { stops: ["100 Main St", "200 Oak Ave"], vehicleType: "van" });
    assert.equal(r.ok, false);
    assert.match(r.error, /geocoding unreachable|nominatim/);
  });
  it("optimizes with caller-supplied coords + mocked OSRM matrix", async () => {
    globalThis.fetch = async (url) => {
      assert.match(url, /router\.project-osrm\.org\/table/);
      return {
        ok: true,
        json: async () => ({
          distances: [[0, 16093, 32186, 48279], [16093, 0, 16093, 32186], [32186, 16093, 0, 16093], [48279, 32186, 16093, 0]],
        }),
      };
    };
    const r = await call("route-optimize", ctxA, {
      stops: ["A", "B", "C", "D"],
      coords: [{ lat: 37.7, lng: -122.4 }, { lat: 37.71, lng: -122.41 }, { lat: 37.72, lng: -122.42 }, { lat: 37.73, lng: -122.43 }],
      vehicleType: "van",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.stops.length, 4);
    assert.ok(r.result.totalDistanceMi > 0);
    assert.ok(r.result.fuelCostUsd > 0);
  });
  it("EV is cheaper to operate than truck on the same OSRM matrix", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ distances: [[0, 16093, 32186], [16093, 0, 16093], [32186, 16093, 0]] }),
    });
    const stops = ["A", "B", "C"];
    const coords = [{ lat: 37.7, lng: -122.4 }, { lat: 37.71, lng: -122.41 }, { lat: 37.72, lng: -122.42 }];
    const truck = await call("route-optimize", ctxA, { stops, coords, vehicleType: "truck" });
    const ev = await call("route-optimize", ctxA, { stops, coords, vehicleType: "ev" });
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
