// Tier-2 contract tests for the self lens — quantified-self ledger in
// server/domains/self.js. Pins the metric ledger, trend/correlation
// math, goals/progress rings, import idempotency, digest, layout, and
// streaks. Every macro asserts an { ok: true } envelope and shape.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerSelfActions from "../domains/self.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`self.${name}`);
  assert.ok(fn, `self.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerSelfActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "self_a" }, userId: "self_a" };
const ctxB = { actor: { userId: "self_b" }, userId: "self_b" };
const dayAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

describe("self.logMetric + readings", () => {
  it("logs a real reading and reads it back per user", () => {
    const r = call("logMetric", ctxA, { metric: "steps", value: 8200 });
    assert.equal(r.ok, true);
    assert.equal(r.result.reading.metric, "steps");
    assert.equal(r.result.reading.value, 8200);
    assert.equal(call("readings", ctxA, {}).result.count, 1);
    assert.equal(call("readings", ctxB, {}).result.count, 0);
  });
  it("rejects an unknown metric and a non-numeric value", () => {
    assert.equal(call("logMetric", ctxA, { metric: "vibes", value: 1 }).ok, false);
    assert.equal(call("logMetric", ctxA, { metric: "steps", value: "lots" }).ok, false);
  });
  it("filters readings by metric", () => {
    call("logMetric", ctxA, { metric: "steps", value: 100 });
    call("logMetric", ctxA, { metric: "mood", value: 4 });
    assert.equal(call("readings", ctxA, { metric: "mood" }).result.count, 1);
  });
});

describe("self.importBatch", () => {
  it("ingests a wearable export and is idempotent on re-import", () => {
    const samples = [
      { metric: "steps", value: 5000, at: dayAgo(1), source: "applehealth" },
      { metric: "sleep_hours", value: 7.5, at: dayAgo(1), source: "applehealth" },
    ];
    const r1 = call("importBatch", ctxA, { samples, source: "applehealth" });
    assert.equal(r1.ok, true);
    assert.equal(r1.result.imported, 2);
    const r2 = call("importBatch", ctxA, { samples, source: "applehealth" });
    assert.equal(r2.result.imported, 0);
    assert.equal(r2.result.skipped, 2);
  });
  it("rejects an empty batch and counts invalid samples", () => {
    assert.equal(call("importBatch", ctxA, { samples: [] }).ok, false);
    const r = call("importBatch", ctxA, { samples: [{ metric: "bad", value: 1 }] });
    assert.equal(r.ok, true);
    assert.equal(r.result.skipped, 1);
  });
});

describe("self.trend", () => {
  it("returns a daily series with stats for a metric", () => {
    call("logMetric", ctxA, { metric: "steps", value: 4000, at: dayAgo(3) });
    call("logMetric", ctxA, { metric: "steps", value: 6000, at: dayAgo(2) });
    call("logMetric", ctxA, { metric: "steps", value: 8000, at: dayAgo(1) });
    call("logMetric", ctxA, { metric: "steps", value: 10000, at: dayAgo(0) });
    const r = call("trend", ctxA, { metric: "steps", days: 30 });
    assert.equal(r.ok, true);
    assert.equal(r.result.series.length, 4);
    assert.equal(r.result.stats.count, 4);
    assert.ok(r.result.stats.deltaPct > 0);
  });
  it("rejects an unknown metric", () => {
    assert.equal(call("trend", ctxA, { metric: "nope" }).ok, false);
  });
});

describe("self.correlate", () => {
  it("scans for the strongest cross-metric link", () => {
    for (let i = 0; i < 6; i++) {
      call("logMetric", ctxA, { metric: "workout_min", value: i * 10, at: dayAgo(i) });
      call("logMetric", ctxA, { metric: "sleep_hours", value: 5 + i * 0.3, at: dayAgo(i) });
    }
    const r = call("correlate", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.links));
    assert.ok(r.result.links.length >= 1);
    assert.ok(typeof r.result.links[0].r === "number");
  });
  it("computes a specific metric pair", () => {
    for (let i = 0; i < 6; i++) {
      call("logMetric", ctxA, { metric: "steps", value: i * 1000, at: dayAgo(i) });
      call("logMetric", ctxA, { metric: "mood", value: 1 + i * 0.5, at: dayAgo(i) });
    }
    const r = call("correlate", ctxA, { metricA: "steps", metricB: "mood" });
    assert.equal(r.ok, true);
    assert.equal(r.result.metricA, "steps");
    assert.ok(typeof r.result.insight === "string");
  });
});

describe("self.setGoal + goals", () => {
  it("sets a goal and computes a progress ring", () => {
    const g = call("setGoal", ctxA, { metric: "steps", target: 10000, period: "daily" });
    assert.equal(g.ok, true);
    call("logMetric", ctxA, { metric: "steps", value: 4000 });
    const r = call("goals", ctxA, {});
    assert.equal(r.result.count, 1);
    assert.equal(r.result.goals[0].percent, 40);
    assert.equal(r.result.goals[0].met, false);
  });
  it("rejects a bad target and removes a goal", () => {
    assert.equal(call("setGoal", ctxA, { metric: "steps", target: -1 }).ok, false);
    call("setGoal", ctxA, { metric: "mood", target: 4 });
    assert.equal(call("removeGoal", ctxA, { metric: "mood" }).ok, true);
    assert.equal(call("goals", ctxA, {}).result.count, 0);
  });
});

describe("self.digest", () => {
  it("generates a daily recap from real readings", () => {
    call("logMetric", ctxA, { metric: "steps", value: 7000 });
    const r = call("digest", ctxA, { range: "daily" });
    assert.equal(r.ok, true);
    assert.equal(r.result.range, "daily");
    assert.ok(r.result.stats.length >= 1);
    assert.ok(r.result.lines.length >= 1);
  });
  it("reports an empty digest when no data", () => {
    const r = call("digest", ctxA, { range: "weekly" });
    assert.equal(r.ok, true);
    assert.equal(r.result.stats.length, 0);
    assert.match(r.result.headline, /No data/);
  });
});

describe("self.saveLayout + layout", () => {
  it("saves a custom tile layout and reads it back", () => {
    const def = call("layout", ctxA, {});
    assert.equal(def.result.isDefault, true);
    const s = call("saveLayout", ctxA, { tiles: ["sleep_hours", "mood", "weight_kg"] });
    assert.equal(s.ok, true);
    const r = call("layout", ctxA, {});
    assert.equal(r.result.isDefault, false);
    assert.deepEqual(r.result.tiles, ["sleep_hours", "mood", "weight_kg"]);
  });
  it("rejects an all-invalid layout", () => {
    assert.equal(call("saveLayout", ctxA, { tiles: ["bogus"] }).ok, false);
  });
});

describe("self.streaks", () => {
  it("computes consecutive-day logging streaks", () => {
    call("logMetric", ctxA, { metric: "meditation_min", value: 10, at: dayAgo(0) });
    call("logMetric", ctxA, { metric: "meditation_min", value: 10, at: dayAgo(1) });
    call("logMetric", ctxA, { metric: "meditation_min", value: 10, at: dayAgo(2) });
    const r = call("streaks", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.loggedToday, true);
    assert.equal(r.result.overall, 3);
    const med = r.result.perMetric.find((x) => x.metric === "meditation_min");
    assert.equal(med.current, 3);
  });
});

describe("self.overview", () => {
  it("returns layout-aware dashboard cards", () => {
    call("logMetric", ctxA, { metric: "steps", value: 3000 });
    call("logMetric", ctxA, { metric: "steps", value: 4000 });
    const r = call("overview", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.hasData, true);
    const steps = r.result.cards.find((c) => c.metric === "steps");
    assert.equal(steps.value, 7000);
  });
});
