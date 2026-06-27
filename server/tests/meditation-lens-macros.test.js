// Behavioral macro tests for server/domains/meditation.js — the Calm /
// Headspace / Insight Timer shadow (session player + streak + courses +
// reminders + soundscapes + milestones).
//
// Drives each registered macro the way the REAL /api/lens/run dispatch does
// (server.js:39150): a THREE-arg call `handler(ctx, virtualArtifact, input)`
// where virtualArtifact = { id, domain, type, data: input, meta }. The
// STATE-backed macros (play/history/streak/courses/...) persist through the
// REAL in-memory globalThis._concordSTATE.meditationLens store the domain uses.
//
// These are NOT shape-only assertions: every test asserts ACTUAL values +
// multi-step round-trips (play a session → history reflects it; streak/minutes
// accrue real numbers; enroll a course → complete a day → progress advances +
// the underlying session lands in the practice ledger; set/toggle/delete a
// reminder; milestones unlock at real thresholds) and per-user isolation.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerMeditationActions from "../domains/meditation.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "meditation", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}

// Mirror the real LENS_ACTIONS dispatch: handler(ctx, virtualArtifact, input).
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`meditation.${name} not registered`);
  const virtualArtifact = { id: null, domain: "meditation", type: "domain_action", data: input || {}, meta: {} };
  return fn(ctx, virtualArtifact, input || {});
}

before(() => { registerMeditationActions(register); });
// Reset the STATE store the STATE-backed macros persist into between tests.
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "user_a" } };
const ctxB = { actor: { userId: "user_b" } };

