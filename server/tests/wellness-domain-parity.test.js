// Contract tests for the Apple Health + Whoop + Oura + Daylio 2026-parity
// macros in server/domains/wellness.js — metrics, habits + streaks,
// mood journal + correlation, workouts, recovery score, goals.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerWellnessActions from "../domains/wellness.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`wellness.${name}`);
  assert.ok(fn, `wellness.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerWellnessActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "well_a" }, userId: "well_a" };
const ctxB = { actor: { userId: "well_b" }, userId: "well_b" };

function dayAgo(n) { return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10); }

describe("wellness — metric logging", () => {
  it("logs a metric + lists it; rejects unknown type", () => {
    const r = call("metrics-log", ctxA, { type: "steps", value: 8200 });
    assert.equal(r.ok, true);
    const bad = call("metrics-log", ctxA, { type: "vibes", value: 1 });
    assert.equal(bad.ok, false);
    assert.equal(call("metrics-list", ctxA, { type: "steps" }).result.metrics.length, 1);
    assert.equal(call("metrics-list", ctxB, { type: "steps" }).result.metrics.length, 0);
  });

  it("metrics-trend computes a per-day series + trend direction", () => {
    call("metrics-log", ctxA, { type: "weight_kg", value: 80, date: dayAgo(9) });
    call("metrics-log", ctxA, { type: "weight_kg", value: 79, date: dayAgo(6) });
    call("metrics-log", ctxA, { type: "weight_kg", value: 77, date: dayAgo(1) });
    const r = call("metrics-trend", ctxA, { type: "weight_kg", days: 30 });
    assert.equal(r.ok, true);
    assert.equal(r.result.series.length, 3);
    assert.equal(r.result.trend, "falling");
    assert.equal(r.result.latest, 77);
  });
});

describe("wellness — habits + streaks", () => {
  it("creates a habit and check-ins build a streak", () => {
    const h = call("habits-create", ctxA, { name: "Meditate", target: 1 }).result.habit;
    // check in for the last 4 days incl today
    for (let i = 3; i >= 0; i--) call("habits-checkin", ctxA, { habitId: h.id, date: dayAgo(i), value: 1 });
    const list = call("habits-list", ctxA).result.habits;
    const meditate = list.find(x => x.id === h.id);
    assert.equal(meditate.streak, 4);
    assert.equal(meditate.doneToday, true);
    assert.equal(meditate.last7.length, 7);
  });

  it("flexible-goal habit only counts a day when value >= target", () => {
    const h = call("habits-create", ctxA, { name: "Water", unit: "glasses", target: 8 }).result.habit;
    call("habits-checkin", ctxA, { habitId: h.id, date: dayAgo(0), value: 5 });
    let list = call("habits-list", ctxA).result.habits;
    assert.equal(list.find(x => x.id === h.id).doneToday, false);
    call("habits-checkin", ctxA, { habitId: h.id, date: dayAgo(0), value: 8 });
    list = call("habits-list", ctxA).result.habits;
    assert.equal(list.find(x => x.id === h.id).doneToday, true);
  });

  it("archive removes a habit from the list", () => {
    const h = call("habits-create", ctxA, { name: "Temp" }).result.habit;
    call("habits-archive", ctxA, { id: h.id });
    assert.equal(call("habits-list", ctxA).result.habits.find(x => x.id === h.id), undefined);
  });
});

describe("wellness — mood journal + correlation", () => {
  it("logs moods and rejects an invalid mood", () => {
    const r = call("mood-log", ctxA, { mood: "great", activities: ["exercise", "friends"] });
    assert.equal(r.ok, true);
    assert.equal(r.result.entry.moodScore, 4);
    assert.equal(call("mood-log", ctxA, { mood: "ecstatic" }).ok, false);
  });

  it("mood-correlate flags activities that lift mood", () => {
    // exercise days are great, doomscroll days are bad
    call("mood-log", ctxA, { mood: "great", activities: ["exercise"], date: dayAgo(5) });
    call("mood-log", ctxA, { mood: "good",  activities: ["exercise"], date: dayAgo(4) });
    call("mood-log", ctxA, { mood: "bad",   activities: ["doomscroll"], date: dayAgo(3) });
    call("mood-log", ctxA, { mood: "awful", activities: ["doomscroll"], date: dayAgo(2) });
    const r = call("mood-correlate", ctxA, { days: 90 });
    assert.equal(r.ok, true);
    const ex = r.result.correlations.find(c => c.activity === "exercise");
    const ds = r.result.correlations.find(c => c.activity === "doomscroll");
    assert.equal(ex.effect, "lifts mood");
    assert.equal(ds.effect, "lowers mood");
  });
});

describe("wellness — workouts", () => {
  it("logs + lists workouts with total minutes", () => {
    call("workouts-log", ctxA, { kind: "run", durationMin: 30, distanceKm: 5, intensity: "hard" });
    call("workouts-log", ctxA, { kind: "yoga", durationMin: 45, intensity: "easy" });
    const r = call("workouts-list", ctxA, { days: 30 });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 2);
    assert.equal(r.result.totalMin, 75);
  });
});

describe("wellness — recovery score", () => {
  it("computes a green score from good sleep + HRV + low RHR", () => {
    const today = dayAgo(0);
    call("metrics-log", ctxA, { type: "sleep_hours", value: 8.5, date: today });
    call("metrics-log", ctxA, { type: "hrv_ms", value: 85, date: today });
    call("metrics-log", ctxA, { type: "resting_hr", value: 48, date: today });
    const r = call("recovery-score", ctxA, { date: today });
    assert.equal(r.ok, true);
    assert.equal(r.result.band, "green");
    assert.ok(r.result.score >= 67);
    assert.ok(r.result.inputsUsed.includes("sleep"));
  });

  it("computes a low score from poor sleep + heavy strain", () => {
    const today = dayAgo(0);
    call("metrics-log", ctxA, { type: "sleep_hours", value: 4, date: today });
    call("metrics-log", ctxA, { type: "resting_hr", value: 78, date: today });
    call("workouts-log", ctxA, { kind: "hiit", durationMin: 90, intensity: "max", date: today });
    const r = call("recovery-score", ctxA, { date: today });
    assert.equal(r.ok, true);
    assert.ok(r.result.score < 67);
  });
});

describe("wellness — goals", () => {
  it("creates a goal, updates progress, auto-achieves at target", () => {
    const g = call("goals-create", ctxA, { name: "Run 50km this month", target: 50, unit: "km" }).result.goal;
    assert.equal(g.status, "active");
    let r = call("goals-update-progress", ctxA, { id: g.id, current: 30 });
    assert.equal(r.result.progressPct, 60);
    assert.equal(r.result.goal.status, "active");
    r = call("goals-update-progress", ctxA, { id: g.id, current: 52 });
    assert.equal(r.result.goal.status, "achieved");
    assert.equal(r.result.progressPct, 100);
  });

  it("rejects a goal with no positive target", () => {
    assert.equal(call("goals-create", ctxA, { name: "X", target: 0 }).ok, false);
  });
});

describe("wellness — dashboard summary", () => {
  it("aggregates habits, workouts, mood, goals", () => {
    const h = call("habits-create", ctxA, { name: "Stretch" }).result.habit;
    call("habits-checkin", ctxA, { habitId: h.id, date: dayAgo(0), value: 1 });
    call("workouts-log", ctxA, { kind: "walk", durationMin: 20 });
    call("mood-log", ctxA, { mood: "good" });
    call("goals-create", ctxA, { name: "G", target: 10 });
    const r = call("wellness-dashboard-summary", ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.habitCount, 1);
    assert.equal(r.result.habitsDoneToday, 1);
    assert.equal(r.result.workoutsThisWeek, 1);
    assert.equal(r.result.activeGoals, 1);
    assert.ok(r.result.avgMoodThisWeek !== null);
  });
});
