import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerWellness from "../domains/wellness.js";
import registerSelf from "../domains/self.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(key, params) {
  const fn = ACTIONS.get(key);
  const ctx = { actor: { userId: "user_a" } };
  if (key.startsWith("wellness.")) return fn(ctx, params);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}
before(() => {
  registerWellness(register);
  registerSelf(register);
});
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

describe("wellness and self readings", () => {
  it("refuses a sleep reading of 30 hours and a negative water amount", () => {
    const sleep = call("wellness.metrics-log", { type: "sleep_hours", value: 30 });
    assert.equal(sleep.ok, false);
    assert.match(sleep.message, /0 to 24/);
    const water = call("wellness.metrics-log", { type: "water_ml", value: -5 });
    assert.equal(water.ok, false);
    assert.match(water.message, /0 to 20000/);
    const hrv = call("wellness.metrics-log", { type: "hrv_ms", value: -10 });
    assert.equal(hrv.ok, false);
    const asleep = call("wellness.sleepScore", { minutesAsleep: 600, minutesInBed: 480 });
    assert.equal(asleep.ok, false);
    assert.match(asleep.message, /cannot exceed minutes in bed/);
    const trend = call("wellness.hrvTrend", { readings: [{ date: "2026-06-01", hrvMs: -10 }, { date: "2026-06-02", hrvMs: 40 }] });
    assert.equal(trend.ok, false);
  });

  it("updates a reading the caller logged", () => {
    const logged = call("self.logMetric", { metric: "water_ml", value: 250 });
    assert.equal(logged.ok, true);
    const id = logged.result.reading.id;
    const updated = call("self.reading-update", { id, value: 400 });
    assert.equal(updated.ok, true);
    assert.equal(updated.result.reading.value, 400);
    const bad = call("self.reading-update", { id, value: -5 });
    assert.equal(bad.ok, false);
  });
});
