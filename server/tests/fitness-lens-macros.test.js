// Behavioral macro tests for server/domains/fitness.js — the personal-training
// + Strava/Garmin/Whoop/Apple-Fitness substrate the /lenses/fitness lens drives
// (progression calc, body-composition report, periodization, class utilization,
// HR zones, plus the STATE-backed activity/segment/route/goal/gear/club/
// challenge/training-load/recovery/activity-ring surfaces).
//
// This file mirrors the REAL LENS_ACTIONS dispatch: every fitness handler is
// registered via `registerLensAction(domain, action, handler)` and invoked as
// `handler(ctx, virtualArtifact, input)` — the 3-ARG convention with
// `virtualArtifact.data === input`. The dispatch ALSO peels exactly one
// redundant `{ artifact: { data } }` wrapper (lens-input-normalize.js); we peel
// the same way before calling so the harness is byte-identical to production.
//
// These are NOT shape-only assertions. They pin ACTUAL computed values for KNOWN
// inputs → KNOWN outputs (Tanaka/Fox max HR + Karvonen zones, deterministic
// progression increments, BMI/body-fat bands, periodization phase weeks), the
// EXACT field names the SleepRecovery / ActivityRings / HeartRateZones /
// WorkoutPlanner components render (so a dead-surface regression surfaces here),
// CRUD round-trips through real STATE, validation-rejection, graceful
// degradation, and a fail-CLOSED poisoned-numeric contract: Infinity/NaN/1e999/
// negative/zero inputs are clamped or rejected and NEVER leak Infinity/NaN
// (serialized null) into the result, and NEVER throw.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerFitnessActions from "../domains/fitness.js";
import { peelRedundantArtifactWrapper } from "../lib/lens-input-normalize.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "fitness", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}

// Mirror the live dispatch exactly: peel one redundant artifact wrapper, then
// handler(ctx, virtualArtifact, input) with virtualArtifact.data = input.
// PATH 1 — the /api/lens/run dispatch (the `lensRun({domain,action,input})`
// channel the Strava/personal child components use). The route sets
// virtualArtifact.data = input and passes input as params, peeling one
// sole-key { artifact:{ data } } wrapper first.
function call(name, ctx, rawInput = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`fitness.${name} not registered`);
  const input = peelRedundantArtifactWrapper(rawInput);
  const virtualArtifact = { id: null, title: rawInput?.title ?? null, domain: "fitness", type: "domain_action", data: input || {}, meta: {} };
  return fn(ctx, virtualArtifact, input || {});
}

// PATH 2 — the artifact dispatch (`lens.run` / POST /api/lens/:domain/:id/run,
// driven by useRunArtifact). The route LOADS the real stored artifact and calls
// handler(ctx, artifact, params): the on-page data lives on `artifact.data`,
// `params` is separate. This is how the page Quick Actions (progressionCalc,
// classUtilization, bodyCompReport, periodization, recruitProfile,
// attendanceReport) are invoked — they read `artifact.data.X` + `params.Y`.
function callArtifact(name, ctx, artifactData = {}, params = {}, title = null) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`fitness.${name} not registered`);
  const artifact = { id: "art_test", title, domain: "fitness", type: "domain_action", data: artifactData || {}, meta: {} };
  return fn(ctx, artifact, params || {});
}

before(() => { registerFitnessActions(registerLensAction); });

beforeEach(() => {
  // No boot, no network. Any handler that reaches the network in a test is a
  // leak — these STATE/compute macros never should (the wger `feed` macro is
  // the only network one and is not exercised here).
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "fit_user_a" }, userId: "fit_user_a" };
const ctxB = { actor: { userId: "fit_user_b" }, userId: "fit_user_b" };

