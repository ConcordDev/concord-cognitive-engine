// Contract tests for the mental-health Calm + Headspace 2026-parity
// mindfulness macros (sessions, courses, mood, breathing, sleep,
// gratitude, goals). Crisis/CDC macros covered elsewhere.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerMentalhealthActions from "../domains/mentalhealth.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`mental-health.${name}`);
  assert.ok(fn, `mental-health.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerMentalhealthActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };
const today = () => new Date().toISOString().slice(0, 10);
const dayOffset = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

describe("mental-health.session-*", () => {
  it("log sessions, stats sum minutes, scoped per user", () => {
    call("session-log", ctxA, { type: "meditation", durationMin: 10 });
    call("session-log", ctxA, { type: "breathing", durationMin: 5 });
    const stats = call("session-stats", ctxA, {});
    assert.equal(stats.result.totalSessions, 2);
    assert.equal(stats.result.totalMinutes, 15);
    assert.equal(call("session-stats", ctxB, {}).result.totalSessions, 0);
  });

  it("streak counts consecutive days", () => {
    call("session-log", ctxA, { durationMin: 10, date: dayOffset(-1) });
    call("session-log", ctxA, { durationMin: 10, date: today() });
    assert.equal(call("session-stats", ctxA, {}).result.streak, 2);
  });

  it("mindfulness-minutes splits all-time vs this week", () => {
    call("session-log", ctxA, { durationMin: 20, date: today() });
    const m = call("mindfulness-minutes", ctxA, {});
    assert.equal(m.result.today, 20);
    assert.equal(m.result.thisWeek, 20);
  });
});

describe("mental-health.courses", () => {
  it("course progresses and completing a session logs meditation", () => {
    const c = call("course-create", ctxA, { name: "Basics", totalSessions: 3 }).result.course;
    call("course-complete-session", ctxA, { id: c.id, durationMin: 8 });
    const list = call("course-list", ctxA, {});
    assert.equal(list.result.courses[0].completedSessions, 1);
    assert.equal(list.result.courses[0].progressPct, 33);
    assert.equal(call("session-stats", ctxA, {}).result.totalSessions, 1);
  });

  it("course completes after all sessions", () => {
    const c = call("course-create", ctxA, { name: "Short", totalSessions: 1 }).result.course;
    const r = call("course-complete-session", ctxA, { id: c.id });
    assert.equal(r.result.complete, true);
    assert.equal(call("course-complete-session", ctxA, { id: c.id }).ok, false);
  });
});

describe("mental-health.mood", () => {
  it("log mood, insights compute average and trend", () => {
    assert.equal(call("mood-log", ctxA, { mood: 9 }).ok, false);
    call("mood-log", ctxA, { mood: 2 });
    call("mood-log", ctxA, { mood: 2 });
    call("mood-log", ctxA, { mood: 4 });
    call("mood-log", ctxA, { mood: 5 });
    const ins = call("mood-insights", ctxA, {});
    assert.equal(ins.result.entries, 4);
    assert.equal(ins.result.average, 3.25);
    assert.equal(ins.result.trend, "improving");
  });
});

describe("mental-health.breathing", () => {
  it("patterns are real and logging works", () => {
    const p = call("breathing-patterns", ctxA, {});
    assert.ok(p.result.patterns.find((x) => x.id === "478"));
    call("breathing-log", ctxA, { patternId: "box", rounds: 5 });
    const stats = call("breathing-stats", ctxA, {});
    assert.equal(stats.result.sessions, 1);
    assert.equal(call("breathing-log", ctxA, { patternId: "nope" }).ok, false);
  });
});

describe("mental-health.sleep", () => {
  it("logs sleep and averages", () => {
    call("sleep-log", ctxA, { hoursSlept: 7, quality: 4, date: dayOffset(-1) });
    call("sleep-log", ctxA, { hoursSlept: 8, quality: 5, date: today() });
    const h = call("sleep-history", ctxA, {});
    assert.equal(h.result.nights, 2);
    assert.equal(h.result.avgHours, 7.5);
    assert.equal(call("sleep-log", ctxA, { hoursSlept: 0 }).ok, false);
  });
});

describe("mental-health.gratitude + goal", () => {
  it("gratitude entries collect items", () => {
    call("gratitude-add", ctxA, { entries: ["Sunshine", "Coffee", "Friends"] });
    const list = call("gratitude-list", ctxA, {});
    assert.equal(list.result.count, 1);
    assert.equal(list.result.entries[0].items.length, 3);
    assert.equal(call("gratitude-add", ctxA, { entries: [] }).ok, false);
  });

  it("goal-status tracks today's minutes", () => {
    call("goal-set", ctxA, { dailyMinutes: 15 });
    call("session-log", ctxA, { durationMin: 10, date: today() });
    const g = call("goal-status", ctxA, {});
    assert.equal(g.result.dailyMinutes, 15);
    assert.equal(g.result.todayMinutes, 10);
    assert.equal(g.result.met, false);
  });
});

describe("mental-health.wellness-dashboard", () => {
  it("aggregates streak, sessions and mood", () => {
    call("session-log", ctxA, { durationMin: 10, date: today() });
    call("mood-log", ctxA, { mood: 4 });
    const d = call("wellness-dashboard", ctxA, {});
    assert.equal(d.result.streak, 1);
    assert.equal(d.result.sessionsThisWeek, 1);
    assert.equal(d.result.latestMood, 4);
  });
});

// ── Backlog parity macros ──────────────────────────────────────────

describe("mental-health.companion-chat", () => {
  it("rejects an empty message", async () => {
    const r = await call("companion-chat", ctxA, { message: "" });
    assert.equal(r.ok, false);
  });

  it("records a turn, replies (deterministic fallback), scoped per user", async () => {
    const r = await call("companion-chat", ctxA, { message: "I feel overwhelmed today" });
    assert.equal(r.ok, true);
    assert.ok(r.result.reply.length > 0);
    assert.equal(r.result.riskFlag, false);
    const hist = call("companion-history", ctxA, {});
    assert.equal(hist.result.count, 2);
    assert.equal(call("companion-history", ctxB, {}).result.count, 0);
  });

  it("flags a self-harm risk message and surfaces the crisis line", async () => {
    const r = await call("companion-chat", ctxA, { message: "I want to die" });
    assert.equal(r.result.riskFlag, true);
    assert.match(r.result.reply, /988/);
  });

  it("companion-reset clears history", async () => {
    await call("companion-chat", ctxA, { message: "hello" });
    call("companion-reset", ctxA, {});
    assert.equal(call("companion-history", ctxA, {}).result.count, 0);
  });
});

describe("mental-health.custom factors", () => {
  it("creates factors, rejects duplicates, lists and deletes", () => {
    const f = call("factor-create", ctxA, { name: "Exercise", group: "activity" });
    assert.equal(f.ok, true);
    assert.equal(call("factor-create", ctxA, { name: "exercise" }).ok, false);
    assert.equal(call("factor-list", ctxA, {}).result.count, 1);
    const d = call("factor-delete", ctxA, { id: f.result.factor.id });
    assert.equal(d.ok, true);
    assert.equal(call("factor-list", ctxA, {}).result.count, 0);
  });

  it("mood-log-tagged only keeps known factor ids", () => {
    const f = call("factor-create", ctxA, { name: "Sleep" }).result.factor;
    const r = call("mood-log-tagged", ctxA, { mood: 4, factors: [f.id, "bogus_id"] });
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.entry.factors, [f.id]);
  });
});

describe("mental-health.factor-correlations", () => {
  it("returns hasData false without tagged entries", () => {
    const r = call("factor-correlations", ctxA, {});
    assert.equal(r.result.hasData, false);
  });

  it("identifies a factor that lifts mood above baseline", () => {
    const ex = call("factor-create", ctxA, { name: "Walk" }).result.factor;
    const wk = call("factor-create", ctxA, { name: "Deadline" }).result.factor;
    call("mood-log-tagged", ctxA, { mood: 5, factors: [ex.id] });
    call("mood-log-tagged", ctxA, { mood: 5, factors: [ex.id] });
    call("mood-log-tagged", ctxA, { mood: 1, factors: [wk.id] });
    call("mood-log-tagged", ctxA, { mood: 1, factors: [wk.id] });
    const r = call("factor-correlations", ctxA, { minSamples: 2 });
    assert.equal(r.result.hasData, true);
    const walk = r.result.correlations.find((c) => c.name === "Walk");
    assert.equal(walk.effect, "lifts");
    assert.ok(walk.delta > 0);
  });
});

describe("mental-health.mood-calendar", () => {
  it("buckets logged days by mood for a year", () => {
    call("mood-log", ctxA, { mood: 3, date: today() });
    call("mood-log", ctxA, { mood: 5, date: today() });
    const r = call("mood-calendar", ctxA, { year: new Date().getUTCFullYear() });
    assert.equal(r.ok, true);
    assert.equal(r.result.loggedDays, 1);
    assert.equal(r.result.days[0].mood, 4);
    assert.equal(r.result.days[0].count, 2);
  });

  it("rejects an out-of-range year", () => {
    assert.equal(call("mood-calendar", ctxA, { year: 1500 }).ok, false);
  });
});

describe("mental-health.reminders", () => {
  it("sets, lists, updates and deletes a reminder", () => {
    const r = call("reminder-set", ctxA, { kind: "breathing", time: "08:30" });
    assert.equal(r.result.reminder.kind, "breathing");
    assert.equal(r.result.reminder.time, "08:30");
    const upd = call("reminder-set", ctxA, { id: r.result.reminder.id, time: "21:00", enabled: false });
    assert.equal(upd.result.reminder.time, "21:00");
    assert.equal(upd.result.reminder.enabled, false);
    assert.equal(call("reminder-list", ctxA, {}).result.count, 1);
    assert.equal(call("reminder-delete", ctxA, { id: r.result.reminder.id }).ok, true);
    assert.equal(call("reminder-list", ctxA, {}).result.count, 0);
  });

  it("reminder-due surfaces outstanding kinds and clears after activity", () => {
    call("reminder-set", ctxA, { kind: "mood", time: "20:00" });
    let due = call("reminder-due", ctxA, {});
    assert.equal(due.result.due.length, 1);
    call("mood-log", ctxA, { mood: 4 });
    due = call("reminder-due", ctxA, {});
    assert.equal(due.result.due.length, 0);
  });
});

describe("mental-health.worksheets", () => {
  it("exposes CBT and DBT templates", () => {
    const t = call("worksheet-templates", ctxA, {});
    assert.ok(t.result.templates.find((x) => x.id === "thought_record"));
    assert.ok(t.result.templates.find((x) => x.modality === "DBT"));
  });

  it("saves a worksheet, rejects empty, lists and deletes", () => {
    assert.equal(call("worksheet-save", ctxA, { templateId: "thought_record", responses: {} }).ok, false);
    const w = call("worksheet-save", ctxA, {
      templateId: "thought_record",
      responses: { situation: "Missed a deadline", balancedThought: "One slip is not failure" },
    });
    assert.equal(w.ok, true);
    assert.equal(w.result.worksheet.answered, 2);
    assert.equal(call("worksheet-list", ctxA, {}).result.count, 1);
    assert.equal(call("worksheet-delete", ctxA, { id: w.result.worksheet.id }).ok, true);
    assert.equal(call("worksheet-list", ctxA, {}).result.count, 0);
  });
});

describe("mental-health.safety-plan", () => {
  it("template lists Stanley-Brown sections", () => {
    const t = call("safety-plan-template", ctxA, {});
    assert.ok(t.result.sections.find((s) => s.key === "warningSigns"));
    assert.equal(t.result.crisisLine.phone, "988");
  });

  it("saves and retrieves a plan, rejects an empty one", () => {
    assert.equal(call("safety-plan-save", ctxA, { sections: {} }).ok, false);
    const p = call("safety-plan-save", ctxA, {
      sections: {
        warningSigns: ["Withdrawing from friends"],
        copingStrategies: "Go for a walk",
        reasonsToLive: ["My family", "My dog"],
      },
    });
    assert.equal(p.ok, true);
    assert.equal(p.result.plan.sectionsFilled, 3);
    const g = call("safety-plan-get", ctxA, {});
    assert.equal(g.result.hasPlan, true);
    assert.deepEqual(g.result.plan.sections.reasonsToLive, ["My family", "My dog"]);
    assert.equal(call("safety-plan-get", ctxB, {}).result.hasPlan, false);
  });
});

describe("mental-health.therapist-report", () => {
  it("compiles a summary, CSV and text from real entries", () => {
    call("mood-log", ctxA, { mood: 3, note: "ok day", date: today() });
    call("mood-log", ctxA, { mood: 5, date: today() });
    call("sleep-log", ctxA, { hoursSlept: 7.5, quality: 4, date: today() });
    const r = call("therapist-report", ctxA, { days: 30 });
    assert.equal(r.ok, true);
    assert.equal(r.result.summary.moodEntries, 2);
    assert.equal(r.result.summary.avgMood, 4);
    assert.equal(r.result.summary.sleepNights, 1);
    assert.match(r.result.csv, /^date,mood,energy,label,note/);
    assert.match(r.result.text, /Self-Tracking Report/);
    assert.equal(r.result.moodLog.length, 2);
  });
});
