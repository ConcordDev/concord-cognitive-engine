// Behavioral macro tests for server/domains/mentalhealth.js — the Calm +
// Headspace + Daylio + Wysa shaped wellness substrate the /lenses/mental-health
// lens drives (domain string "mental-health", file mentalhealth.js, registered
// via PATH 3 / registerLensAction).
//
// This file mirrors the REAL LENS_ACTIONS dispatch (server.js:39283):
// handlers registered via `registerLensAction(domain, action, handler)` are
// invoked as `handler(ctx, virtualArtifact, input)` — the 3-ARG convention,
// with virtualArtifact.data === input. A regression that confuses the param
// positions or the artifact.data shape surfaces here.
//
// These are NOT shape-only assertions. Every test asserts ACTUAL computed
// values + round-trips through the in-memory STATE Maps: mood log/insights/
// calendar math, session/breathing/streak accounting, gratitude + goal status,
// CBT/DBT worksheet field validation, safety-plan compose, factor correlation
// deltas, therapist-report CSV, the Wysa-style companion deterministic fallback
// + risk scan, and the authoritative (real, non-synthesized) crisis hotline +
// breathing-pattern reference. Per-user isolation, degrade-graceful on empty
// STATE (ok:true, never throw / never no_db), and fail-CLOSED on poisoned
// inputs are all pinned.
//
// Hermetic: no server boot, no DB, no network, no LLM. companion-chat is driven
// down its DETERMINISTIC fallback by NOT supplying ctx.llm.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerMentalhealthActions from "../domains/mentalhealth.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "mental-health", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
// Mirror the live dispatch: handler(ctx, virtualArtifact, input). For the four
// pure-compute artifact-reading macros (moodTracker/copingStrategies/
// wellnessScore/journalPrompt) the lens passes a real loaded artifact whose
// `.data` holds the payload — so virtualArtifact.data === input here too.
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`mental-health.${name} not registered`);
  const virtualArtifact = { id: null, domain: "mental-health", type: "domain_action", data: input || {}, meta: {} };
  return fn(ctx, virtualArtifact, input || {});
}

before(() => { registerMentalhealthActions(registerLensAction); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "user_a" } };
const ctxB = { actor: { userId: "user_b" } };

const today = () => new Date().toISOString().slice(0, 10);
const dayOffset = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