describe("meditation — registration", () => {
  it("registers every macro the lens + studio panels call", () => {
    for (const m of [
      "pickTrack", "sessionLog", "streakSummary", "dailyPrompt",
      "library", "play", "history", "streak", "breathwork",
      "mood-checkin", "mood-history", "meditation-dashboard",
      "soundscapeConfig", "courses", "enrollCourse", "courseProgress",
      "completeCourseDay", "setReminder", "reminders", "toggleReminder",
      "deleteReminder", "sleepTimerConfig", "recommendations", "milestones",
    ]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing meditation.${m}`);
    }
  });
});

describe("meditation — track picker + daily prompt (deterministic, no STATE)", () => {
  it("pickTrack returns a goal-banded track with a clamped duration", () => {
    const r = call("pickTrack", ctxA, { goal: "focus", minutes: 10 });
    assert.equal(r.ok, true);
    assert.equal(r.result.goal, "focus");
    assert.equal(r.result.durationMinutes, 10);
    assert.equal(typeof r.result.trackId, "string");
    assert.ok(r.result.title);
  });

  it("pickTrack clamps an out-of-range / poisoned duration into [1,60]", () => {
    assert.equal(call("pickTrack", ctxA, { goal: "sleep", minutes: 999 }).result.durationMinutes, 60);
    assert.equal(call("pickTrack", ctxA, { goal: "sleep", minutes: -5 }).result.durationMinutes, 1);
    assert.equal(call("pickTrack", ctxA, { goal: "sleep", minutes: "NaN" }).result.durationMinutes, 10);
  });

  it("pickTrack is deterministic for the same (goal, minutes)", () => {
    const a = call("pickTrack", ctxA, { goal: "anxiety", minutes: 8 });
    const b = call("pickTrack", ctxA, { goal: "anxiety", minutes: 8 });
    assert.deepEqual(a.result, b.result);
  });

  it("dailyPrompt is date-deterministic and self-consistent", () => {
    const a = call("dailyPrompt", ctxA, {});
    const b = call("dailyPrompt", ctxB, {});
    assert.equal(a.ok, true);
    assert.equal(a.result.date, new Date().toISOString().slice(0, 10));
    assert.equal(a.result.prompt, b.result.prompt); // same day → same prompt for everyone
    assert.ok(a.result.prompt.length > 0);
  });
});

describe("meditation — library filtering", () => {
  it("library returns the full catalog with category facets", () => {
    const r = call("library", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.count >= 17);
    assert.equal(r.result.sessions.length, r.result.count);
    assert.ok(r.result.categories.includes("guided"));
    assert.ok(r.result.categories.includes("breathwork"));
  });

  it("library filters by category + goal + maxMinutes", () => {
    const guided = call("library", ctxA, { category: "guided" });
    assert.ok(guided.result.sessions.every((x) => x.category === "guided"));

    const sleep = call("library", ctxA, { goal: "sleep" });
    assert.ok(sleep.result.sessions.every((x) => x.goal === "sleep"));

    const short = call("library", ctxA, { maxMinutes: 5 });
    assert.ok(short.result.sessions.every((x) => x.durationMin <= 5));
  });
});

describe("meditation — play → history → streak round-trip (STATE-backed)", () => {
  it("playing a real library track lands in history with accurate minutes", () => {
    const played = call("play", ctxA, { sessionId: "g-focus-10", mood: 4 });
    assert.equal(played.ok, true);
    assert.equal(played.result.session.sessionId, "g-focus-10");
    assert.equal(played.result.session.durationMin, 10);
    assert.equal(played.result.session.moodAfter, 4);

    const hist = call("history", ctxA, {});
    assert.equal(hist.ok, true);
    assert.equal(hist.result.count, 1);
    assert.equal(hist.result.sessions[0].sessionId, "g-focus-10");
  });

  it("play rejects a sessionId that is not in the library", () => {
    const r = call("play", ctxA, { sessionId: "does-not-exist" });
    assert.equal(r.ok, false);
    assert.match(r.error, /not found/i);
  });

  it("streak + dashboard accrue REAL totals across multiple plays", () => {
    call("play", ctxA, { sessionId: "g-focus-10" });   // 10 min, guided
    call("play", ctxA, { sessionId: "b-box-5" });        // 5 min, breathwork
    const s = call("streak", ctxA, {});
    assert.equal(s.ok, true);
    assert.equal(s.result.totalSessions, 2);
    assert.equal(s.result.totalMinutes, 15);
    assert.equal(s.result.currentStreak, 1);  // both today
    assert.equal(s.result.practicedToday, true);

    const dash = call("meditation-dashboard", ctxA, {});
    assert.equal(dash.result.totalSessions, 2);
    assert.equal(dash.result.totalMinutes, 15);
    assert.equal(dash.result.byCategory.guided, 1);
    assert.equal(dash.result.byCategory.breathwork, 1);
  });

  it("history/streak are per-user isolated", () => {
    call("play", ctxA, { sessionId: "g-focus-10" });
    assert.equal(call("history", ctxA, {}).result.count, 1);
    assert.equal(call("history", ctxB, {}).result.count, 0);
    assert.equal(call("streak", ctxB, {}).result.totalMinutes, 0);
  });

  it("play clamps a poisoned mood into [1,5] (null when non-finite)", () => {
    assert.equal(call("play", ctxA, { sessionId: "g-focus-10", mood: 99 }).result.session.moodAfter, 5);
    assert.equal(call("play", ctxA, { sessionId: "g-focus-10", mood: -3 }).result.session.moodAfter, 1);
    assert.equal(call("play", ctxA, { sessionId: "g-focus-10", mood: "abc" }).result.session.moodAfter, null);
  });
});

describe("meditation — breathwork pacer + soundscape config", () => {
  it("breathwork returns a real pattern with computed totalSeconds", () => {
    const r = call("breathwork", ctxA, { pattern: "box", cycles: 4 });
    assert.equal(r.ok, true);
    assert.equal(r.result.pattern, "box");
    assert.equal(r.result.cycles, 4);
    assert.equal(r.result.totalSeconds, r.result.cycleSeconds * 4);
    assert.ok(Array.isArray(r.result.phases));
  });

  it("breathwork clamps cycles and defaults an unknown pattern to box", () => {
    assert.equal(call("breathwork", ctxA, { pattern: "nonsense" }).result.pattern, "box");
    assert.equal(call("breathwork", ctxA, { cycles: 9999 }).result.cycles, 60);
    // cycles:0 is falsy → defaults to 8 (Number(0)||8); cycles:-2 clamps up to 1.
    assert.equal(call("breathwork", ctxA, { cycles: 0 }).result.cycles, 8);
    assert.equal(call("breathwork", ctxA, { cycles: -2 }).result.cycles, 1);
  });

  it("soundscapeConfig returns a synthesis descriptor for a soundscape track", () => {
    const r = call("soundscapeConfig", ctxA, { sessionId: "sc-rain" });
    assert.equal(r.ok, true);
    assert.equal(r.result.kind, "soundscape");
    assert.equal(r.result.noise, "pink");
    assert.equal(r.result.droplets, true);
  });

  it("soundscapeConfig falls back to a tone bed for a guided track", () => {
    const r = call("soundscapeConfig", ctxA, { sessionId: "g-focus-10" });
    assert.equal(r.result.kind, "tone_bed");
    assert.equal(r.result.category, "guided");
    assert.ok(Array.isArray(r.result.drone));
  });

  it("soundscapeConfig rejects an unknown sessionId", () => {
    const r = call("soundscapeConfig", ctxA, { sessionId: "ghost-track" });
    assert.equal(r.ok, false);
  });

  it("sleepTimerConfig computes a fade curve from clamped minutes/fadeSeconds", () => {
    const r = call("sleepTimerConfig", ctxA, { sessionId: "s-rain-30", minutes: 20, fadeSeconds: 45 });
    assert.equal(r.ok, true);
    assert.equal(r.result.sleepStory, true);
    assert.equal(r.result.totalSeconds, 20 * 60);
    assert.equal(r.result.fadeStartSeconds, 20 * 60 - 45);
    assert.equal(r.result.fadeCurve[r.result.fadeCurve.length - 1].volume, 0);
  });
});

describe("meditation — mood check-in ledger", () => {
  it("records a check-in and reflects it in mood-history with an average", () => {
    call("mood-checkin", ctxA, { mood: 4, note: "calm after the sit" });
    call("mood-checkin", ctxA, { mood: 2 });
    const h = call("mood-history", ctxA, {});
    assert.equal(h.ok, true);
    assert.equal(h.result.count, 2);
    assert.equal(h.result.averageMood, 3); // (4+2)/2
    assert.equal(h.result.moods[0].mood, 2); // most-recent first
  });

  it("clamps a poisoned mood into [1,5] and is per-user isolated", () => {
    assert.equal(call("mood-checkin", ctxA, { mood: 99 }).result.checkin.mood, 5);
    assert.equal(call("mood-history", ctxB, {}).result.count, 0);
  });
});

describe("meditation — courses: enroll → complete day → progress", () => {
  it("lists courses, enrolls, and reflects enrollment", () => {
    const before = call("courses", ctxA, {});
    assert.equal(before.ok, true);
    assert.ok(before.result.courses.find((c) => c.id === "course-basics-7"));
    assert.equal(before.result.courses.find((c) => c.id === "course-basics-7").enrolled, false);

    const enrolled = call("enrollCourse", ctxA, { courseId: "course-basics-7" });
    assert.equal(enrolled.ok, true);
    assert.equal(enrolled.result.enrolled, true);

    const after = call("courses", ctxA, {});
    assert.equal(after.result.courses.find((c) => c.id === "course-basics-7").enrolled, true);
  });

  it("completing a day advances progress AND logs the underlying session", () => {
    call("enrollCourse", ctxA, { courseId: "course-basics-7" });
    const done = call("completeCourseDay", ctxA, { courseId: "course-basics-7", day: 1 });
    assert.equal(done.ok, true);
    assert.equal(done.result.completedCount, 1);
    assert.equal(done.result.finished, false);

    const prog = call("courseProgress", ctxA, { courseId: "course-basics-7" });
    assert.equal(prog.result.completedCount, 1);
    assert.equal(prog.result.dayCount, 7);
    assert.equal(prog.result.nextDay, 2);
    assert.equal(prog.result.days[0].completed, true);

    // The day-1 session (g-morn-7) cascaded into the practice ledger.
    const hist = call("history", ctxA, {});
    assert.equal(hist.result.count, 1);
    assert.equal(hist.result.sessions[0].courseId, "course-basics-7");
    assert.equal(hist.result.sessions[0].courseDay, 1);
  });

  it("completing every day flips finished=true", () => {
    call("enrollCourse", ctxA, { courseId: "course-sleep-5" });
    for (let d = 1; d <= 5; d++) call("completeCourseDay", ctxA, { courseId: "course-sleep-5", day: d });
    const prog = call("courseProgress", ctxA, { courseId: "course-sleep-5" });
    assert.equal(prog.result.finished, true);
    assert.equal(prog.result.nextDay, null);
  });

  it("rejects an unknown course / day", () => {
    assert.equal(call("enrollCourse", ctxA, { courseId: "ghost" }).ok, false);
    call("enrollCourse", ctxA, { courseId: "course-basics-7" });
    assert.equal(call("completeCourseDay", ctxA, { courseId: "course-basics-7", day: 99 }).ok, false);
  });
});

describe("meditation — reminders lifecycle", () => {
  it("set → list → toggle → delete a reminder round-trip", () => {
    const set = call("setReminder", ctxA, { time: "07:30", days: ["mon", "wed", "fri"], label: "Morning sit" });
    assert.equal(set.ok, true);
    const id = set.result.reminder.id;
    assert.equal(set.result.reminder.time, "07:30");
    assert.deepEqual(set.result.reminder.days, ["mon", "wed", "fri"]);

    const list = call("reminders", ctxA, {});
    assert.equal(list.result.count, 1);

    const toggled = call("toggleReminder", ctxA, { reminderId: id, enabled: false });
    assert.equal(toggled.result.enabled, false);

    const del = call("deleteReminder", ctxA, { reminderId: id });
    assert.equal(del.ok, true);
    assert.equal(call("reminders", ctxA, {}).result.count, 0);
  });

  it("rejects a malformed time and an unknown reminder id", () => {
    assert.equal(call("setReminder", ctxA, { time: "25:99" }).ok, false);
    assert.equal(call("toggleReminder", ctxA, { reminderId: "nope" }).ok, false);
    assert.equal(call("deleteReminder", ctxA, { reminderId: "nope" }).ok, false);
  });

  it("an empty days[] defaults to every day", () => {
    const r = call("setReminder", ctxA, { time: "09:00" });
    assert.equal(r.result.reminder.days.length, 7);
  });
});

describe("meditation — recommendations + milestones (history-adaptive)", () => {
  it("recommendations infer a sleep goal late at night", () => {
    const r = call("recommendations", ctxA, { hour: 23 });
    assert.equal(r.ok, true);
    assert.equal(r.result.goal, "sleep");
    assert.ok(r.result.recommendations.length > 0);
  });

  it("recommendations lean anxiety after a low mood check-in", () => {
    call("mood-checkin", ctxA, { mood: 1 });
    const r = call("recommendations", ctxA, { hour: 14 });
    assert.equal(r.result.goal, "anxiety");
    assert.equal(r.result.basedOn.recentMood, 1);
  });

  it("milestones unlock at real thresholds from accrued practice", () => {
    // No practice → first-sit locked, progress 0.
    const empty = call("milestones", ctxA, {});
    assert.equal(empty.result.unlockedCount, 0);
    assert.equal(empty.result.badges.find((b) => b.id === "first-sit").unlocked, false);

    // One sit → first-sit unlocks.
    call("play", ctxA, { sessionId: "g-focus-10" });
    const one = call("milestones", ctxA, {});
    assert.equal(one.result.badges.find((b) => b.id === "first-sit").unlocked, true);
    assert.ok(one.result.unlockedCount >= 1);
    assert.equal(one.result.metrics.sessions, 1);
    assert.equal(one.result.metrics.minutes, 10);
  });
});
