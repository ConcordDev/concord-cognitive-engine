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

// ─── Strava + Garmin Connect 2026 parity ──────────────────────────────

const todayISO = () => new Date().toISOString().slice(0, 10);
const daysAgoISO = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

describe("fitness.activity-* CRUD", () => {
  it("create computes pace, speed, relative effort", () => {
    const r = call("activity-create", ctxA, { type: "run", distanceKm: 10, durationSec: 3000, avgHr: 150, maxHr: 180 });
    assert.equal(r.ok, true);
    assert.equal(r.result.activity.paceSecPerKm, 300);
    assert.ok(r.result.activity.speedKmh > 11 && r.result.activity.speedKmh < 13);
    assert.ok(r.result.activity.relativeEffort > 0);
  });

  it("rejects unknown type and zero duration", () => {
    assert.equal(call("activity-create", ctxA, { type: "teleport", durationSec: 100 }).ok, false);
    assert.equal(call("activity-create", ctxA, { type: "run", durationSec: 0 }).ok, false);
  });

  it("list is per-user scoped and aggregates distance", () => {
    call("activity-create", ctxA, { type: "run", distanceKm: 5, durationSec: 1500 });
    call("activity-create", ctxA, { type: "ride", distanceKm: 20, durationSec: 3600 });
    call("activity-create", ctxB, { type: "run", distanceKm: 8, durationSec: 2400 });
    const a = call("activity-list", ctxA, {});
    assert.equal(a.result.count, 2);
    assert.equal(a.result.totalDistanceKm, 25);
    assert.equal(call("activity-list", ctxB, {}).result.count, 1);
    assert.equal(call("activity-list", ctxA, { type: "ride" }).result.count, 1);
  });

  it("detail returns formatted fields, delete removes", () => {
    const id = call("activity-create", ctxA, { type: "run", distanceKm: 5, durationSec: 1500 }).result.activity.id;
    const d = call("activity-detail", ctxA, { id });
    assert.equal(d.ok, true);
    assert.equal(d.result.activity.pace, "5:00");
    assert.equal(call("activity-delete", ctxA, { id }).ok, true);
    assert.equal(call("activity-detail", ctxA, { id }).ok, false);
  });

  it("kudos toggle is idempotent per user", () => {
    const id = call("activity-create", ctxA, { type: "run", distanceKm: 5, durationSec: 1500 }).result.activity.id;
    const k1 = call("activity-kudos", ctxB, { id, ownerUserId: "user_a" });
    assert.equal(k1.result.kudosCount, 1);
    const k2 = call("activity-kudos", ctxB, { id, ownerUserId: "user_a" });
    assert.equal(k2.result.kudosCount, 0);
  });
});

describe("fitness.segment-* + leaderboard", () => {
  it("create + efforts rank ascending, CR detected", () => {
    const seg = call("segment-create", ctxA, { name: "Hill Climb", distanceKm: 2, elevationGainM: 120 }).result.segment;
    const e1 = call("segment-effort", ctxA, { segmentId: seg.id, timeSeconds: 600 });
    assert.equal(e1.result.isPR, true);
    assert.equal(e1.result.isCourseRecord, true);
    call("segment-effort", ctxB, { segmentId: seg.id, timeSeconds: 540 });
    const e3 = call("segment-effort", ctxA, { segmentId: seg.id, timeSeconds: 580 });
    assert.equal(e3.result.isPR, true);          // beat own 600
    assert.equal(e3.result.isCourseRecord, false); // B holds 540
    const board = call("segment-leaderboard", ctxA, { segmentId: seg.id });
    assert.equal(board.result.leaderboard[0].timeSeconds, 540);
    assert.equal(board.result.leaderboard[0].title, "CR");
    assert.equal(board.result.athletes, 2);
  });

  it("rejects missing segment and bad time", () => {
    assert.equal(call("segment-effort", ctxA, { segmentId: "nope", timeSeconds: 100 }).ok, false);
    const seg = call("segment-create", ctxA, { name: "S", distanceKm: 1 }).result.segment;
    assert.equal(call("segment-effort", ctxA, { segmentId: seg.id, timeSeconds: 0 }).ok, false);
  });
});

