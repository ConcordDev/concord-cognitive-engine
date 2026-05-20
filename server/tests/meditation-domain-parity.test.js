// Contract tests for the meditation lens — Calm / Headspace 2026-shape
// session substrate in server/domains/meditation.js.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerMeditationActions from "../domains/meditation.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`meditation.${name}`);
  assert.ok(fn, `meditation.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerMeditationActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("meditation.library", () => {
  it("lists the curated library and its categories", () => {
    const r = call("library", ctxA, {});
    assert.ok(r.result.count >= 15);
    assert.ok(r.result.categories.includes("sleep_story"));
    assert.ok(r.result.categories.includes("sos"));
  });
  it("filters by category and max duration", () => {
    assert.ok(call("library", ctxA, { category: "breathwork" }).result.sessions.every((x) => x.category === "breathwork"));
    assert.ok(call("library", ctxA, { maxMinutes: 5 }).result.sessions.every((x) => x.durationMin <= 5));
  });
});

describe("meditation.play + history + streak", () => {
  it("plays a library session and records it per user", () => {
    const r = call("play", ctxA, { sessionId: "g-focus-10", mood: 4 });
    assert.equal(r.ok, true);
    assert.equal(r.result.session.durationMin, 10);
    assert.equal(call("history", ctxA, {}).result.count, 1);
    assert.equal(call("history", ctxB, {}).result.count, 0);
  });
  it("rejects an unknown session id", () => {
    assert.equal(call("play", ctxA, { sessionId: "nope" }).ok, false);
  });
  it("streak counts today's practice + total minutes", () => {
    call("play", ctxA, { sessionId: "g-focus-10" });
    call("play", ctxA, { sessionId: "b-box-5" });
    const st = call("streak", ctxA, {});
    assert.equal(st.result.practicedToday, true);
    assert.equal(st.result.currentStreak, 1);
    assert.equal(st.result.totalMinutes, 15);
  });
});

describe("meditation.breathwork", () => {
  it("returns a known pattern with phases and total seconds", () => {
    const r = call("breathwork", ctxA, { pattern: "478", cycles: 4 });
    assert.equal(r.result.pattern, "478");
    assert.equal(r.result.phases.length, 3);
    assert.equal(r.result.totalSeconds, 19 * 4);
  });
  it("falls back to box for an unknown pattern", () => {
    assert.equal(call("breathwork", ctxA, { pattern: "weird" }).result.pattern, "box");
  });
});

describe("meditation.mood", () => {
  it("logs mood check-ins and averages them", () => {
    call("mood-checkin", ctxA, { mood: 4, note: "calmer" });
    call("mood-checkin", ctxA, { mood: 2 });
    const h = call("mood-history", ctxA, {});
    assert.equal(h.result.count, 2);
    assert.equal(h.result.averageMood, 3);
  });
});

describe("meditation.dashboard", () => {
  it("aggregates sessions, minutes, streak and categories", () => {
    call("play", ctxA, { sessionId: "s-rain-30" });
    call("play", ctxA, { sessionId: "sos-panic-3" });
    const d = call("meditation-dashboard", ctxA, {});
    assert.equal(d.result.totalSessions, 2);
    assert.equal(d.result.totalMinutes, 33);
    assert.equal(d.result.byCategory.sleep_story, 1);
    assert.equal(d.result.byCategory.sos, 1);
  });
});

describe("meditation — legacy macros still intact", () => {
  it("pickTrack and dailyPrompt still respond", () => {
    assert.equal(call("pickTrack", ctxA, { goal: "sleep" }).ok, true);
    assert.equal(call("dailyPrompt", ctxA, {}).ok, true);
  });
});
