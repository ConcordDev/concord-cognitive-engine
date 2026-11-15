// FIX-energy-001 — submitted wattage samples integrate into kWh.
//
// A live sample is an instantaneous wattage reading. Before this fix the
// samples fed only the Now/Peak/Avg tiles: nothing integrated them, so
// the live chart's data had no energy figure and every meter showed
// 0 kWh no matter what was submitted. live-stream now returns the
// window's integrated kWh (+ cost at the user's rate) and device-list
// reports each meter's liveKwh beside its logged-readings totalKwh —
// trapezoidal integration between consecutive samples of the same
// meter ((w1 + w2) / 2 × Δt), the Sense/Emporia model. A lone sample
// accrues nothing yet; integration never crosses a meter boundary.
//
// Samples are submitted through the real live-sample action, then their
// stored timestamps are set explicitly so the integration is exact.
//
// Run: cd server && NODE_ENV=test node --test --import=./tests/preload/no-egress.mjs tests/energy-live-kwh.test.js

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerEnergyActions from "../domains/energy.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`energy.${name}`);
  if (!fn) throw new Error(`energy.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerEnergyActions(register); });

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const HOUR = 3600000;
let T0;

function seedState() {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
  T0 = Date.now() - 3 * HOUR;
}
beforeEach(seedState);

// Submit a sample through the real action, then pin its stored ts.
function sampleAt(watts, tsOffsetH, deviceId) {
  const r = call("live-sample", ctxA, { watts, ...(deviceId ? { deviceId } : {}) });
  assert.equal(r.ok, true, JSON.stringify(r));
  const arr = globalThis._concordSTATE.energyLens.livePower.get("user_a");
  arr[arr.length - 1].ts = T0 + tsOffsetH * HOUR;
  arr[arr.length - 1].at = new Date(T0 + tsOffsetH * HOUR).toISOString();
}

describe("live samples integrate into kWh (FIX-energy-001)", () => {
  it("two 1000 W samples an hour apart integrate to 1 kWh, costed at the user's rate", () => {
    call("rate-set", ctxA, { ratePerKwh: 0.25 });
    const main = call("device-add", ctxA, { name: "Main panel", category: "meter" }).result.device;
    sampleAt(1000, 0, main.id);
    sampleAt(1000, 1, main.id);
    const r = call("live-stream", ctxA, { minutes: 360, deviceId: main.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 2);
    assert.equal(r.result.kwh, 1);
    assert.equal(r.result.cost, 0.25);
  });

  it("a falling edge integrates trapezoidally, and a lone sample accrues nothing", () => {
    const main = call("device-add", ctxA, { name: "Main panel", category: "meter" }).result.device;
    sampleAt(1000, 0, main.id);
    let r = call("live-stream", ctxA, { minutes: 360, deviceId: main.id });
    assert.equal(r.result.kwh, 0);
    sampleAt(1000, 1, main.id);
    sampleAt(0, 2, main.id);
    r = call("live-stream", ctxA, { minutes: 360, deviceId: main.id });
    // 1000 W flat for 1h = 1 kWh; (1000 + 0) / 2 for 1h = 0.5 kWh.
    assert.equal(r.result.kwh, 1.5);
  });

  it("device-list reports liveKwh per meter, integrated per meter only, beside an unchanged totalKwh", () => {
    const main = call("device-add", ctxA, { name: "Main panel", category: "meter" }).result.device;
    const garage = call("device-add", ctxA, { name: "Garage meter", category: "meter" }).result.device;
    sampleAt(1000, 0, main.id);
    sampleAt(500, 0.5, garage.id);
    sampleAt(1000, 1, main.id);
    sampleAt(500, 1.5, garage.id);
    call("reading-log", ctxA, { deviceId: main.id, kwh: 2 });
    const list = call("device-list", ctxA, {});
    const byId = Object.fromEntries(list.result.devices.map((d) => [d.id, d]));
    assert.equal(byId[main.id].liveKwh, 1);      // 1000 W × 1 h
    assert.equal(byId[main.id].totalKwh, 2);     // logged readings only, as before
    assert.equal(byId[garage.id].liveKwh, 0.5);  // 500 W × 1 h — no cross-meter intervals
    assert.equal(byId[garage.id].totalKwh, 0);
  });
});
