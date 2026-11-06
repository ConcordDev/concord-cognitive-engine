// Contract tests for the daily full lens build (F-B row 3): the merged
// cross-store read-back (D1), the Daily Actions rewired to the caller's
// real records (D2), and the full own-records export (D4) — against
// R4's first pass (2026-10-31, F1–F7).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerDailyActions from "../domains/daily.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}, artifact = { id: null, data: {}, meta: {} }) {
  const fn = ACTIONS.get(`daily.${name}`);
  assert.ok(fn, `daily.${name} not registered`);
  return fn(ctx, artifact, params);
}

before(() => { registerDailyActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map(), lensArtifacts: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };
const today = new Date().toISOString().slice(0, 10);

function todayArtifact(userId, date, extra = {}) {
  globalThis._concordSTATE.lensArtifacts.set(`art_${userId}_${date}`, {
    id: `art_${userId}_${date}`, domain: "daily", type: "entry", ownerId: userId,
    title: date, createdAt: `${date}T08:00:00.000Z`, updatedAt: `${date}T08:00:00.000Z`,
    data: { date, mood: 3, notes: "wrote in Today", workedOn: "the build", learned: "", goals: "", ...extra },
  });
}
function sessionArtifact(userId, duration = 25) {
  globalThis._concordSTATE.lensArtifacts.set(`ses_${userId}`, {
    id: `ses_${userId}`, domain: "daily", type: "session", ownerId: userId,
    title: "Deep work", createdAt: `${today}T09:00:00.000Z`, updatedAt: `${today}T09:00:00.000Z`,
    data: { id: `s_${userId}`, project: "Deep work", duration, category: "Practice", startedAt: `${today}T09:00:00.000Z` },
  });
}

describe("daily full build — D1 merged read-back (F1)", () => {
  it("entry-list reads the union: a Today entry appears in Studio's timeline, labelled", () => {
    call("entry-create", ctxA, { body: "studio entry", date: today });
    todayArtifact("user_a", today);
    const r = call("entry-list", ctxA, {});
    assert.equal(r.result.count, 2);
    const fromToday = r.result.entries.find((e) => e.source === "today");
    assert.ok(fromToday, "the Today entry is in the union list");
    assert.match(fromToday.body, /wrote in Today/);
    assert.equal(fromToday.mood, 4); // Today index 3 -> journal scale 4
    assert.equal(call("entry-list", ctxB, {}).result.count, 0); // isolation holds
  });

  it("dashboard + heatmap count both stores (streak + totals)", () => {
    todayArtifact("user_a", today);
    const d = call("daily-dashboard", ctxA, { today });
    assert.equal(d.result.totalEntries, 1);
    assert.equal(d.result.wroteToday, true);
    const h = call("entry-heatmap", ctxA, { days: 7 });
    assert.equal(h.result.writtenDays, 1);
  });

  it("a journal-scoped list stays Studio-only (the books keep their boundary)", () => {
    call("entry-create", ctxA, { body: "studio entry", date: today });
    todayArtifact("user_a", today);
    const jid = call("journal-list", ctxA, {}).result.journals[0].id;
    const r = call("entry-list", ctxA, { journalId: jid });
    assert.equal(r.result.count, 1);
    assert.equal(r.result.entries[0].body, "studio entry");
  });
});

describe("daily full build — D2 actions read the real day (F2)", () => {
  it("dailySummary counts the union entries and the day's sessions", () => {
    call("entry-create", ctxA, { body: "studio entry", date: today });
    todayArtifact("user_a", today);
    sessionArtifact("user_a", 25);
    const r = call("dailySummary", ctxA, {});
    assert.equal(r.result.entriesLogged, 2);
    assert.equal(r.result.sessionsCompleted, 1);
    assert.equal(r.result.totalFocusMinutes, 25);
  });

  it("habitStreak reads the domain habits + checkins, not an empty artifact", () => {
    const h = call("habit-create", ctxA, { name: "Practice" }).result.habit;
    call("habit-checkin", ctxA, { habitId: h.id, date: today });
    const r = call("habitStreak", ctxA, {});
    assert.equal(r.result.totalHabits, 1);
    assert.equal(r.result.activeHabits, 1);
    assert.equal(r.result.habits[0].currentStreak, 1);
  });

  it("focusTimer counts today's session artifacts", () => {
    sessionArtifact("user_a", 40);
    const r = call("focusTimer", ctxA, {});
    assert.equal(r.result.sessionsToday, 1);
    assert.equal(r.result.totalMinutes, 40);
  });

  it("weeklyReview computes over a logged week — and its empty message is now truthful", () => {
    const empty = call("weeklyReview", ctxB, {});
    assert.equal(empty.result.message, "Log daily data to generate weekly review.");
    todayArtifact("user_a", today);
    sessionArtifact("user_a", 25);
    const r = call("weeklyReview", ctxA, {});
    assert.equal(r.result.message, undefined);
    assert.equal(r.result.daysTracked, 1);
    assert.equal(r.result.totalFocusMinutes, 25);
  });
});

describe("daily full build — D4 own-records export (F5)", () => {
  it("export-journal carries both stores + habits + reminders in labelled sections", () => {
    call("entry-create", ctxA, { body: "studio entry", date: today });
    todayArtifact("user_a", today);
    sessionArtifact("user_a", 25);
    call("habit-create", ctxA, { name: "Practice" });
    globalThis._concordSTATE.lensArtifacts.set("rem_a", {
      id: "rem_a", domain: "daily", type: "reminder", ownerId: "user_a",
      title: "Call home", createdAt: `${today}T09:00:00.000Z`, updatedAt: `${today}T09:00:00.000Z`,
      data: { id: "r1", title: "Call home", dueAt: `${today}T18:00`, completed: false },
    });
    const r = call("export-journal", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.counts.studioEntries, 1);
    assert.equal(r.result.counts.todayEntries, 1);
    assert.equal(r.result.counts.sessions, 1);
    assert.equal(r.result.counts.habits, 1);
    assert.equal(r.result.counts.reminders, 1);
    assert.match(r.result.markdown, /## Journal entries \(Studio\)/);
    assert.match(r.result.markdown, /## Today entries/);
    assert.match(r.result.markdown, /wrote in Today/);
    assert.match(r.result.markdown, /Call home/);
    // Another account exports only its own (empty) record set.
    const other = call("export-journal", ctxB, {});
    assert.equal(other.result.counts.studioEntries, 0);
    assert.equal(other.result.counts.todayEntries, 0);
  });
});
