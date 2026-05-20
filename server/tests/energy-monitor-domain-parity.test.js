// Contract tests for the energy Sense 2026-parity home-energy-monitor
// macros (devices, readings, solar, rates, bills, goals, analytics).
// EIA-API + compute macros are covered in energy-domain-parity.test.js.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerEnergyActions from "../domains/energy.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`energy.${name}`);
  assert.ok(fn, `energy.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerEnergyActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };
const today = () => new Date().toISOString().slice(0, 10);
const month = () => new Date().toISOString().slice(0, 7);

function newDevice(ctx = ctxA, over = {}) {
  return call("device-add", ctx, { name: "AC unit", category: "hvac", wattage: 3500, ...over }).result.device;
}

describe("energy.device-*", () => {
  it("add requires a name, scoped per user", () => {
    assert.equal(call("device-add", ctxA, {}).ok, false);
    newDevice();
    assert.equal(call("device-list", ctxA, {}).result.count, 1);
    assert.equal(call("device-list", ctxB, {}).result.count, 0);
  });

  it("update and delete (delete clears readings)", () => {
    const d = newDevice();
    assert.equal(call("device-update", ctxA, { id: d.id, wattage: 4000 }).result.device.wattage, 4000);
    call("reading-log", ctxA, { deviceId: d.id, kwh: 5 });
    assert.equal(call("device-delete", ctxA, { id: d.id }).ok, true);
    assert.equal(call("reading-history", ctxA, {}).result.totalKwh, 0);
  });
});

describe("energy.reading + rate + bill", () => {
  it("readings cost at the default rate, history aggregates by day", () => {
    call("reading-log", ctxA, { kwh: 10, date: today() });
    call("reading-log", ctxA, { kwh: 5, date: today() });
    const h = call("reading-history", ctxA, {});
    assert.equal(h.result.totalKwh, 15);
    assert.equal(h.result.series.length, 1);
  });

  it("rate-set changes cost; bill nets out solar", () => {
    call("rate-set", ctxA, { ratePerKwh: 0.20, utility: "PG&E" });
    call("reading-log", ctxA, { kwh: 100, date: today() });
    call("solar-log", ctxA, { kwh: 40, date: today() });
    const bill = call("bill-estimate", ctxA, { month: month() });
    assert.equal(bill.result.netKwh, 60);
    assert.equal(bill.result.estimatedBill, 12); // 60 × 0.20
    assert.equal(bill.result.solarSavings, 8);   // 40 × 0.20
  });

  it("rejects non-positive readings and rates", () => {
    assert.equal(call("reading-log", ctxA, { kwh: 0 }).ok, false);
    assert.equal(call("rate-set", ctxA, { ratePerKwh: 0 }).ok, false);
  });
});

describe("energy.solar", () => {
  it("solar summary computes offset vs consumption", () => {
    call("reading-log", ctxA, { kwh: 50, date: today() });
    call("solar-log", ctxA, { kwh: 30, date: today() });
    const sum = call("solar-summary", ctxA, {});
    assert.equal(sum.result.producedKwh, 30);
    assert.equal(sum.result.consumedKwh, 50);
    assert.equal(sum.result.offsetPct, 60);
  });
});

describe("energy.goals", () => {
  it("goal tracks usage against target", () => {
    call("reading-log", ctxA, { kwh: 200, date: today() });
    const g = call("goal-set", ctxA, { targetKwh: 500, period: "month" }).result.goal;
    const list = call("goal-list", ctxA, {});
    assert.equal(list.result.goals[0].usedKwh, 200);
    assert.equal(list.result.goals[0].pct, 40);
    assert.equal(list.result.goals[0].overBudget, false);
    assert.equal(call("goal-delete", ctxA, { id: g.id }).ok, true);
  });

  it("rejects non-positive target", () => {
    assert.equal(call("goal-set", ctxA, { targetKwh: 0 }).ok, false);
  });
});

describe("energy.analytics", () => {
  it("usage-breakdown groups by device category", () => {
    const hvac = newDevice(ctxA, { name: "AC", category: "hvac" });
    const fridge = newDevice(ctxA, { name: "Fridge", category: "kitchen" });
    call("reading-log", ctxA, { deviceId: hvac.id, kwh: 60, date: today() });
    call("reading-log", ctxA, { deviceId: fridge.id, kwh: 20, date: today() });
    call("reading-log", ctxA, { kwh: 20, date: today() }); // untracked
    const bd = call("usage-breakdown", ctxA, {});
    assert.equal(bd.result.totalKwh, 100);
    assert.equal(bd.result.untrackedKwh, 20);
    assert.equal(bd.result.breakdown[0].category, "hvac");
    assert.equal(bd.result.breakdown[0].pct, 60);
  });

  it("top-consumers ranks devices by kwh", () => {
    const a = newDevice(ctxA, { name: "Big" });
    const b = newDevice(ctxA, { name: "Small" });
    call("reading-log", ctxA, { deviceId: a.id, kwh: 80, date: today() });
    call("reading-log", ctxA, { deviceId: b.id, kwh: 10, date: today() });
    const tc = call("top-consumers", ctxA, {});
    assert.equal(tc.result.devices[0].name, "Big");
  });

  it("energy-dashboard aggregates the month", () => {
    newDevice();
    call("reading-log", ctxA, { kwh: 100, date: today() });
    call("solar-log", ctxA, { kwh: 25, date: today() });
    const d = call("energy-dashboard", ctxA, {});
    assert.equal(d.result.devices, 1);
    assert.equal(d.result.monthKwh, 100);
    assert.equal(d.result.solarOffsetPct, 25);
  });
});
