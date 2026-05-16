import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerManufacturingActions from "../domains/manufacturing.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`manufacturing.${name}`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}
before(() => { registerManufacturingActions(register); });
beforeEach(() => { globalThis._concordSTATE = { dtus: new Map() }; globalThis._concordSaveStateDebounced = () => {}; });
const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

describe("manufacturing parity macros", () => {
  it("oee-status returns 10 machines with availability+perf+qual+oee", () => {
    const r = call("oee-status", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.machines.length, 10);
    for (const m of r.result.machines) {
      assert.ok(m.availability >= 0 && m.availability <= 100);
      assert.ok(m.oee >= 0 && m.oee <= 100);
    }
  });

  it("work-orders returns 18 orders across status/priority/product mix", () => {
    const r = call("work-orders", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.orders.length, 18);
    const statuses = new Set(r.result.orders.map(o => o.status));
    assert.ok(statuses.size >= 3);
  });

  it("spc-chart returns Cpk + PPM + sample series", () => {
    const r = call("spc-chart", ctxA, { product: "Widget-001" });
    assert.equal(r.ok, true);
    assert.equal(r.result.samples.length, 50);
    assert.ok(typeof r.result.cpk === "number");
    assert.ok(r.result.ppm >= 0);
    assert.ok(r.result.upperSpec > r.result.lowerSpec);
  });

  it("regression: pre-existing macros register", () => {
    assert.ok(ACTIONS.size >= 6);
  });
});
