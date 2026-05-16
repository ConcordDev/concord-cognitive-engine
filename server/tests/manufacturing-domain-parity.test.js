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

describe("manufacturing parity macros (real MES/SCADA feeds only)", () => {
  it("oee-status returns empty + setup hint when no feed wired", () => {
    const r = call("oee-status", ctxA, {});
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.machines, []);
    assert.equal(r.result.source, "empty");
    assert.match(r.result.notes, /MES|SCADA|OPC-UA|MQTT|MTConnect/);
  });

  it("oee-status returns real machines when state is populated", () => {
    const STATE = globalThis._concordSTATE;
    STATE.manufacturingLens = {
      machines: new Map([["user_a", [
        { id: "mac_0", name: "CNC-01", status: "running", availability: 92, performance: 85, quality: 99, oee: 77 },
      ]]]),
      workOrders: new Map(),
      spcSamples: new Map(),
    };
    const r = call("oee-status", ctxA, {});
    assert.equal(r.result.machines.length, 1);
    assert.equal(r.result.source, "wired-feed");
  });

  it("work-orders returns empty + setup hint when no ERP wired", () => {
    const r = call("work-orders", ctxA, {});
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.orders, []);
    assert.equal(r.result.source, "empty");
    assert.match(r.result.notes, /ERP|Tulip|Plex|NetSuite/);
  });

  it("spc-chart returns empty + setup hint when no QA gauge feed wired", () => {
    const r = call("spc-chart", ctxA, { product: "Widget-001" });
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.samples, []);
    assert.equal(r.result.source, "empty");
    assert.match(r.result.notes, /QA gauge|spc-sample-log/);
  });

  it("spc-chart computes Cpk + PPM from real logged samples", () => {
    const STATE = globalThis._concordSTATE;
    STATE.manufacturingLens = {
      machines: new Map(),
      workOrders: new Map(),
      spcSamples: new Map([[`user_a::Widget-001`, [
        { at: new Date(Date.now() - 4 * 60000).toISOString(), value: 25.01, upperSpec: 25.1, lowerSpec: 24.9 },
        { at: new Date(Date.now() - 3 * 60000).toISOString(), value: 25.03, upperSpec: 25.1, lowerSpec: 24.9 },
        { at: new Date(Date.now() - 2 * 60000).toISOString(), value: 24.98, upperSpec: 25.1, lowerSpec: 24.9 },
        { at: new Date(Date.now() - 1 * 60000).toISOString(), value: 25.02, upperSpec: 25.1, lowerSpec: 24.9 },
        { at: new Date(Date.now()).toISOString(), value: 25.00, upperSpec: 25.1, lowerSpec: 24.9 },
      ]]]),
    };
    const r = call("spc-chart", ctxA, { product: "Widget-001" });
    assert.equal(r.result.samples.length, 5);
    assert.ok(typeof r.result.cpk === "number");
    assert.equal(r.result.source, "wired-feed");
    assert.ok(r.result.upperSpec > r.result.lowerSpec);
  });

  it("spc-chart rejects empty product", () => {
    assert.equal(call("spc-chart", ctxA, { product: "" }).ok, false);
  });

  it("regression: pre-existing macros register", () => {
    assert.ok(ACTIONS.size >= 6);
  });
});
