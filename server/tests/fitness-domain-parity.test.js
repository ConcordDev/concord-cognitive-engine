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

describe("fitness.recovery-history", () => {
  it("returns N days of deterministic data per user", () => {
    const r1 = call("recovery-history", ctxA, { days: 14 });
    assert.equal(r1.ok, true);
    assert.equal(r1.result.days.length, 14);
    for (const d of r1.result.days) {
      assert.ok(d.recoveryScore >= 0 && d.recoveryScore <= 100);
      assert.ok(d.sleepDurationHours > 0);
      assert.ok(d.strainYesterday >= 0 && d.strainYesterday <= 21);
    }
    const r2 = call("recovery-history", ctxA, { days: 14 });
    assert.deepEqual(r1.result.days[0], r2.result.days[0]);

    // Different user → some day differs in the series (full-series
    // determinism per user, not strict inequality at index 0)
    const rB = call("recovery-history", ctxB, { days: 14 });
    const someDiffer = rB.result.days.some((d, i) =>
      d.recoveryScore !== r1.result.days[i].recoveryScore ||
      d.hrv !== r1.result.days[i].hrv ||
      d.restingHr !== r1.result.days[i].restingHr
    );
    assert.ok(someDiffer, "two different users should produce some differing days");
  });
});

describe("fitness.activity-summary", () => {
  it("returns N days of ring data with goals", () => {
    const r = call("activity-summary", ctxA, { days: 7 });
    assert.equal(r.ok, true);
    assert.equal(r.result.days.length, 7);
    for (const d of r.result.days) {
      assert.equal(d.moveGoal, 500);
      assert.equal(d.exerciseGoal, 30);
      assert.equal(d.standGoal, 12);
      assert.equal(d.stepsGoal, 10000);
      assert.ok(d.moveCalories > 0);
    }
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
