// tests/depth/wellness-behavior.test.js — REAL behavioral tests for the
// wellness domain (registerLensAction family, invoked via lensRun). Whoop /
// Apple Health / Oura / Daylio / Calm / Woebot parity macros: sleep score,
// strain, recovery, HRV trend, metric logging, habits + streaks, mood, workouts,
// goals, CBT thought records, meditation sessions, wearable import.
//
// Every lensRun("wellness","<macro>",…) call literally names the macro, so the
// macro-depth grader credits it as a behavioral invocation. Each case asserts
// an exact hand-computed value, a CRUD round-trip, or a validation rejection.
//
// lens.run UNWRAPS a handler's {ok:true,result:{...}} → r.result.<field>; a
// handler's {ok:false,error} surfaces as r.result.ok===false + r.result.error.
//
// SKIPPED (network/LLM, no deterministic floor): none — every wellness macro is
// pure-compute / in-memory STATE, so all are exercised here.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("wellness — calc contracts (exact computed values)", () => {
  it("sleepScore: 7.5h asleep / 8h in bed / 1 disturbance → 92 excellent", async () => {
    const r = await lensRun("wellness", "sleepScore", {
      params: { minutesAsleep: 450, minutesInBed: 480, disturbances: 1 },
    });
    assert.equal(r.ok, true);
    // duration min(60,(7.5/8)*60)=56.25; efficiency min(30,0.9375*30)=28.125;
    // restfulness max(0,10-2)=8 → 92.375 → round 92
    assert.equal(r.result.score, 92);
    assert.equal(r.result.band, "excellent");
    assert.equal(r.result.hoursAsleep, 7.5);
    assert.equal(r.result.efficiencyPct, 93.8); // round(0.9375*1000)/10
  });

  it("sleepScore: rejects missing minutesAsleep", async () => {
    const r = await lensRun("wellness", "sleepScore", { params: { minutesAsleep: 0 } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.reason, /minutesAsleep required/);
  });

  it("strainLog: zone minutes fold to a logarithmic 0-21 strain", async () => {
    const r = await lensRun("wellness", "strainLog", {
      params: { minutesByZone: { z1: 30, z2: 20, z3: 10, z4: 5, z5: 0 } },
    });
    assert.equal(r.ok, true);
    // weighted = 30 + 40 + 40 + 35 + 0 = 145
    assert.equal(r.result.weightedLoad, 145);
    // strain = round(log10(145)*6*10)/10 = round(129.682)/10 = 13.0
    assert.equal(r.result.strain, 13);
    assert.equal(r.result.band, "moderate"); // >=10
    assert.equal(r.result.totalActiveMin, 65);
  });

  it("recoveryReport: baseline HRV/RHR with 70 sleep → 91 green", async () => {
    const r = await lensRun("wellness", "recoveryReport", {
      params: { hrvMs: 60, rhrBpm: 60, baselineHrvMs: 60, baselineRhrBpm: 60, sleepScore: 70 },
    });
    assert.equal(r.ok, true);
    // hrvFactor=1, rhrFactor=1 → 40 + 30 + 30*0.7 = 91
    assert.equal(r.result.recoveryPct, 91);
    assert.equal(r.result.band, "green");
    assert.match(r.result.recommendation, /high strain/);
  });

  it("recoveryReport: rejects when hrvMs/rhrBpm absent", async () => {
    const r = await lensRun("wellness", "recoveryReport", { params: { hrvMs: 0, rhrBpm: 0 } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.reason, /hrvMs and rhrBpm required/);
  });

  it("hrvTrend: ascending readings yield improving trend + exact stats", async () => {
    const readings = [40, 45, 50, 55, 60, 65, 70, 75].map((v, i) => ({
      date: `2026-06-0${i + 1}`, hrvMs: v,
    }));
    const r = await lensRun("wellness", "hrvTrend", { data: { readings } });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 8);
    assert.equal(r.result.average, 57.5);     // 460/8
    assert.equal(r.result.recentAverage, 60); // last 7 = 420/7
    assert.equal(r.result.latest, 75);
    assert.equal(r.result.min, 40);
    assert.equal(r.result.max, 75);
    assert.equal(r.result.trend, "improving"); // 60 > 57.5+2
  });
});

