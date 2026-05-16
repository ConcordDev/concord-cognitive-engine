import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerFitnessActions from "../domains/fitness.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`fitness.${name}`);
  assert.ok(fn, `fitness.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerFitnessActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("fitness.workout-list/save", () => {
  it("save + list scoped per user", () => {
    const w = { id: "wo1", title: "Push day", startedAt: new Date().toISOString(), exercises: [] };
    assert.equal(call("workout-save", ctxA, { workout: w }).ok, true);
    const list = call("workout-list", ctxA, {});
    assert.equal(list.result.workouts.length, 1);
    assert.equal(call("workout-list", ctxB, {}).result.workouts.length, 0);
  });

  it("rejects empty workout payload", () => {
    assert.equal(call("workout-save", ctxA, {}).ok, false);
  });
});

describe("fitness.hr-zones", () => {
  it("Tanaka formula returns 5 zones with ascending bpm and correct max", () => {
    const r = call("hr-zones", ctxA, { age: 30, restingHr: 60, method: "tanaka" });
    assert.equal(r.ok, true);
    assert.equal(r.result.maxHr, Math.round(208 - 0.7 * 30));
    assert.equal(r.result.zones.length, 5);
    for (let i = 1; i < r.result.zones.length; i++) {
      assert.ok(r.result.zones[i].lowBpm >= r.result.zones[i - 1].lowBpm);
    }
  });

  it("Fox formula uses 220 − age", () => {
    const r = call("hr-zones", ctxA, { age: 30, method: "fox" });
    assert.equal(r.result.maxHr, 190);
  });

  it("Karvonen uses HR reserve (resting matters)", () => {
    const r1 = call("hr-zones", ctxA, { age: 30, restingHr: 50, method: "karvonen" });
    const r2 = call("hr-zones", ctxA, { age: 30, restingHr: 80, method: "karvonen" });
    assert.notEqual(r1.result.zones[2].lowBpm, r2.result.zones[2].lowBpm);
  });
});

describe("fitness.recovery-history (real device data only)", () => {
  it("returns empty + setup hint when no wearable connected", () => {
    const r = call("recovery-history", ctxA, { days: 14 });
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.days, []);
    assert.equal(r.result.source, "empty");
    assert.match(r.result.notes, /wearable|Whoop|Apple Watch|Garmin|Fitbit/);
  });

  it("returns logged entries within the requested window when populated", () => {
    const state = globalThis._concordSTATE;
    state.fitnessLens = state.fitnessLens || {};
    state.fitnessLens.recoveryEntries = new Map();
    state.fitnessLens.recoveryEntries.set("user_a", [
      { date: new Date(Date.now() - 1 * 86400000).toISOString().slice(0, 10), recoveryScore: 72, hrv: 50, restingHr: 55 },
      { date: new Date(Date.now() - 20 * 86400000).toISOString().slice(0, 10), recoveryScore: 60, hrv: 42, restingHr: 60 }, // outside 14-day window
    ]);
    const r = call("recovery-history", ctxA, { days: 14 });
    assert.equal(r.result.days.length, 1);
    assert.equal(r.result.source, "device");
  });
});

describe("fitness.activity-summary (real device data only)", () => {
  it("returns empty + setup hint when no wearable connected", () => {
    const r = call("activity-summary", ctxA, { days: 7 });
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.days, []);
    assert.equal(r.result.source, "empty");
    assert.match(r.result.notes, /wearable|Apple Watch|Fitbit|Garmin/);
  });
});

describe("fitness.workout-plan-generate", () => {
  it("rejects when LLM unavailable", async () => {
    const r = await call("workout-plan-generate", ctxA, { goal: "strength" });
    assert.equal(r.ok, false);
    assert.match(r.error, /llm/);
  });

  it("parses JSON plan from conscious brain", async () => {
    const ctx = {
      actor: { userId: "user_a" }, userId: "user_a",
      llm: { chat: async () => ({
        text: '{"plan":{"goal":"strength","weeks":8,"daysPerWeek":4,"template":[{"day":"Monday","focus":"Upper","duration":60,"exercises":[{"name":"Bench","sets":4,"reps":"5","restSec":180}]}],"progression":"+5lb each week","nutrition":"surplus 200 kcal"}}',
      }) },
    };
    const r = await call("workout-plan-generate", ctx, { goal: "strength" });
    assert.equal(r.ok, true);
    assert.equal(r.result.plan.goal, "strength");
    assert.equal(r.result.plan.template[0].exercises[0].name, "Bench");
  });

  it("returns parse error on garbage LLM output", async () => {
    const ctx = { actor: { userId: "user_a" }, userId: "user_a", llm: { chat: async () => ({ text: "can't help" }) } };
    const r = await call("workout-plan-generate", ctx, { goal: "strength" });
    assert.equal(r.ok, false);
  });
});

describe("regression: pre-existing analytical macros still work", () => {
  it("progressionCalc returns recommendations array", () => {
    const r = ACTIONS.get("fitness.progressionCalc")(ctxA, { data: { exercises: [{ name: "Squat", weight: 225, reps: 5, rpe: 7 }] } }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.recommendations.length, 1);
  });

  it("bodyCompReport returns BMI + category", () => {
    const r = ACTIONS.get("fitness.bodyCompReport")(ctxA, { data: { weight: 180, height: 70, unit: "imperial", sex: "male", age: 30 } }, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.bmi > 0);
    assert.ok(typeof r.result.bmiCategory === "string");
  });

  it("periodization returns phases for strength goal", () => {
    const r = ACTIONS.get("fitness.periodization")(ctxA, { data: {} }, { weeks: 12, goal: "strength" });
    assert.equal(r.ok, true);
    assert.equal(r.result.phases.length, 4);
  });
});