// ───────────────────────────────────────────────────────────────────────────
describe("mental-health — registration (every lens-driven macro present)", () => {
  it("registers all 49 macros the lens/components call", () => {
    for (const m of [
      // pure-compute artifact readers (page action panel)
      "moodTracker", "copingStrategies", "wellnessScore", "journalPrompt",
      // authoritative references
      "crisis-hotlines", "cdc-mental-health-stats", "breathing-patterns",
      // meditation sessions
      "session-log", "session-history", "session-stats", "mindfulness-minutes",
      // courses
      "course-create", "course-list", "course-detail", "course-complete-session", "course-delete",
      // mood
      "mood-log", "mood-history", "mood-insights", "mood-log-tagged", "mood-calendar",
      // breathing
      "breathing-log", "breathing-stats",
      // sleep
      "sleep-log", "sleep-history",
      // gratitude + goal
      "gratitude-add", "gratitude-list", "goal-set", "goal-status",
      // dashboard
      "wellness-dashboard",
      // companion
      "companion-history", "companion-reset", "companion-chat",
      // factors
      "factor-create", "factor-list", "factor-delete", "factor-correlations",
      // reminders
      "reminder-set", "reminder-list", "reminder-delete", "reminder-due",
      // worksheets
      "worksheet-templates", "worksheet-save", "worksheet-list", "worksheet-delete",
      // safety plan + report
      "safety-plan-template", "safety-plan-save", "safety-plan-get", "therapist-report",
    ]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing mental-health.${m}`);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("mental-health — pure-compute artifact readers (computed values)", () => {
  it("moodTracker computes avg/trend/variance/min/max from entries array", () => {
    const r = call("moodTracker", ctxA, { entries: [{ mood: 3 }, { mood: 4 }, { mood: 5 }] });
    assert.equal(r.ok, true);
    assert.equal(r.result.entries, 3);
    assert.equal(r.result.avgMood, 4); // (3+4+5)/3
    assert.equal(r.result.trend, "improving"); // last(5) > first(3)
    assert.equal(r.result.lowest, 3);
    assert.equal(r.result.highest, 5);
  });

  it("moodTracker declining + insufficient-data branches", () => {
    assert.equal(call("moodTracker", ctxA, { entries: [{ mood: 5 }, { mood: 4 }, { mood: 2 }] }).result.trend, "declining");
    assert.equal(call("moodTracker", ctxA, { entries: [{ mood: 3 }, { mood: 4 }] }).result.trend, "insufficient-data");
  });

  it("moodTracker degrades gracefully on no entries (ok:true, guidance message)", () => {
    const r = call("moodTracker", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(/log mood entries/i.test(r.result.message));
    assert.equal(r.result.avgMood, undefined);
  });

  it("copingStrategies returns real strategies matched by trigger type (deduped)", () => {
    const r = call("copingStrategies", ctxA, { triggers: [{ type: "anxiety" }, "anxiety"] });
    assert.equal(r.ok, true);
    assert.equal(r.result.triggers, 2);
    assert.ok(r.result.strategies.includes("Deep breathing (4-7-8)"));
    // dedupe: same trigger twice must not duplicate the strategy
    assert.equal(new Set(r.result.strategies).size, r.result.strategies.length);
    assert.ok(/not medical advice/i.test(r.result.note));
  });

  it("wellnessScore computes a bounded 0-100 score from real inputs", () => {
    const r = call("wellnessScore", ctxA, { sleepHours: 8, exerciseMinutes: 30, socialInteractions: 3, moodScore: 10 });
    assert.equal(r.ok, true);
    assert.equal(r.result.wellnessScore, 100); // all four pillars maxed
    assert.deepEqual(r.result.areas, ["Keep up the good work"]);
    const low = call("wellnessScore", ctxA, { sleepHours: 4, exerciseMinutes: 0, socialInteractions: 0, moodScore: 2 });
    assert.ok(low.result.wellnessScore < 60);
    assert.ok(low.result.areas.includes("Improve sleep"));
  });

  it("journalPrompt returns real mood-matched prompts; unknown mood falls back to neutral", () => {
    const sad = call("journalPrompt", ctxA, { currentMood: "sad" });
    assert.equal(sad.ok, true);
    assert.equal(sad.result.mood, "sad");
    assert.ok(sad.result.prompts.length >= 3);
    const unknown = call("journalPrompt", ctxA, { currentMood: "zzz" });
    assert.equal(unknown.result.mood, "zzz");
    assert.deepEqual(unknown.result.prompts, call("journalPrompt", ctxA, { currentMood: "neutral" }).result.prompts);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("mental-health — authoritative references (real, non-synthesized)", () => {
  it("crisis-hotlines returns real 988 lifeline for US with disclaimer", () => {
    const r = call("crisis-hotlines", ctxA, { country: "US" });
    assert.equal(r.ok, true);
    assert.equal(r.result.available, true);
    assert.equal(r.result.hotlines.primary.phone, "988");
    assert.ok(/988lifeline\.org/.test(r.result.source));
    assert.ok(/not medical advice/i.test(r.result.disclaimer));
  });

  it("crisis-hotlines unknown country degrades to findahelpline fallback (still ok)", () => {
    const r = call("crisis-hotlines", ctxA, { country: "zz" });
    assert.equal(r.ok, true);
    assert.equal(r.result.available, false);
    assert.ok(/findahelpline\.com/.test(r.result.fallback));
  });

  it("breathing-patterns returns the real evidence-based pattern set with phase timings", () => {
    const r = call("breathing-patterns", ctxA, {});
    assert.equal(r.ok, true);
    const box = r.result.patterns.find((p) => p.id === "box");
    assert.deepEqual([box.inhale, box.hold1, box.exhale, box.hold2], [4, 4, 4, 4]);
    assert.ok(r.result.patterns.some((p) => p.id === "478"));
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("mental-health — sessions / streaks / goals round-trip", () => {
  it("session-log → session-history → session-stats accumulates real minutes + streak", () => {
    call("session-log", ctxA, { type: "meditation", durationMin: 10, date: today() });
    call("session-log", ctxA, { type: "breathing", durationMin: 5, date: today() });
    const hist = call("session-history", ctxA, {});
    assert.equal(hist.result.count, 2);
    const stats = call("session-stats", ctxA, {});
    assert.equal(stats.result.totalSessions, 2);
    assert.equal(stats.result.totalMinutes, 15);
    assert.equal(stats.result.byType.meditation, 10);
    assert.equal(stats.result.byType.breathing, 5);
    assert.equal(stats.result.streak, 1); // logged today
  });

  it("session-stats streak counts consecutive days back from today", () => {
    call("session-log", ctxA, { type: "meditation", durationMin: 10, date: today() });
    call("session-log", ctxA, { type: "meditation", durationMin: 10, date: dayOffset(1) });
    call("session-log", ctxA, { type: "meditation", durationMin: 10, date: dayOffset(2) });
    assert.equal(call("session-stats", ctxA, {}).result.streak, 3);
  });

  it("session-log clamps invalid duration to a sane minimum (>=1) and defaults type", () => {
    const r = call("session-log", ctxA, { type: "not_a_type", durationMin: -99 });
    assert.equal(r.result.session.durationMin, 1);
    assert.equal(r.result.session.type, "meditation");
  });

  it("goal-set → goal-status reflects today's logged minutes vs target", () => {
    call("goal-set", ctxA, { dailyMinutes: 20 });
    call("session-log", ctxA, { type: "meditation", durationMin: 12, date: today() });
    const g = call("goal-status", ctxA, {});
    assert.equal(g.result.dailyMinutes, 20);
    assert.equal(g.result.todayMinutes, 12);
    assert.equal(g.result.pct, 60);
    assert.equal(g.result.met, false);
    assert.equal(g.result.isDefault, false);
  });

  it("goal-status with no goal set is a default (isDefault:true, 10 min)", () => {
    const g = call("goal-status", ctxA, {});
    assert.equal(g.result.dailyMinutes, 10);
    assert.equal(g.result.isDefault, true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("mental-health — courses round-trip", () => {
  it("course-create → complete-session advances progress + mints a session", () => {
    const c = call("course-create", ctxA, { name: "Sleep Better", totalSessions: 2 });
    const id = c.result.course.id;
    const r1 = call("course-complete-session", ctxA, { id, durationMin: 8 });
    assert.equal(r1.result.course.completedSessions, 1);
    assert.equal(r1.result.progressPct, 50);
    assert.equal(r1.result.complete, false);
    const r2 = call("course-complete-session", ctxA, { id, durationMin: 8 });
    assert.equal(r2.result.complete, true);
    assert.equal(r2.result.progressPct, 100);
    // a completed course session also counts as a meditation session
    assert.equal(call("session-stats", ctxA, {}).result.totalSessions, 2);
    // can't over-complete
    assert.equal(call("course-complete-session", ctxA, { id }).ok, false);
  });

  it("course-delete removes only the targeted course", () => {
    const a = call("course-create", ctxA, { name: "A" }).result.course.id;
    const b = call("course-create", ctxA, { name: "B" }).result.course.id;
    assert.equal(call("course-delete", ctxA, { id: a }).result.deleted, a);
    const list = call("course-list", ctxA, {});
    assert.equal(list.result.count, 1);
    assert.equal(list.result.courses[0].id, b);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("mental-health — mood log / insights / calendar", () => {
  it("mood-log validates the 1-5 range (fail-closed) and round-trips", () => {
    assert.equal(call("mood-log", ctxA, { mood: 0 }).ok, false);
    assert.equal(call("mood-log", ctxA, { mood: 6 }).ok, false);
    const r = call("mood-log", ctxA, { mood: 4, note: "ok day" });
    assert.equal(r.ok, true);
    assert.equal(r.result.entry.mood, 4);
    assert.equal(call("mood-history", ctxA, { days: 30 }).result.count, 1);
  });

  it("mood-insights computes average, distribution and trend", () => {
    for (const m of [2, 2, 4, 5]) call("mood-log", ctxA, { mood: m, date: today() });
    const i = call("mood-insights", ctxA, {});
    assert.equal(i.result.entries, 4);
    assert.equal(i.result.average, 3.25);
    assert.equal(i.result.distribution[2], 2);
    assert.equal(i.result.distribution[5], 1);
    assert.equal(i.result.trend, "improving"); // late half (4.5) > early half (2) + 0.3
  });

  it("mood-insights with no data is degrade-graceful (ok, no_data trend)", () => {
    const i = call("mood-insights", ctxA, {});
    assert.equal(i.ok, true);
    assert.equal(i.result.entries, 0);
    assert.equal(i.result.trend, "no_data");
  });

  it("mood-calendar averages multiple same-day check-ins per day", () => {
    const y = new Date().getUTCFullYear();
    call("mood-log", ctxA, { mood: 2, date: today() });
    call("mood-log", ctxA, { mood: 4, date: today() });
    const cal = call("mood-calendar", ctxA, { year: y });
    assert.equal(cal.ok, true);
    assert.equal(cal.result.loggedDays, 1);
    assert.equal(cal.result.days[0].mood, 3); // (2+4)/2
    assert.equal(cal.result.days[0].count, 2);
  });

  it("mood-calendar fail-closes out-of-range year", () => {
    assert.equal(call("mood-calendar", ctxA, { year: 1800 }).ok, false);
    assert.equal(call("mood-calendar", ctxA, { year: 9999 }).ok, false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("mental-health — factors + correlations", () => {
  it("factor-create rejects duplicate names; mood-log-tagged only accepts known factor ids", () => {
    const f = call("factor-create", ctxA, { name: "Exercise" });
    assert.equal(f.ok, true);
    assert.equal(call("factor-create", ctxA, { name: "exercise" }).ok, false); // case-insensitive dup
    const fid = f.result.factor.id;
    const tagged = call("mood-log-tagged", ctxA, { mood: 5, factors: [fid, "bogus_id"] });
    assert.deepEqual(tagged.result.entry.factors, [fid]); // unknown id filtered out
  });

  it("factor-correlations computes per-factor delta vs baseline (lifts/lowers)", () => {
    const ex = call("factor-create", ctxA, { name: "Exercise" }).result.factor.id;
    const work = call("factor-create", ctxA, { name: "Overtime" }).result.factor.id;
    // exercise days high, overtime days low
    call("mood-log-tagged", ctxA, { mood: 5, factors: [ex] });
    call("mood-log-tagged", ctxA, { mood: 5, factors: [ex] });
    call("mood-log-tagged", ctxA, { mood: 4, factors: [ex] });
    call("mood-log-tagged", ctxA, { mood: 1, factors: [work] });
    call("mood-log-tagged", ctxA, { mood: 2, factors: [work] });
    call("mood-log-tagged", ctxA, { mood: 1, factors: [work] });
    const c = call("factor-correlations", ctxA, { minSamples: 3 });
    assert.equal(c.result.hasData, true);
    const exCorr = c.result.correlations.find((x) => x.factorId === ex);
    const workCorr = c.result.correlations.find((x) => x.factorId === work);
    assert.equal(exCorr.effect, "lifts");
    assert.ok(exCorr.delta > 0);
    assert.equal(workCorr.effect, "lowers");
    assert.ok(workCorr.delta < 0);
  });

  it("factor-correlations is degrade-graceful below minSamples", () => {
    const c = call("factor-correlations", ctxA, { minSamples: 3 });
    assert.equal(c.ok, true);
    assert.equal(c.result.hasData, false);
    assert.deepEqual(c.result.correlations, []);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("mental-health — breathing / sleep / gratitude", () => {
  it("breathing-log uses real pattern timing for durationSec; unknown pattern fails", () => {
    assert.equal(call("breathing-log", ctxA, { patternId: "nope" }).ok, false);
    const r = call("breathing-log", ctxA, { patternId: "box", rounds: 3 });
    // box cycle = 4+4+4+4 = 16s × 3 rounds = 48s
    assert.equal(r.result.entry.durationSec, 48);
    const s = call("breathing-stats", ctxA, {});
    assert.equal(s.result.sessions, 1);
    assert.equal(s.result.byPattern["Box breathing"], 1);
  });

  it("sleep-log validates 0-24h (fail-closed) and sleep-history averages", () => {
    assert.equal(call("sleep-log", ctxA, { hoursSlept: 0 }).ok, false);
    assert.equal(call("sleep-log", ctxA, { hoursSlept: 30 }).ok, false);
    call("sleep-log", ctxA, { hoursSlept: 7, quality: 4, date: today() });
    call("sleep-log", ctxA, { hoursSlept: 9, quality: 2, date: dayOffset(1) });
    const h = call("sleep-history", ctxA, { days: 14 });
    assert.equal(h.result.nights, 2);
    assert.equal(h.result.avgHours, 8);
    assert.equal(h.result.avgQuality, 3);
  });

  it("gratitude-add requires at least one entry; gratitude-list round-trips", () => {
    assert.equal(call("gratitude-add", ctxA, { entries: [] }).ok, false);
    call("gratitude-add", ctxA, { entries: ["sunshine", "coffee"] });
    const l = call("gratitude-list", ctxA, {});
    assert.equal(l.result.count, 1);
    assert.deepEqual(l.result.entries[0].items, ["sunshine", "coffee"]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("mental-health — worksheets (CBT/DBT) + safety plan", () => {
  it("worksheet-templates exposes the 4 real CBT/DBT templates", () => {
    const t = call("worksheet-templates", ctxA, {});
    assert.equal(t.result.count, 4);
    const ids = t.result.templates.map((x) => x.id);
    assert.deepEqual(ids.sort(), ["cognitive_reframe", "dbt_check_facts", "dbt_opposite_action", "thought_record"]);
  });

  it("worksheet-save validates template + requires >=1 filled field; round-trips", () => {
    assert.equal(call("worksheet-save", ctxA, { templateId: "nope", responses: {} }).ok, false);
    assert.equal(call("worksheet-save", ctxA, { templateId: "thought_record", responses: {} }).ok, false);
    const r = call("worksheet-save", ctxA, { templateId: "thought_record", responses: { situation: "deadline" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.worksheet.answered, 1);
    assert.equal(r.result.worksheet.modality, "CBT");
    assert.equal(call("worksheet-list", ctxA, {}).result.count, 1);
  });

  it("safety-plan-save requires >=1 section; safety-plan-get reflects hasPlan", () => {
    assert.equal(call("safety-plan-get", ctxA, {}).result.hasPlan, false);
    assert.equal(call("safety-plan-save", ctxA, { sections: {} }).ok, false);
    const r = call("safety-plan-save", ctxA, { sections: { warningSigns: ["isolating"], reasonsToLive: "my dog" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.plan.sectionsFilled, 2);
    assert.deepEqual(r.result.plan.sections.reasonsToLive, ["my dog"]); // string coerced to array
    const g = call("safety-plan-get", ctxA, {});
    assert.equal(g.result.hasPlan, true);
  });

  it("safety-plan-template surfaces the real 988 line + Stanley-Brown sections", () => {
    const t = call("safety-plan-template", ctxA, {});
    assert.equal(t.result.crisisLine.phone, "988");
    assert.ok(t.result.sections.some((s) => s.key === "reasonsToLive"));
    assert.ok(/Stanley-Brown/.test(t.result.note));
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("mental-health — reminders + therapist report", () => {
  it("reminder-set normalizes kind/time, reminder-due hides completed kinds", () => {
    call("reminder-set", ctxA, { kind: "bogus", time: "99:99" }); // → mood @ 20:00
    const list = call("reminder-list", ctxA, {});
    assert.equal(list.result.count, 1);
    assert.equal(list.result.reminders[0].kind, "mood");
    assert.equal(list.result.reminders[0].time, "20:00");
    // before logging a mood, the mood reminder is due
    assert.equal(call("reminder-due", ctxA, {}).result.due.length, 1);
    // after logging a mood today, it clears
    call("mood-log", ctxA, { mood: 3, date: today() });
    assert.equal(call("reminder-due", ctxA, {}).result.due.length, 0);
  });

  it("therapist-report builds a real summary + CSV from logged data", () => {
    call("mood-log", ctxA, { mood: 3, note: 'has,"comma"', date: today() });
    call("mood-log", ctxA, { mood: 5, date: today() });
    call("sleep-log", ctxA, { hoursSlept: 8, quality: 4, date: today() });
    const r = call("therapist-report", ctxA, { days: 30 });
    assert.equal(r.ok, true);
    assert.equal(r.result.summary.moodEntries, 2);
    assert.equal(r.result.summary.avgMood, 4);
    assert.equal(r.result.summary.lowestMood, 3);
    assert.equal(r.result.summary.highestMood, 5);
    assert.ok(r.result.csv.startsWith("date,mood,energy,label,note"));
    // CSV must quote+escape the comma/quote-bearing note
    assert.ok(/"has,""comma"""/.test(r.result.csv));
    assert.ok(/not a clinical assessment/i.test(r.result.text));
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("mental-health — Wysa-style companion (deterministic fallback, no LLM)", () => {
  it("companion-chat replies + records turns without ctx.llm (deterministic)", async () => {
    const r = await call("companion-chat", ctxA, { message: "I had a rough day" });
    assert.equal(r.ok, true);
    assert.ok(r.result.reply.length > 0);
    assert.equal(r.result.riskFlag, false);
    assert.ok(/not medical advice/i.test(r.result.disclaimer));
    const h = call("companion-history", ctxA, {});
    assert.equal(h.result.count, 2); // user + companion
  });

  it("companion-chat risk scan surfaces a 988 redirect on self-harm language", async () => {
    const r = await call("companion-chat", ctxA, { message: "I want to die" });
    assert.equal(r.result.riskFlag, true);
    assert.ok(/988/.test(r.result.reply));
  });

  it("companion-chat requires a message; companion-reset clears history", async () => {
    assert.equal((await call("companion-chat", ctxA, { message: "   " })).ok, false);
    await call("companion-chat", ctxA, { message: "hi" });
    assert.equal(call("companion-reset", ctxA, {}).result.cleared, true);
    assert.equal(call("companion-history", ctxA, {}).result.count, 0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("mental-health — wellness dashboard, isolation, degrade, fail-closed", () => {
  it("wellness-dashboard aggregates the real per-user substrate", () => {
    call("session-log", ctxA, { type: "meditation", durationMin: 10, date: today() });
    call("mood-log", ctxA, { mood: 4, date: today() });
    call("sleep-log", ctxA, { hoursSlept: 7, quality: 3, date: today() });
    call("gratitude-add", ctxA, { entries: ["family"] });
    const d = call("wellness-dashboard", ctxA, {});
    assert.equal(d.ok, true);
    assert.equal(d.result.sessionsThisWeek, 1);
    assert.equal(d.result.minutesThisWeek, 10);
    assert.equal(d.result.latestMood, 4);
    assert.equal(d.result.avgSleepHours, 7);
    assert.equal(d.result.gratitudeEntries, 1);
    assert.equal(d.result.streak, 1);
  });

  it("wellness-dashboard on an empty user is degrade-graceful (ok:true, zeros)", () => {
    const d = call("wellness-dashboard", ctxA, {});
    assert.equal(d.ok, true);
    assert.equal(d.result.sessionsThisWeek, 0);
    assert.equal(d.result.latestMood, null);
    assert.equal(d.result.streak, 0);
  });

  it("per-user isolation — user_b never sees user_a's logs", () => {
    call("mood-log", ctxA, { mood: 5, date: today() });
    call("session-log", ctxA, { type: "meditation", durationMin: 10, date: today() });
    assert.equal(call("mood-history", ctxB, {}).result.count, 0);
    assert.equal(call("session-stats", ctxB, {}).result.totalSessions, 0);
    assert.equal(call("wellness-dashboard", ctxB, {}).result.latestMood, null);
  });

  it("anon ctx is a real bucket, isolated from named users", () => {
    const anon = {};
    call("mood-log", anon, { mood: 3, date: today() });
    assert.equal(call("mood-history", anon, {}).result.count, 1);
    assert.equal(call("mood-history", ctxA, {}).result.count, 0);
  });

  it("missing STATE returns a clean error (never throws, never no_db)", () => {
    delete globalThis._concordSTATE;
    const r = call("mood-log", ctxA, { mood: 3 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "STATE unavailable");
    assert.notEqual(r.error, "no_db");
  });

  it("poisoned numeric inputs cannot corrupt mood range or session duration (fail-closed)", () => {
    assert.equal(call("mood-log", ctxA, { mood: Infinity }).ok, false);
    assert.equal(call("mood-log", ctxA, { mood: 1e308 }).ok, false);
    assert.equal(call("mood-log", ctxA, { mood: "5; DROP TABLE" }).ok, false);
    // session duration with a poisoned value clamps to >=1 (never NaN/Infinity)
    const s = call("session-log", ctxA, { durationMin: Infinity });
    assert.ok(Number.isFinite(s.result.session.durationMin));
    assert.ok(s.result.session.durationMin >= 1);
  });

  it("string fields are trimmed + length-capped (no unbounded injection sink)", () => {
    const big = "x".repeat(5000);
    const r = call("mood-log", ctxA, { mood: 3, note: big });
    assert.ok(r.result.entry.note.length <= 500);
  });
});