describe("fitness.route-*", () => {
  it("create rates difficulty from climb-per-km, list + delete", () => {
    const easy = call("route-create", ctxA, { name: "Flat", distanceKm: 10, elevationGainM: 50 });
    assert.equal(easy.result.route.difficulty, "easy");
    const hard = call("route-create", ctxA, { name: "Climby", distanceKm: 10, elevationGainM: 600 });
    assert.equal(hard.result.route.difficulty, "extreme");
    assert.equal(call("route-list", ctxA, {}).result.count, 2);
    assert.equal(call("route-delete", ctxA, { id: easy.result.route.id }).ok, true);
    assert.equal(call("route-list", ctxA, {}).result.count, 1);
  });
});

describe("fitness.training-load (CTL/ATL/TSB)", () => {
  it("computes fitness/fatigue/form from activity history", () => {
    for (let i = 20; i >= 0; i--) {
      call("activity-create", ctxA, { type: "run", distanceKm: 8, durationSec: 2400, avgHr: 150, maxHr: 185, date: daysAgoISO(i) });
    }
    const r = call("training-load", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.fitness > 0);
    assert.ok(r.result.fatigue > 0);
    // form ≈ fitness − fatigue (each rounded independently, allow 0.15 drift)
    assert.ok(Math.abs(r.result.form - (r.result.fitness - r.result.fatigue)) <= 0.15);
    assert.ok(typeof r.result.status === "string");
  });

  it("empty history yields zeros", () => {
    const r = call("training-load", ctxB, {});
    assert.equal(r.result.fitness, 0);
    assert.equal(r.result.status, "no_data");
  });
});

describe("fitness.vo2max-estimate + race-predictor", () => {
  it("VO2max from a 20:00 5K is in a realistic band", () => {
    const r = call("vo2max-estimate", ctxA, { distanceKm: 5, durationSec: 1200 });
    assert.equal(r.ok, true);
    assert.ok(r.result.vo2max > 40 && r.result.vo2max < 60, `vo2max ${r.result.vo2max}`);
  });

  it("race predictions increase with distance", () => {
    const r = call("race-predictor", ctxA, { vo2max: 50 });
    assert.equal(r.ok, true);
    const t = r.result.predictions.map((p) => p.timeSeconds);
    for (let i = 1; i < t.length; i++) assert.ok(t[i] > t[i - 1], "longer race takes longer");
    // marathon pace slower than 5K pace
    assert.ok(r.result.predictions[3].paceSecPerKm > r.result.predictions[0].paceSecPerKm);
  });

  it("predictor falls back to logged runs", () => {
    call("activity-create", ctxB, { type: "run", distanceKm: 5, durationSec: 1300 });
    const r = call("race-predictor", ctxB, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.source, "best logged run");
  });
});

describe("fitness.hrv + readiness + body-battery", () => {
  it("hrv-status needs 3 samples then reports balanced", () => {
    assert.equal(call("hrv-status", ctxA, {}).result.status, "insufficient_data");
    for (let i = 0; i < 5; i++) call("hrv-log", ctxA, { rmssd: 60, date: daysAgoISO(i) });
    const r = call("hrv-status", ctxA, {});
    assert.equal(r.result.status, "balanced");
    assert.equal(r.result.samples, 5);
  });

  it("hrv-log rejects non-positive rmssd", () => {
    assert.equal(call("hrv-log", ctxA, { rmssd: 0 }).ok, false);
  });

  it("training-readiness scores higher with good sleep", () => {
    const low = call("training-readiness", ctxA, { sleepHours: 4 }).result.score;
    const high = call("training-readiness", ctxA, { sleepHours: 8 }).result.score;
    assert.ok(high > low);
    assert.ok(high >= 1 && high <= 100);
  });

  it("body-battery responds to sleep and clamps", () => {
    const r = call("body-battery", ctxA, { sleepHours: 8 });
    assert.ok(r.result.battery >= 5 && r.result.battery <= 100);
    assert.ok(typeof r.result.state === "string");
  });
});

describe("fitness.goal-*", () => {
  it("tracks weekly distance progress", () => {
    call("activity-create", ctxA, { type: "run", distanceKm: 12, durationSec: 3600, date: todayISO() });
    const g = call("goal-create", ctxA, { metric: "distance", target: 30, period: "week" });
    assert.equal(g.ok, true);
    const list = call("goal-list", ctxA, {});
    assert.equal(list.result.goals[0].progress.value, 12);
    assert.equal(list.result.goals[0].progress.pct, 40);
    assert.equal(list.result.goals[0].progress.complete, false);
  });

  it("rejects bad metric / target and deletes", () => {
    assert.equal(call("goal-create", ctxA, { metric: "vibes", target: 5 }).ok, false);
    assert.equal(call("goal-create", ctxA, { metric: "distance", target: 0 }).ok, false);
    const id = call("goal-create", ctxA, { metric: "activity_count", target: 3 }).result.goal.id;
    assert.equal(call("goal-delete", ctxA, { id }).ok, true);
    assert.equal(call("goal-list", ctxA, {}).result.count, 0);
  });
});

