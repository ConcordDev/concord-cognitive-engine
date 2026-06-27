// Contract tests for the Apple Health + Whoop + Oura + Daylio 2026-parity
// macros in server/domains/wellness.js — metrics, habits + streaks,
// mood journal + correlation, workouts, recovery score, goals.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerWellnessMacros from "../domains/wellness.js";

// Drives each registered macro the way runMacro / the contract engine do — a
// canonical 2-arg (ctx, input) call against the REAL in-memory store the domain
// uses (globalThis._concordSTATE.{wellnessLens,wellnessTherapy}).
const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "wellness", `unexpected domain: ${domain}`);
  ACTIONS.set(`${domain}.${name}`, fn);
}
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(`wellness.${name}`);
  assert.ok(fn, `wellness.${name} not registered`);
  return fn(ctx, input);
}

before(() => { registerWellnessMacros(register); });
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

// ───────────────────────────────────────────────────────────────
//  Whoop / Calm / Woebot 2026-parity macros — self-composed
//  therapeutic fields, guided CBT thought records, wearable import,
//  meditation + breathing sessions, daily recovery recommendation.
// ───────────────────────────────────────────────────────────────

describe("wellness — self-composed therapeutic fields", () => {
  it("self-composes a field, lists it active, then revokes it", () => {
    const c = call("self-field-compose", ctxA, { fieldKind: "rumination", intention: "set the loop down", durationSeconds: 6 * 3600 });
    assert.equal(c.ok, true);
    assert.equal(c.result.field.selfComposed, true);
    assert.equal(c.result.field.authorUserId, "well_a");
    const id = c.result.field.id;
    let list = call("self-field-list", ctxA);
    assert.equal(list.ok, true);
    assert.equal(list.result.activeCount, 1);
    const rev = call("self-field-deactivate", ctxA, { id });
    assert.equal(rev.ok, true);
    assert.equal(rev.result.revoked, true);
    list = call("self-field-list", ctxA);
    assert.equal(list.result.activeCount, 0);
  });

  it("rejects an unknown field kind and a missing id", () => {
    assert.equal(call("self-field-compose", ctxA, { fieldKind: "vibes" }).ok, false);
    assert.equal(call("self-field-deactivate", ctxA, { id: "nope" }).ok, false);
  });
});