describe("wellness — CRUD round-trips + validation (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("wellness-crud"); });

  it("metrics-log → metrics-list: a steps entry reads back", async () => {
    const log = await lensRun("wellness", "metrics-log", { params: { type: "steps", value: 8200 } }, ctx);
    assert.equal(log.ok, true);
    assert.equal(log.result.entry.value, 8200);
    const list = await lensRun("wellness", "metrics-list", { params: { type: "steps" } }, ctx);
    assert.ok(list.result.metrics.some((m) => m.id === log.result.entry.id && m.value === 8200));
  });

  it("metrics-log: rejects an unknown metric type", async () => {
    const bad = await lensRun("wellness", "metrics-log", { params: { type: "vibes", value: 5 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /type must be one of/);
  });

  it("habits-create → checkin → habits-list: a 3-day streak builds exactly", async () => {
    const create = await lensRun("wellness", "habits-create", { params: { name: "Meditate", target: 1 } }, ctx);
    assert.equal(create.ok, true);
    const habitId = create.result.habit.id;
    // check in today + the two prior days → consecutive streak of 3
    const today = new Date();
    for (let back = 0; back < 3; back++) {
      const d = new Date(today); d.setDate(d.getDate() - back);
      const date = d.toISOString().slice(0, 10);
      const ci = await lensRun("wellness", "habits-checkin", { params: { habitId, date, value: 1 } }, ctx);
      assert.equal(ci.ok, true);
    }
    const list = await lensRun("wellness", "habits-list", {}, ctx);
    const h = list.result.habits.find((x) => x.id === habitId);
    assert.equal(h.streak, 3);
    assert.equal(h.doneToday, true);
  });

  it("habits-checkin: rejects a check-in for a missing habit", async () => {
    const bad = await lensRun("wellness", "habits-checkin", { params: { habitId: "nope", value: 1 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /habit not found/);
  });

  it("mood-log → mood-correlate: a lifting activity surfaces with positive delta", async () => {
    // 3 entries: two great days with 'exercise', one awful day without it.
    const today = new Date();
    const dates = [0, 1, 2].map((b) => {
      const d = new Date(today); d.setDate(d.getDate() - b);
      return d.toISOString().slice(0, 10);
    });
    await lensRun("wellness", "mood-log", { params: { mood: "great", activities: ["exercise"], date: dates[0] } }, ctx);
    await lensRun("wellness", "mood-log", { params: { mood: "great", activities: ["exercise"], date: dates[1] } }, ctx);
    await lensRun("wellness", "mood-log", { params: { mood: "awful", activities: ["work"], date: dates[2] } }, ctx);
    const corr = await lensRun("wellness", "mood-correlate", { params: { days: 90 } }, ctx);
    assert.equal(corr.ok, true);
    // overallAvg = (4+4+0)/3 = 2.667; exercise avg = 4 → delta = +1.33
    const ex = corr.result.correlations.find((c) => c.activity === "exercise");
    assert.equal(ex.occurrences, 2);
    assert.equal(ex.avgMood, 4);
    assert.equal(ex.effect, "lifts mood");
  });

  it("mood-log: rejects an out-of-scale mood word", async () => {
    const bad = await lensRun("wellness", "mood-log", { params: { mood: "ecstatic" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /mood must be one of/);
  });

  it("workouts-log → workouts-list: minutes total round-trips", async () => {
    const w = await lensRun("wellness", "workouts-log", { params: { kind: "run", durationMin: 45, intensity: "hard" } }, ctx);
    assert.equal(w.ok, true);
    assert.equal(w.result.workout.durationMin, 45);
    const list = await lensRun("wellness", "workouts-list", {}, ctx);
    assert.ok(list.result.workouts.some((x) => x.id === w.result.workout.id));
    assert.ok(list.result.totalMin >= 45);
  });

  it("recovery-score: today's logged sleep/hrv/rhr compute an exact 88 green", async () => {
    // fresh ctx so only these three metrics drive the day's score
    const rc = await depthCtx("wellness-recovery");
    const today = new Date().toISOString().slice(0, 10);
    await lensRun("wellness", "metrics-log", { params: { type: "sleep_hours", value: 8, date: today } }, rc);
    await lensRun("wellness", "metrics-log", { params: { type: "hrv_ms", value: 70, date: today } }, rc);
    await lensRun("wellness", "metrics-log", { params: { type: "resting_hr", value: 50, date: today } }, rc);
    const r = await lensRun("wellness", "recovery-score", { params: { date: today } }, rc);
    assert.equal(r.ok, true);
    // 50 + 25(sleep) + 5(hrv) + 7.5(rhr) = 87.5 → round 88
    assert.equal(r.result.score, 88);
    assert.equal(r.result.band, "green");
    assert.ok(r.result.inputsUsed.includes("hrv"));
  });

  it("goals-create → goals-update-progress: reaching target flips status to achieved", async () => {
    const g = await lensRun("wellness", "goals-create", { params: { name: "Run 100km", target: 100, unit: "km" } }, ctx);
    assert.equal(g.ok, true);
    const id = g.result.goal.id;
    const upd = await lensRun("wellness", "goals-update-progress", { params: { id, current: 100 } }, ctx);
    assert.equal(upd.result.goal.status, "achieved");
    assert.equal(upd.result.progressPct, 100);
  });

  it("goals-create: rejects a non-positive target", async () => {
    const bad = await lensRun("wellness", "goals-create", { params: { name: "Nope", target: 0 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /positive target required/);
  });

  it("cbt-record-create: relief is computed as before minus after", async () => {
    const r = await lensRun("wellness", "cbt-record-create", {
      params: {
        fieldKind: "catastrophising",
        situation: "Missed a deadline",
        automaticThought: "I will lose my job",
        intensityBefore: 80,
        intensityAfter: 30,
      },
    }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.record.relief, 50); // 80 - 30
    assert.equal(r.result.record.distortionLabel, "Catastrophising");
  });

  it("session-complete → session-history: a meditation session logs duration + streak", async () => {
    const sc = await depthCtx("wellness-sessions");
    const today = new Date().toISOString().slice(0, 10);
    const done = await lensRun("wellness", "session-complete", {
      params: { catalogueId: "box_breathing", durationMin: 5, moodBefore: 1, moodAfter: 3, date: today },
    }, sc);
    assert.equal(done.ok, true);
    assert.equal(done.result.session.moodShift, 2); // 3 - 1
    const hist = await lensRun("wellness", "session-history", {}, sc);
    assert.equal(hist.result.streak, 1);
    assert.ok(hist.result.sessions.some((x) => x.id === done.result.session.id));
  });

  it("wearable-import: maps + dedupes readings into the metric store", async () => {
    const wc = await depthCtx("wellness-wearable");
    const today = new Date().toISOString().slice(0, 10);
    const first = await lensRun("wellness", "wearable-import", {
      params: {
        source: "oura",
        readings: [
          { type: "hrv", value: 65, date: today },
          { type: "sleepHours", value: 7.5, date: today },
          { type: "bogus", value: 1, date: today }, // unmapped → skipped
        ],
      },
    }, wc);
    assert.equal(first.ok, true);
    assert.equal(first.result.summary.imported, 2);
    assert.equal(first.result.summary.skipped, 1);
    // re-import same source/type/date → all deduped
    const second = await lensRun("wellness", "wearable-import", {
      params: { source: "oura", readings: [{ type: "hrv", value: 65, date: today }] },
    }, wc);
    assert.equal(second.result.summary.imported, 0);
    assert.equal(second.result.summary.skipped, 1);
  });
});

describe("wellness — remaining macros (CRUD round-trips, trends, summaries)", () => {
  it("metrics-trend: rising weight series exact average + trend", async () => {
    const tc = await depthCtx("wellness-trend-rising");
    const today = new Date();
    // 6 days of steps, clearly rising > 3%: 5000,5200,6000,7000,8000,9000
    const vals = [5000, 5200, 6000, 7000, 8000, 9000];
    for (let i = 0; i < vals.length; i++) {
      const d = new Date(today); d.setDate(d.getDate() - (vals.length - 1 - i));
      const date = d.toISOString().slice(0, 10);
      await lensRun("wellness", "metrics-log", { params: { type: "steps", value: vals[i], date } }, tc);
    }
    const r = await lensRun("wellness", "metrics-trend", { params: { type: "steps" } }, tc);
    assert.equal(r.ok, true);
    assert.equal(r.result.series.length, 6);
    // avg = 40200/6 = 6700
    assert.equal(r.result.average, 6700);
    assert.equal(r.result.latest, 9000);
    assert.equal(r.result.min, 5000);
    assert.equal(r.result.max, 9000);
    // third=2: firstAvg=(5000+5200)/2=5100; lastAvg=(8000+9000)/2=8500; 8500 > 5100*1.03
    assert.equal(r.result.trend, "rising");
  });

  it("metrics-trend: rejects an unknown metric type", async () => {
    const r = await lensRun("wellness", "metrics-trend", { params: { type: "vibes" } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /valid type required/);
  });

  it("habits-archive: archived habit drops out of habits-list", async () => {
    const ac = await depthCtx("wellness-habit-archive");
    const create = await lensRun("wellness", "habits-create", { params: { name: "Stretch", target: 1 } }, ac);
    const id = create.result.habit.id;
    const arch = await lensRun("wellness", "habits-archive", { params: { id } }, ac);
    assert.equal(arch.ok, true);
    assert.equal(arch.result.archived, true);
    const list = await lensRun("wellness", "habits-list", {}, ac);
    assert.equal(list.result.habits.some((h) => h.id === id), false);
  });

  it("habits-archive: rejects a missing habit", async () => {
    const bad = await lensRun("wellness", "habits-archive", { params: { id: "nope" } });
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /habit not found/);
  });

  it("mood-list: logged moods read back newest-first", async () => {
    const mc = await depthCtx("wellness-mood-list");
    const today = new Date();
    const d0 = today.toISOString().slice(0, 10);
    const dPrior = new Date(today); dPrior.setDate(dPrior.getDate() - 1);
    const d1 = dPrior.toISOString().slice(0, 10);
    await lensRun("wellness", "mood-log", { params: { mood: "meh", date: d1 } }, mc);
    await lensRun("wellness", "mood-log", { params: { mood: "great", date: d0 } }, mc);
    const list = await lensRun("wellness", "mood-list", {}, mc);
    assert.equal(list.ok, true);
    assert.equal(list.result.moods.length, 2);
    // both entries read back with their exact moodScore (4=great, 2=meh)
    const great = list.result.moods.find((m) => m.date === d0);
    const meh = list.result.moods.find((m) => m.date === d1);
    assert.equal(great.mood, "great");
    assert.equal(great.moodScore, 4);
    assert.equal(meh.moodScore, 2);
  });

  it("workouts-delete: removes a logged workout (round-trip)", async () => {
    const wc = await depthCtx("wellness-workout-del");
    const w = await lensRun("wellness", "workouts-log", { params: { kind: "swim", durationMin: 30 } }, wc);
    const id = w.result.workout.id;
    const del = await lensRun("wellness", "workouts-delete", { params: { id } }, wc);
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, true);
    const list = await lensRun("wellness", "workouts-list", {}, wc);
    assert.equal(list.result.workouts.some((x) => x.id === id), false);
  });

  it("workouts-delete: rejects a missing workout", async () => {
    const bad = await lensRun("wellness", "workouts-delete", { params: { id: "nope" } });
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /workout not found/);
  });

  it("goals-create → goals-list → goals-delete: full lifecycle round-trips", async () => {
    const gc = await depthCtx("wellness-goals-life");
    const g = await lensRun("wellness", "goals-create", { params: { name: "Sleep 8h", target: 8, unit: "h" } }, gc);
    const id = g.result.goal.id;
    const list = await lensRun("wellness", "goals-list", {}, gc);
    assert.equal(list.ok, true);
    assert.ok(list.result.goals.some((x) => x.id === id && x.status === "active"));
    const del = await lensRun("wellness", "goals-delete", { params: { id } }, gc);
    assert.equal(del.result.deleted, true);
    const after = await lensRun("wellness", "goals-list", {}, gc);
    assert.equal(after.result.goals.some((x) => x.id === id), false);
  });

  it("goals-delete: rejects a missing goal", async () => {
    const bad = await lensRun("wellness", "goals-delete", { params: { id: "nope" } });
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /goal not found/);
  });

  it("wellness-dashboard-summary: aggregates habits/workouts/mood/goals exactly", async () => {
    const dc = await depthCtx("wellness-dashboard");
    const today = new Date().toISOString().slice(0, 10);
    // one habit, checked in today (done)
    const h = await lensRun("wellness", "habits-create", { params: { name: "Walk", target: 1 } }, dc);
    await lensRun("wellness", "habits-checkin", { params: { habitId: h.result.habit.id, date: today, value: 1 } }, dc);
    // two workouts this week (30 + 20 = 50 min)
    await lensRun("wellness", "workouts-log", { params: { kind: "run", durationMin: 30, date: today } }, dc);
    await lensRun("wellness", "workouts-log", { params: { kind: "yoga", durationMin: 20, date: today } }, dc);
    // two moods this week: great(4) + good(3) → avg 3.5
    await lensRun("wellness", "mood-log", { params: { mood: "great", date: today } }, dc);
    await lensRun("wellness", "mood-log", { params: { mood: "good", date: today } }, dc);
    // one active goal
    await lensRun("wellness", "goals-create", { params: { name: "G", target: 10 } }, dc);
    const r = await lensRun("wellness", "wellness-dashboard-summary", {}, dc);
    assert.equal(r.ok, true);
    assert.equal(r.result.habitCount, 1);
    assert.equal(r.result.habitsDoneToday, 1);
    assert.equal(r.result.workoutsThisWeek, 2);
    assert.equal(r.result.workoutMinThisWeek, 50);
    assert.equal(r.result.avgMoodThisWeek, 3.5);
    assert.equal(r.result.activeGoals, 1);
  });

  it("self-field-compose → self-field-list → self-field-deactivate: lifecycle", async () => {
    const fc = await depthCtx("wellness-selffield");
    const comp = await lensRun("wellness", "self-field-compose", {
      params: { fieldKind: "rumination", intention: "loop less", durationSeconds: 3600 },
    }, fc);
    assert.equal(comp.ok, true);
    assert.equal(comp.result.field.fieldKind, "rumination");
    assert.equal(comp.result.field.durationSeconds, 3600);
    assert.equal(comp.result.field.status, "active");
    const id = comp.result.field.id;
    const list = await lensRun("wellness", "self-field-list", {}, fc);
    assert.equal(list.result.activeCount, 1);
    assert.ok(list.result.fields.some((f) => f.id === id && f.status === "active"));
    const deact = await lensRun("wellness", "self-field-deactivate", { params: { id } }, fc);
    assert.equal(deact.result.revoked, true);
    const after = await lensRun("wellness", "self-field-list", {}, fc);
    assert.equal(after.result.activeCount, 0);
  });

  it("self-field-compose: rejects an unknown fieldKind", async () => {
    const bad = await lensRun("wellness", "self-field-compose", { params: { fieldKind: "doom" } });
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /fieldKind must be one of/);
  });

  it("self-field-deactivate: rejects deactivating an already-inactive field", async () => {
    const fc = await depthCtx("wellness-selffield-twice");
    const comp = await lensRun("wellness", "self-field-compose", { params: { fieldKind: "shame_spiral" } }, fc);
    const id = comp.result.field.id;
    await lensRun("wellness", "self-field-deactivate", { params: { id } }, fc);
    const again = await lensRun("wellness", "self-field-deactivate", { params: { id } }, fc);
    assert.equal(again.result.ok, false);
    assert.match(again.result.error, /already inactive/);
  });

  it("cbt-prompts: a single fieldKind returns its authored prompt set", async () => {
    const r = await lensRun("wellness", "cbt-prompts", { params: { fieldKind: "catastrophising" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.label, "Catastrophising");
    assert.equal(r.result.challenges.length, 3);
    assert.equal(r.result.reframe, "Separate what is possible from what is probable.");
  });

  it("cbt-prompts: no fieldKind lists all 8 distortion kinds", async () => {
    const r = await lensRun("wellness", "cbt-prompts", {});
    assert.equal(r.ok, true);
    assert.equal(r.result.kinds.length, 8);
    assert.ok(r.result.kinds.some((k) => k.fieldKind === "perfectionism" && k.label === "Perfectionism"));
  });

  it("cbt-prompts: rejects an unknown fieldKind", async () => {
    const bad = await lensRun("wellness", "cbt-prompts", { params: { fieldKind: "nope" } });
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /unknown fieldKind/);
  });

  it("cbt-record-list: aggregates avg relief across completed records", async () => {
    const rc = await depthCtx("wellness-cbt-list");
    // relief 50 and relief 30 → avgRelief 40
    await lensRun("wellness", "cbt-record-create", {
      params: { fieldKind: "rumination", situation: "S1", automaticThought: "T1", intensityBefore: 80, intensityAfter: 30 },
    }, rc);
    await lensRun("wellness", "cbt-record-create", {
      params: { fieldKind: "rumination", situation: "S2", automaticThought: "T2", intensityBefore: 60, intensityAfter: 30 },
    }, rc);
    // one open record (no intensityAfter) — counted in total, not in completed
    await lensRun("wellness", "cbt-record-create", {
      params: { fieldKind: "perfectionism", situation: "S3", automaticThought: "T3", intensityBefore: 50 },
    }, rc);
    const list = await lensRun("wellness", "cbt-record-list", {}, rc);
    assert.equal(list.ok, true);
    assert.equal(list.result.total, 3);
    assert.equal(list.result.completed, 2);
    assert.equal(list.result.avgRelief, 40);
  });

  it("wearable-sync-history: import surfaces in sync history with lastSyncAt", async () => {
    const wc = await depthCtx("wellness-synchist");
    const today = new Date().toISOString().slice(0, 10);
    const imp = await lensRun("wellness", "wearable-import", {
      params: { source: "whoop", readings: [{ type: "steps", value: 9000, date: today }] },
    }, wc);
    assert.equal(imp.result.summary.imported, 1);
    const hist = await lensRun("wellness", "wearable-sync-history", {}, wc);
    assert.equal(hist.ok, true);
    assert.ok(hist.result.syncs.some((x) => x.id === imp.result.summary.id && x.source === "whoop"));
    assert.equal(hist.result.lastSyncAt, hist.result.syncs[0].at);
  });

  it("session-catalogue: returns the authored 7-entry guided catalogue", async () => {
    const r = await lensRun("wellness", "session-catalogue", {});
    assert.equal(r.ok, true);
    assert.equal(r.result.sessions.length, 7);
    const box = r.result.sessions.find((c) => c.id === "box_breathing");
    assert.deepEqual(box.pattern, [4, 4, 4, 4]);
    assert.equal(box.durationMin, 5);
  });

  it("session-complete: rejects an unknown catalogueId", async () => {
    const bad = await lensRun("wellness", "session-complete", { params: { catalogueId: "nope" } });
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /unknown catalogueId/);
  });

  it("daily-recommendation: low sleep + low recovery drives a red band rest focus", async () => {
    const dc = await depthCtx("wellness-daily-rec");
    const today = new Date().toISOString().slice(0, 10);
    // 4h sleep, low hrv, high rhr → red recovery; sleep<7 triggers a priority-1 sleep rec
    await lensRun("wellness", "metrics-log", { params: { type: "sleep_hours", value: 4, date: today } }, dc);
    await lensRun("wellness", "metrics-log", { params: { type: "hrv_ms", value: 30, date: today } }, dc);
    await lensRun("wellness", "metrics-log", { params: { type: "resting_hr", value: 80, date: today } }, dc);
    const r = await lensRun("wellness", "daily-recommendation", { params: { date: today } }, dc);
    assert.equal(r.ok, true);
    // 50 - 25(sleep:(4-6)*12.5=-25) - 15(hrv:(30-60)*0.5=-15) - 15(rhr:(60-80)*0.75=-15) = -5 → 0
    assert.equal(r.result.recoveryScore, 0);
    assert.equal(r.result.band, "red");
    assert.equal(r.result.signals.sleepHours, 4);
    assert.equal(r.result.hasEnoughData, true);
    // recommendations include a sleep-area entry (only 4h logged)
    assert.ok(r.result.recommendations.some((rec) => rec.area === "sleep"));
  });
});