// Assert no value in the (possibly nested) object is a non-finite number.
function assertNoNonFinite(obj, path = "root") {
  if (obj == null) return;
  if (typeof obj === "number") {
    assert.ok(Number.isFinite(obj), `non-finite number at ${path}: ${obj}`);
    return;
  }
  if (Array.isArray(obj)) { obj.forEach((v, i) => assertNoNonFinite(v, `${path}[${i}]`)); return; }
  if (typeof obj === "object") { for (const k of Object.keys(obj)) assertNoNonFinite(obj[k], `${path}.${k}`); }
}

// ── registration: every lens-driven macro is present ────────────────────────
describe("fitness — registration (every lens-driven macro present)", () => {
  it("registers the legacy coaching-calc macros the page Quick Actions call", () => {
    for (const m of ["progressionCalc", "classUtilization", "bodyCompReport", "attendanceReport", "periodization", "recruitProfile"]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing fitness.${m}`);
    }
  });
  it("registers the personal-fitness tab macros the child components drive", () => {
    for (const m of [
      "hr-zones", "recovery-history", "activity-summary",
      "workout-plan-generate", "generate-program",
      "workout-list", "workout-save",
    ]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing fitness.${m}`);
    }
  });
  it("registers the Strava/Garmin STATE-backed macros", () => {
    for (const m of [
      "activity-create", "activity-list", "activity-detail", "activity-delete",
      "segment-create", "segment-list", "segment-effort", "segment-leaderboard",
      "route-create", "route-list", "training-load", "vo2max-estimate",
      "race-predictor", "hrv-log", "hrv-status", "training-readiness", "body-battery",
      "goal-create", "goal-list", "personal-records", "gear-add", "gear-list",
      "club-create", "challenge-create", "fitness-dashboard",
      "wearable-link", "wearable-sync", "wearable-status",
    ]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing fitness.${m}`);
    }
  });
});

// ── progressionCalc — deterministic RPE-driven increments ───────────────────
describe("fitness.progressionCalc — RPE → weight recommendation the page renders", () => {
  it("low RPE recommends a 5% increase; high RPE recommends a reduction", () => {
    const r = callArtifact("progressionCalc", ctxA, { exercises: [
      { name: "Squat", weight: 100, reps: 5, rpe: 6 },   // ≤6 → +5%
      { name: "Bench", weight: 80, reps: 8, rpe: 7 },     // ≤7 → +2.5%
      { name: "Press", weight: 60, reps: 6, rpe: 9 },     // ≥9 → −5%
    ] });
    assert.equal(r.ok, true);
    const [sq, be, pr] = r.result.recommendations;
    // 100 + 5 = 105, rounded to 0.5
    assert.equal(sq.recommendedWeight, 105);
    assert.equal(sq.recommendation, "increase_weight");
    // 80 + 2 = 82
    assert.equal(be.recommendedWeight, 82);
    assert.equal(be.recommendation, "maintain");
    // 60 − 3 = 57
    assert.equal(pr.recommendedWeight, 57);
    assert.equal(pr.recommendation, "reduce_weight");
    // EXACT field names the Action-Result renderer reads
    for (const rec of r.result.recommendations) {
      for (const k of ["exercise", "currentWeight", "currentReps", "currentRPE", "recommendedWeight", "recommendation"]) {
        assert.ok(k in rec, `missing rendered field ${k}`);
      }
    }
    assertNoNonFinite(r.result);
  });

  it("degrade-graceful: no exercises → empty recommendations, not a crash", () => {
    const r = callArtifact("progressionCalc", ctxA, {});
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.recommendations, []);
  });

  it("fail-CLOSED: poisoned 1e999/Infinity weight + reps → finite 0, never leaks Infinity", () => {
    const r = callArtifact("progressionCalc", ctxA, { exercises: [
      { name: "Bad", weight: "1e999", reps: Infinity, rpe: 5 },
    ] });
    assert.equal(r.ok, true);
    const rec = r.result.recommendations[0];
    assert.ok(Number.isFinite(rec.currentWeight) && rec.currentWeight === 0);
    assert.ok(Number.isFinite(rec.recommendedWeight));
    assertNoNonFinite(r.result);
  });
});

// ── bodyCompReport — BMI + Navy body-fat (safety-critical) ──────────────────
describe("fitness.bodyCompReport — BMI/body-fat bands + fail-closed numerics", () => {
  it("computes a known metric BMI and category", () => {
    // 80 kg / (1.80 m)^2 = 24.69 → 'normal'
    const r = callArtifact("bodyCompReport", ctxA, { weight: 80, height: 180, unit: "metric", age: 30, sex: "male" });
    assert.equal(r.ok, true);
    assert.equal(r.result.bmi, 24.7);
    assert.equal(r.result.bmiCategory, "normal");
    assertNoNonFinite(r.result);
  });

  it("estimates Navy body-fat for a valid male measurement set", () => {
    const r = callArtifact("bodyCompReport", ctxA, { weight: 80, height: 180, unit: "metric", sex: "male", waist: 85, neck: 38 });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.bodyFatPct));
    assert.ok(r.result.bodyFatPct > 0 && r.result.bodyFatPct < 50);
    assert.ok(Number.isFinite(r.result.leanMass.kg));
    assertNoNonFinite(r.result);
  });

  it("degrade-graceful: waist ≤ neck (log10 of ≤0) → bodyFatPct null, never NaN", () => {
    const r = callArtifact("bodyCompReport", ctxA, { weight: 80, height: 180, unit: "metric", sex: "male", waist: 30, neck: 40 });
    assert.equal(r.ok, true);
    assert.equal(r.result.bodyFatPct, null);
    assert.equal(r.result.fatMass, null);
    assertNoNonFinite(r.result);
  });

  it("fail-CLOSED: poisoned 1e999 weight/height/NaN age → finite output, never Infinity BMI", () => {
    const r = callArtifact("bodyCompReport", ctxA, { weight: "1e999", height: Infinity, age: "NaN", unit: "metric" });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.bmi));
    assert.ok(Number.isFinite(r.result.age));
    assertNoNonFinite(r.result);
  });
});

// ── periodization — phase weeks sum to total ────────────────────────────────
describe("fitness.periodization — phase plan the Action-Result panel renders", () => {
  it("builds a 12-week strength macrocycle whose phases sum to the total", () => {
    const r = callArtifact("periodization", ctxA, {}, { weeks: 12, goal: "strength" });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalWeeks, 12);
    assert.equal(r.result.goal, "strength");
    const sum = r.result.phases.reduce((s, p) => s + p.weeks, 0);
    assert.equal(sum, 12, "phase weeks must sum to the total");
    for (const p of r.result.phases) {
      for (const k of ["name", "weeks", "sets", "reps", "intensity"]) assert.ok(k in p, `phase missing ${k}`);
    }
    assertNoNonFinite(r.result);
  });

  it("fail-CLOSED: poisoned 1e999 weeks → clamped to 12, phases finite", () => {
    const r = callArtifact("periodization", ctxA, {}, { weeks: "1e999", goal: "general" });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalWeeks, 12);
    assertNoNonFinite(r.result);
  });
});

// ── classUtilization — % full + period filter ───────────────────────────────
describe("fitness.classUtilization — utilization the Action-Result renders", () => {
  it("computes utilization % from a recent attendance log", () => {
    const today = new Date().toISOString().slice(0, 10);
    const r = callArtifact("classUtilization", ctxA,
      { capacity: 20, enrolled: 18, attendanceLog: [{ date: today, count: 15 }, { date: today, count: 13 }] },
      { period: 30 });
    assert.equal(r.ok, true);
    // avg(15,13)=14, 14/20 = 70%
    assert.equal(r.result.avgAttendance, 14);
    assert.equal(r.result.utilization, 70);
    assert.equal(r.result.sessions, 2);
    assertNoNonFinite(r.result);
  });

  it("fail-CLOSED: poisoned capacity/count → finite utilization, no div-by-zero leak", () => {
    const r = callArtifact("classUtilization", ctxA,
      { capacity: "1e999", enrolled: "NaN", attendanceLog: [{ date: new Date().toISOString().slice(0, 10), count: Infinity }] },
      { period: "Infinity" });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.utilization));
    assertNoNonFinite(r.result);
  });
});

// ── hr-zones — Tanaka/Fox max HR + Karvonen reserve (the rendered contract) ──
describe("fitness.hr-zones — max HR formulas + zone bands HeartRateZones renders", () => {
  it("Fox: maxHr = 220 − age, 5 zones each carrying the rendered fields", () => {
    const r = call("hr-zones", ctxA, { age: 40, restingHr: 60, method: "fox" });
    assert.equal(r.ok, true);
    assert.equal(r.result.maxHr, 180);     // 220 − 40
    assert.equal(r.result.method, "fox");
    assert.equal(r.result.zones.length, 5);
    for (const z of r.result.zones) {
      for (const k of ["zone", "name", "lowBpm", "highBpm", "pctOfMax", "purpose", "weeklyMinutesTarget", "weeklyMinutesActual"]) {
        assert.ok(k in z, `zone missing rendered field ${k}`);
      }
      assert.ok(z.lowBpm <= z.highBpm, "zone band must not invert");
    }
    assertNoNonFinite(r.result);
  });

  it("Tanaka: maxHr = round(208 − 0.7×age)", () => {
    // 208 − 0.7*30 = 187
    const r = call("hr-zones", ctxA, { age: 30, restingHr: 55, method: "tanaka" });
    assert.equal(r.result.maxHr, 187);
  });

  it("Karvonen: zone bpm uses HR reserve (resting + reserve×pct)", () => {
    // tanaka max for 30 = 187, reserve = 187−50 = 137; zone1 low = 50 + 137*0.5 = 118.5 → 119
    const r = call("hr-zones", ctxA, { age: 30, restingHr: 50, method: "karvonen" });
    assert.equal(r.result.zones[0].lowBpm, 119);
  });

  it("fail-CLOSED: poisoned age/restingHr are clamped, zones stay finite", () => {
    const r = call("hr-zones", ctxA, { age: Infinity, restingHr: "1e999", method: "tanaka" });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.maxHr));
    assertNoNonFinite(r.result);
  });
});

// ── workout-plan-generate — deterministic plan the WorkoutPlanner renders ────
describe("fitness.workout-plan-generate / generate-program — deterministic plan", () => {
  it("builds a plan with the EXACT shape WorkoutPlanner reads (template/progression/nutrition)", async () => {
    const r = await call("workout-plan-generate", ctxA, { goal: "strength", daysPerWeek: 3, weeks: 8, equipment: "full_gym", experience: "intermediate" });
    assert.equal(r.ok, true);
    const plan = r.result.plan;
    assert.equal(plan.goal, "strength");
    assert.equal(plan.weeks, 8);
    assert.equal(plan.daysPerWeek, 3);
    assert.equal(plan.template.length, 3);
    assert.ok(typeof plan.progression === "string" && plan.progression.length > 0);
    assert.ok(typeof plan.nutrition === "string" && plan.nutrition.length > 0);
    for (const day of plan.template) {
      for (const k of ["day", "focus", "duration", "exercises"]) assert.ok(k in day, `day missing ${k}`);
      for (const ex of day.exercises) {
        for (const k of ["name", "sets", "reps", "restSec"]) assert.ok(k in ex, `exercise missing ${k}`);
      }
    }
  });

  it("generate-program (page alias) merges artifact.data + params and produces a plan", async () => {
    const r = await call("generate-program", ctxA, { artifact: { data: { goal: "hypertrophy", daysPerWeek: 4 } } });
    assert.equal(r.ok, true);
    assert.equal(r.result.plan.goal, "hypertrophy");
    assert.equal(r.result.plan.daysPerWeek, 4);
  });

  it("clamps an out-of-range/poisoned daysPerWeek to the 1–7 split", async () => {
    const r = await call("workout-plan-generate", ctxA, { goal: "general", daysPerWeek: "1e999", weeks: Infinity });
    assert.equal(r.ok, true);
    assert.ok(r.result.plan.daysPerWeek >= 1 && r.result.plan.daysPerWeek <= 7);
    assert.ok(r.result.plan.weeks >= 1 && r.result.plan.weeks <= 24);
  });
});

// ── activity CRUD round-trip + computed metrics ─────────────────────────────
describe("fitness.activity-* — Strava activity round-trip + relative effort", () => {
  it("creates a run, computes pace/speed/relativeEffort, lists + details it back", () => {
    const ctx = { actor: { userId: "fit_act_u" }, userId: "fit_act_u" };
    const created = call("activity-create", ctx, { type: "run", distanceKm: 10, durationSec: 3000, avgHr: 150, maxHr: 190, date: "2026-06-20" });
    assert.equal(created.ok, true);
    const act = created.result.activity;
    assert.equal(act.type, "run");
    assert.equal(act.distanceKm, 10);
    assert.equal(act.paceSecPerKm, 300);                  // 3000s / 10km
    assert.equal(act.speedKmh, 12);                       // 10 / (3000/3600)
    assert.ok(act.relativeEffort > 0);

    const list = call("activity-list", ctx, {});
    assert.equal(list.result.count, 1);
    assert.equal(list.result.totalDistanceKm, 10);

    const detail = call("activity-detail", ctx, { id: act.id });
    assert.equal(detail.result.activity.pace, "5:00");    // 300 s/km → 5:00
    assert.equal(detail.result.activity.duration, "50:00");

    const del = call("activity-delete", ctx, { id: act.id });
    assert.equal(del.result.deleted, act.id);
    assert.equal(call("activity-list", ctx, {}).result.count, 0);
  });

  it("is per-user isolated", () => {
    call("activity-create", ctxA, { type: "ride", distanceKm: 20, durationSec: 3600 });
    assert.equal(call("activity-list", ctxB, {}).result.count, 0);
  });

  it("validation-rejection: bad type + zero duration", () => {
    assert.match(call("activity-create", ctxA, { type: "teleport", durationSec: 100 }).error, /type required/i);
    assert.match(call("activity-create", ctxA, { type: "run", durationSec: 0 }).error, /durationSec must be > 0/i);
  });

  it("fail-CLOSED: poisoned distance/duration never leak Infinity into derived metrics", () => {
    const ctx = { actor: { userId: "fit_act_poison" }, userId: "fit_act_poison" };
    const r = call("activity-create", ctx, { type: "run", distanceKm: "1e999", durationSec: 1800, avgHr: Infinity });
    // distance coerces to a finite value (fnum) so the activity is valid…
    assert.equal(r.ok, true);
    assertNoNonFinite(r.result);
  });
});

// ── vo2max + race predictor — Daniels/Gilbert VDOT math ─────────────────────
describe("fitness.vo2max-estimate / race-predictor — VDOT physiology", () => {
  it("estimates VO2max from a supplied effort and predicts race times", () => {
    // 5km in 1200s (20:00) → a finite, rated VO2max
    const vo = call("vo2max-estimate", ctxA, { distanceKm: 5, durationSec: 1200, age: 30 });
    assert.equal(vo.ok, true);
    assert.ok(Number.isFinite(vo.result.vo2max) && vo.result.vo2max > 0);
    assert.ok(["superior", "excellent", "good", "fair", "poor"].includes(vo.result.rating));
    assert.ok(Number.isFinite(vo.result.fitnessAge));
    assertNoNonFinite(vo.result);

    const race = call("race-predictor", ctxA, { vo2max: vo.result.vo2max });
    assert.equal(race.ok, true);
    assert.equal(race.result.predictions.length, 4);
    for (const p of race.result.predictions) {
      assert.ok(Number.isFinite(p.timeSeconds) && p.timeSeconds > 0, p.distance);
      assert.ok(typeof p.time === "string" && p.time.length > 0);
    }
    // longer races take longer
    const byName = Object.fromEntries(race.result.predictions.map((p) => [p.distance, p.timeSeconds]));
    assert.ok(byName["Marathon"] > byName["5K"]);
    assertNoNonFinite(race.result);
  });

  it("validation-rejection: no effort + no logged run", () => {
    const ctx = { actor: { userId: "fit_vo_empty" }, userId: "fit_vo_empty" };
    assert.match(call("vo2max-estimate", ctx, {}).error, /supply distanceKm/i);
    assert.match(call("race-predictor", ctx, {}).error, /supply vo2max/i);
  });
});

// ── training load + readiness + body battery ────────────────────────────────
describe("fitness.training-load / training-readiness / body-battery", () => {
  it("computes CTL/ATL/TSB form status from logged activities", () => {
    const ctx = { actor: { userId: "fit_load_u" }, userId: "fit_load_u" };
    for (let d = 1; d <= 10; d++) {
      call("activity-create", ctx, { type: "run", distanceKm: 8, durationSec: 2400, avgHr: 150, date: `2026-06-${String(d).padStart(2, "0")}` });
    }
    const tl = call("training-load", ctx, {});
    assert.equal(tl.ok, true);
    for (const k of ["fitness", "fatigue", "form", "status", "trackedDays"]) assert.ok(k in tl.result, `missing ${k}`);
    assert.ok(Number.isFinite(tl.result.fitness));
    assertNoNonFinite(tl.result);
  });

  it("training-readiness clamps to 1–100 and labels", () => {
    const ctx = { actor: { userId: "fit_ready_u" }, userId: "fit_ready_u" };
    const r = call("training-readiness", ctx, { sleepHours: 8 });
    assert.equal(r.ok, true);
    assert.ok(r.result.score >= 1 && r.result.score <= 100);
    assert.ok(["prime", "ready", "moderate", "low", "poor"].includes(r.result.label));
    assertNoNonFinite(r.result);
  });

  it("body-battery clamps to 5–100 from sleep + load", () => {
    const ctx = { actor: { userId: "fit_batt_u" }, userId: "fit_batt_u" };
    const r = call("body-battery", ctx, { sleepHours: 7 });
    assert.equal(r.ok, true);
    assert.ok(r.result.battery >= 5 && r.result.battery <= 100);
    assertNoNonFinite(r.result);
  });
});

// ── goals + gear + dashboard round-trip ─────────────────────────────────────
describe("fitness.goal-* / gear-* / fitness-dashboard — STATE round-trips", () => {
  it("creates a distance goal and reports progress against logged activities", () => {
    const ctx = { actor: { userId: "fit_goal_u" }, userId: "fit_goal_u" };
    const today = new Date().toISOString().slice(0, 10);
    call("activity-create", ctx, { type: "run", distanceKm: 15, durationSec: 4500, date: today });
    const goal = call("goal-create", ctx, { metric: "distance", target: 30, period: "week" });
    assert.equal(goal.ok, true);
    const list = call("goal-list", ctx, {});
    assert.equal(list.result.count, 1);
    assert.equal(list.result.goals[0].progress.value, 15);
    assert.equal(list.result.goals[0].progress.pct, 50);
    assertNoNonFinite(list.result);
  });

  it("validation-rejection: bad goal metric + non-positive target", () => {
    assert.match(call("goal-create", ctxA, { metric: "vibes", target: 10 }).error, /metric required/i);
    assert.match(call("goal-create", ctxA, { metric: "distance", target: 0 }).error, /target must be > 0/i);
  });

  it("gear wear tracking + dashboard aggregation", () => {
    const ctx = { actor: { userId: "fit_gear_u" }, userId: "fit_gear_u" };
    const gear = call("gear-add", ctx, { name: "Vaporfly", kind: "shoes", retireAtKm: 100, initialDistanceKm: 90 }).result.gear;
    const listed = call("gear-list", ctx, {}).result.gear[0];
    assert.equal(listed.wearPct, 90);
    assert.equal(listed.status, "wearing_out");
    const dash = call("fitness-dashboard", ctx, {});
    assert.equal(dash.ok, true);
    assert.equal(dash.result.gear.tracked, 1);
    assertNoNonFinite(dash.result);
    assert.ok(gear.id);
  });
});

// ── recovery-history / activity-summary FIELD-ALIGNMENT contract ────────────
// The SleepRecovery + ActivityRings components render names that the stored
// device rows do NOT carry. These pin that the handler emits the RENDERED shape
// (so a regression that reverts to device-native keys → blank/crash UI surfaces).
describe("fitness.recovery-history — emits the SleepRecovery field contract", () => {
  it("maps a synced device row to recoveryScore/sleepDurationHours/restingHr/hrv/strainYesterday", () => {
    const ctx = { actor: { userId: "fit_recov_u" }, userId: "fit_recov_u" };
    call("wearable-link", ctx, { provider: "whoop" });
    const sync = call("wearable-sync", ctx, { provider: "whoop", samples: [
      { date: "2026-06-26", restingHr: 52, hrv: 60, sleepHours: 7.0, recoveryScore: 70 },
      { date: "2026-06-27", restingHr: 50, hrv: 65, sleepHours: 7.5, recoveryScore: 80 },
    ] });
    assert.equal(sync.ok, true);
    const r = call("recovery-history", ctx, { days: 14 });
    assert.equal(r.ok, true);
    assert.equal(r.result.source, "device");
    const last = r.result.days[r.result.days.length - 1];
    // EXACT field names SleepRecovery.tsx renders (the dead-surface contract)
    for (const k of ["date", "recoveryScore", "sleepDurationHours", "sleepQualityPct", "restingHr", "hrv", "strainYesterday"]) {
      assert.ok(k in last, `recovery row missing rendered field ${k}`);
    }
    assert.equal(last.recoveryScore, 80);
    assert.equal(last.sleepDurationHours, 7.5);
    assert.equal(last.restingHr, 50);
    assert.equal(last.hrv, 65);
    assertNoNonFinite(r.result);
  });

  it("empty → honest 'empty' source + guidance note, no fabricated rows", () => {
    const ctx = { actor: { userId: "fit_recov_empty" }, userId: "fit_recov_empty" };
    const r = call("recovery-history", ctx, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.days.length, 0);
    assert.equal(r.result.source, "empty");
    assert.match(r.result.notes, /connect a wearable/i);
  });
});

describe("fitness.activity-summary — emits the ActivityRings field contract", () => {
  it("maps a synced device row to moveCalories/moveGoal/exerciseMinutes/standHours/steps + goals", () => {
    const ctx = { actor: { userId: "fit_rings_u" }, userId: "fit_rings_u" };
    call("wearable-link", ctx, { provider: "apple_health" });
    call("wearable-sync", ctx, { provider: "apple_health", samples: [
      { date: "2026-06-27", steps: 9000, activeCalories: 500, exerciseMinutes: 40 },
    ] });
    const r = call("activity-summary", ctx, { days: 7 });
    assert.equal(r.ok, true);
    const last = r.result.days[r.result.days.length - 1];
    for (const k of ["date", "moveCalories", "moveGoal", "exerciseMinutes", "exerciseGoal", "standHours", "standGoal", "steps", "stepsGoal"]) {
      assert.ok(k in last, `activity row missing rendered field ${k}`);
    }
    assert.equal(last.moveCalories, 500);   // activeCalories surfaced as moveCalories
    assert.equal(last.exerciseMinutes, 40);
    assert.equal(last.steps, 9000);
    assert.ok(last.moveGoal >= 1 && last.exerciseGoal >= 1 && last.standGoal >= 1 && last.stepsGoal >= 1);
    assertNoNonFinite(r.result);
  });

  it("empty → honest 'empty' source, no fabricated rings", () => {
    const ctx = { actor: { userId: "fit_rings_empty" }, userId: "fit_rings_empty" };
    const r = call("activity-summary", ctx, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.days.length, 0);
    assert.equal(r.result.source, "empty");
  });
});

// ── segments + leaderboard + PR detection ───────────────────────────────────
describe("fitness.segment-* — effort PR/CR detection + leaderboard ranking", () => {
  it("creates a segment, records efforts, flags PR/CR + ranks the leaderboard", () => {
    const ctx = { actor: { userId: "fit_seg_u" }, userId: "fit_seg_u" };
    const seg = call("segment-create", ctx, { name: "Hill Climb", distanceKm: 2, gradePct: 8 }).result.segment;
    const e1 = call("segment-effort", ctx, { segmentId: seg.id, timeSeconds: 600 });
    assert.equal(e1.result.isPR, true);
    assert.equal(e1.result.isCourseRecord, true);
    const e2 = call("segment-effort", ctx, { segmentId: seg.id, timeSeconds: 560 });
    assert.equal(e2.result.isPR, true);            // faster than my prior best
    const lb = call("segment-leaderboard", ctx, { segmentId: seg.id });
    assert.equal(lb.result.leaderboard[0].timeSeconds, 560);
    assert.equal(lb.result.leaderboard[0].title, "CR");
    assertNoNonFinite(lb.result);
  });

  it("validation-rejection: missing name + zero distance + missing segment", () => {
    assert.match(call("segment-create", ctxA, { distanceKm: 1 }).error, /name required/i);
    assert.match(call("segment-create", ctxA, { name: "x", distanceKm: 0 }).error, /distanceKm must be > 0/i);
    assert.match(call("segment-effort", ctxA, { segmentId: "nope", timeSeconds: 10 }).error, /segment not found/i);
  });
});

// ── double-wrap dispatch parity — the dead-surface bug class ─────────────────
// The lensRun-driven macros (hr-zones / workout-plan-generate / activity-*) flow
// through /api/lens/run, which peels exactly one sole-key { artifact:{ data } }
// wrapper. These pin that a wrapped body resolves identically to flat input (so
// a component that double-wraps doesn't silently blank the calculator).
describe("fitness — { artifact:{ data } } sole-key wrapper is peeled like production", () => {
  it("hr-zones reads through a sole-key artifact wrapper identically to flat input", () => {
    const wrapped = call("hr-zones", ctxA, { artifact: { data: { age: 40, restingHr: 60, method: "fox" } } });
    const flat = call("hr-zones", ctxA, { age: 40, restingHr: 60, method: "fox" });
    assert.equal(wrapped.result.maxHr, 180);
    assert.deepEqual(wrapped.result, flat.result);
  });

  it("workout-plan-generate reads through the wrapper (the historical blank-calc bug)", async () => {
    const wrapped = await call("workout-plan-generate", ctxA, { artifact: { data: { goal: "endurance", daysPerWeek: 5, weeks: 6 } } });
    assert.equal(wrapped.ok, true);
    assert.equal(wrapped.result.plan.goal, "endurance");
    assert.equal(wrapped.result.plan.daysPerWeek, 5);
  });

  it("the artifact-dispatch macros (progressionCalc) read artifact.data + params, NOT input", () => {
    // The Quick-Action macros are invoked via lens.run / :id/run which loads the
    // REAL artifact and passes handler(ctx, artifact, params): data on
    // artifact.data, never as the input body. Pin the production contract.
    const r = callArtifact("progressionCalc", ctxA, { exercises: [{ name: "Squat", weight: 100, reps: 5, rpe: 6 }] });
    assert.equal(r.result.recommendations[0].recommendedWeight, 105);
  });
});