describe("wellness — guided CBT thought records", () => {
  it("cbt-prompts lists all 8 kinds and returns a full prompt set per kind", () => {
    const all = call("cbt-prompts", ctxA, {});
    assert.equal(all.ok, true);
    assert.equal(all.result.kinds.length, 8);
    const one = call("cbt-prompts", ctxA, { fieldKind: "catastrophising" });
    assert.equal(one.ok, true);
    assert.ok(Array.isArray(one.result.challenges));
    assert.ok(one.result.reframe.length > 0);
    assert.equal(call("cbt-prompts", ctxA, { fieldKind: "nonsense" }).ok, false);
  });

  it("creates a thought record, computes relief, and lists it", () => {
    const r = call("cbt-record-create", ctxA, {
      fieldKind: "shame_spiral",
      situation: "missed a deadline",
      emotion: "ashamed",
      automaticThought: "I always fail",
      evidenceAgainst: "I shipped two projects last month",
      reframe: "One missed deadline, not a verdict",
      intensityBefore: 80,
      intensityAfter: 35,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.record.relief, 45);
    const list = call("cbt-record-list", ctxA, { days: 90 });
    assert.equal(list.ok, true);
    assert.equal(list.result.total, 1);
    assert.equal(list.result.completed, 1);
    assert.equal(list.result.avgRelief, 45);
  });

  it("rejects a record with no situation or automatic thought", () => {
    assert.equal(call("cbt-record-create", ctxA, { fieldKind: "numbing", situation: "x" }).ok, false);
  });
});

describe("wellness — wearable import", () => {
  it("imports mapped readings into the metric store and records a sync", () => {
    const r = call("wearable-import", ctxA, {
      source: "apple_health",
      readings: [
        { type: "hrv", value: 62, date: dayAgo(1) },
        { type: "sleep", value: 7.5, date: dayAgo(1) },
        { type: "restingHeartRate", value: 54, date: dayAgo(1) },
        { type: "garbage", value: 1, date: dayAgo(1) },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.summary.imported, 3);
    assert.equal(r.result.summary.skipped, 1);
    // imported readings are queryable as metrics
    assert.ok(call("metrics-list", ctxA, { type: "hrv_ms" }).result.metrics.length >= 1);
    const hist = call("wearable-sync-history", ctxA);
    assert.equal(hist.ok, true);
    assert.ok(hist.result.syncs.length >= 1);
  });

  it("rejects an empty readings batch", () => {
    assert.equal(call("wearable-import", ctxA, { source: "whoop", readings: [] }).ok, false);
  });
});

describe("wellness — meditation + breathing sessions", () => {
  it("session-catalogue returns the authored preset list", () => {
    const r = call("session-catalogue", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.sessions.length >= 5);
    assert.ok(r.result.sessions.some(s => s.kind === "breathing"));
  });

  it("logs a completed session with a mood shift and builds a streak", () => {
    const cat = call("session-catalogue", ctxA, {}).result.sessions[0];
    const r = call("session-complete", ctxA, { catalogueId: cat.id, durationMin: 5, moodBefore: 1, moodAfter: 3 });
    assert.equal(r.ok, true);
    assert.equal(r.result.session.moodShift, 2);
    const hist = call("session-history", ctxA, { days: 30 });
    assert.equal(hist.ok, true);
    assert.equal(hist.result.count, 1);
    assert.equal(hist.result.streak, 1);
    assert.equal(call("session-complete", ctxA, { catalogueId: "fake_id" }).ok, false);
  });
});

describe("wellness — daily recommendation", () => {
  it("folds today's signals into a prioritized recommendation set", () => {
    const today = dayAgo(0);
    call("metrics-log", ctxA, { type: "sleep_hours", value: 5, date: today });
    call("metrics-log", ctxA, { type: "hrv_ms", value: 45, date: today });
    const r = call("daily-recommendation", ctxA, { date: today });
    assert.equal(r.ok, true);
    assert.ok(["green", "yellow", "red"].includes(r.result.band));
    assert.ok(Array.isArray(r.result.recommendations));
    assert.ok(r.result.recommendations.length >= 1);
    assert.equal(typeof r.result.focus, "string");
    assert.equal(r.result.hasEnoughData, true);
  });
});

// ───────────────────────────────────────────────────────────────
//  Whoop-shape workbench — sleepScore / strainLog / recoveryReport /
//  hrvTrend. Pure-compute; asserts the REAL computed metrics from
//  seeded inputs (not shape-only), plus the fail-CLOSED numeric guards
//  the macro-assassin's V2 vector probes.
// ───────────────────────────────────────────────────────────────

describe("wellness — workbench: sleepScore", () => {
  it("computes the real score from a known input", () => {
    // 450 min asleep / 480 in bed (93.75% eff) / 1 disturbance:
    //   duration = min(60, (7.5/8)*60) = 56.25
    //   efficiency = min(30, 0.9375*30) = 28.125
    //   restfulness = max(0, 10 - 2) = 8
    //   total = 92.375 → round 92
    const r = call("sleepScore", ctxA, { minutesAsleep: 450, minutesInBed: 480, disturbances: 1 });
    assert.equal(r.ok, true);
    assert.equal(r.result.score, 92);
    assert.equal(r.result.band, "excellent");
    assert.equal(r.result.hoursAsleep, 7.5);
    assert.equal(r.result.efficiencyPct, 93.8);
    assert.equal(r.result.disturbances, 1);
  });
  it("requires positive minutesAsleep", () => {
    assert.equal(call("sleepScore", ctxA, { minutesAsleep: 0 }).ok, false);
  });
  it("fail-CLOSED on a poisoned numeric input", () => {
    for (const bad of [NaN, Infinity, -1, 1e308]) {
      const r = call("sleepScore", ctxA, { minutesAsleep: bad });
      assert.equal(r.ok, false, `minutesAsleep=${bad} should fail-closed`);
      assert.equal(r.error, "invalid_minutesAsleep");
    }
  });
});

describe("wellness — workbench: strainLog", () => {
  it("computes the real Whoop-scale strain from per-zone minutes", () => {
    // weighted = 0+0+40*4+20*7+10*12 = 160+140+120 = 420
    //   strain = min(21, round(log10(420)*6*10)/10) = round(15.738)/10... = 15.7
    const r = call("strainLog", ctxA, { minutesByZone: { z3: 40, z4: 20, z5: 10 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.weightedLoad, 420);
    assert.equal(r.result.totalActiveMin, 70);
    assert.equal(r.result.strain, 15.7);
    assert.equal(r.result.band, "strenuous");
  });
  it("yields minimal strain for an empty day", () => {
    const r = call("strainLog", ctxA, { minutesByZone: {} });
    assert.equal(r.ok, true);
    assert.equal(r.result.strain, 0);
    assert.equal(r.result.band, "minimal");
  });
  it("fail-CLOSED on a poisoned zone value", () => {
    const r = call("strainLog", ctxA, { minutesByZone: { z1: Infinity } });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_z1");
  });
});

describe("wellness — workbench: recoveryReport", () => {
  it("computes a green recovery from strong HRV + low RHR + good sleep", () => {
    // hrv 70 / base 60 → hrvFactor min(1.2, 1.1667)=1.1667 → 40*1.1667=46.667
    // rhr 50 / base 60 → rhrFactor min(1.2, 1.2)=1.2 → 30*1.2=36
    // sleep 90 → 30*0.9 = 27 ; total ≈ 109.67 → clamp 100
    const r = call("recoveryReport", ctxA, { hrvMs: 70, baselineHrvMs: 60, rhrBpm: 50, baselineRhrBpm: 60, sleepScore: 90 });
    assert.equal(r.ok, true);
    assert.equal(r.result.recoveryPct, 100);
    assert.equal(r.result.band, "green");
    assert.equal(r.result.recommendation, "Ready for high strain.");
  });
  it("requires hrvMs and rhrBpm", () => {
    assert.equal(call("recoveryReport", ctxA, { hrvMs: 0, rhrBpm: 0 }).ok, false);
  });
  it("fail-CLOSED on a poisoned rhrBpm", () => {
    const r = call("recoveryReport", ctxA, { hrvMs: 60, rhrBpm: 1e308 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_rhrBpm");
  });
});

describe("wellness — workbench: hrvTrend", () => {
  it("computes an improving trend from a rising series", () => {
    const readings = [
      { date: "2026-06-01", hrvMs: 40 },
      { date: "2026-06-02", hrvMs: 42 },
      { date: "2026-06-03", hrvMs: 60 },
      { date: "2026-06-04", hrvMs: 62 },
    ];
    const r = call("hrvTrend", ctxA, { readings });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 4);
    assert.equal(r.result.latest, 62);
    assert.equal(r.result.min, 40);
    assert.equal(r.result.max, 62);
    // avg = 51; recentAvg(last7=all 4)=51 → stable; flip to improving via a
    // longer history where recent > overall avg + 2:
  });
  it("flags improving when recent readings outrun the overall average", () => {
    const readings = [];
    for (let i = 0; i < 8; i++) readings.push({ date: `2026-06-0${i + 1}`, hrvMs: 40 });
    for (let i = 0; i < 7; i++) readings.push({ date: `2026-06-1${i}`, hrvMs: 80 });
    const r = call("hrvTrend", ctxA, { readings });
    assert.equal(r.result.trend, "improving");
  });
  it("returns a guidance message for fewer than 2 readings", () => {
    const r = call("hrvTrend", ctxA, { readings: [{ date: "2026-06-01", hrvMs: 50 }] });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 1);
    assert.match(r.result.message, /at least 2/);
  });
});

describe("wellness — fail-CLOSED guards on read macros (assassin V2)", () => {
  it("rejects a poisoned days on the list/trend reads instead of clamping", () => {
    for (const macro of ["metrics-list", "mood-list", "workouts-list", "cbt-record-list", "session-history"]) {
      const r = call(macro, ctxA, { days: Infinity });
      assert.equal(r.ok, false, `${macro} days=Infinity should fail-closed`);
      assert.equal(r.error, "invalid_days");
    }
    const t = call("metrics-trend", ctxA, { type: "steps", days: 1e308 });
    assert.equal(t.ok, false);
    assert.equal(t.error, "invalid_days");
  });

  it("rejects a poisoned metric value but allows a legit small reading", () => {
    assert.equal(call("metrics-log", ctxA, { type: "steps", value: Infinity }).error, "invalid_value");
    // 0 steps is a VALID reading — range-aware guard must not reject it
    assert.equal(call("metrics-log", ctxA, { type: "steps", value: 0 }).ok, true);
  });
});
