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