describe("fitness.personal-records", () => {
  it("surfaces longest distance and fastest pace", () => {
    call("activity-create", ctxA, { type: "run", distanceKm: 5, durationSec: 1200 });   // 4:00/km
    call("activity-create", ctxA, { type: "run", distanceKm: 21, durationSec: 6300 });  // longer, slower
    const r = call("personal-records", ctxA, {});
    assert.equal(r.ok, true);
    const longest = r.result.records.find((x) => x.label === "Longest distance");
    assert.equal(longest.value, 21);
    const fastest = r.result.records.find((x) => x.label === "Fastest run pace");
    assert.equal(fastest.value, 240);
  });

  it("empty log returns no records", () => {
    assert.equal(call("personal-records", ctxB, {}).result.records.length, 0);
  });
});

describe("fitness.gear-*", () => {
  it("activity mileage accrues onto gear and flags wear", () => {
    const gear = call("gear-add", ctxA, { name: "Pegasus", kind: "shoes", retireAtKm: 100 }).result.gear;
    call("activity-create", ctxA, { type: "run", distanceKm: 90, durationSec: 18000, gearId: gear.id });
    const list = call("gear-list", ctxA, {});
    assert.equal(list.result.gear[0].distanceKm, 90);
    assert.equal(list.result.gear[0].status, "wearing_out");
    assert.equal(call("gear-retire", ctxA, { id: gear.id }).result.gear.retired, true);
  });

  it("deleting an activity rolls gear mileage back", () => {
    const gear = call("gear-add", ctxA, { name: "Bike", kind: "bike" }).result.gear;
    const act = call("activity-create", ctxA, { type: "ride", distanceKm: 40, durationSec: 5400, gearId: gear.id }).result.activity;
    call("activity-delete", ctxA, { id: act.id });
    assert.equal(call("gear-list", ctxA, {}).result.gear[0].distanceKm, 0);
  });
});

describe("fitness.club-* + challenge-*", () => {
  it("club create + join + leave", () => {
    const club = call("club-create", ctxA, { name: "Dawn Patrol", sport: "run" }).result.club;
    assert.equal(call("club-join", ctxB, { id: club.id }).result.memberCount, 2);
    assert.equal(call("club-join", ctxB, { id: club.id, leave: true }).result.memberCount, 1);
    assert.equal(call("club-list", ctxB, { mine: true }).result.count, 0);
  });

  it("challenge leaderboard ranks participants by progress", () => {
    const ch = call("challenge-create", ctxA, {
      name: "100km May", metric: "distance", target: 100,
      startDate: daysAgoISO(5), endDate: daysAgoISO(-25),
    }).result.challenge;
    call("challenge-join", ctxB, { id: ch.id });
    call("activity-create", ctxA, { type: "run", distanceKm: 30, durationSec: 9000, date: daysAgoISO(1) });
    call("activity-create", ctxB, { type: "run", distanceKm: 55, durationSec: 16000, date: daysAgoISO(1) });
    const list = call("challenge-list", ctxB, { mine: true });
    const c = list.result.challenges[0];
    assert.equal(c.leaderboard[0].userId, "user_b");
    assert.equal(c.leaderboard[0].value, 55);
    assert.equal(c.myProgress.value, 55);
  });

  it("challenge rejects bad metric", () => {
    assert.equal(call("challenge-create", ctxA, { name: "X", metric: "kudos", target: 5 }).ok, false);
  });
});

describe("fitness.fitness-dashboard", () => {
  it("aggregates week totals, training load, goals, gear", () => {
    call("activity-create", ctxA, { type: "run", distanceKm: 10, durationSec: 3000, date: todayISO() });
    call("goal-create", ctxA, { metric: "distance", target: 50, period: "week" });
    call("gear-add", ctxA, { name: "Shoes", kind: "shoes" });
    const r = call("fitness-dashboard", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.week.activities, 1);
    assert.equal(r.result.week.distanceKm, 10);
    assert.equal(r.result.goals.total, 1);
    assert.equal(r.result.gear.tracked, 1);
    assert.equal(r.result.totals.activities, 1);
  });
});
