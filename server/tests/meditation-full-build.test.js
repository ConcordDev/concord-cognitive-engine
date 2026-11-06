// build(meditation) — S-MED-1..4 server pins.
//
// The practice record credited clicks: the play verb appended the
// full catalog duration on a bare call, course completion pushed the
// day's duration, and breathwork logged the catalog length for
// whatever was performed (58 claimed minutes against ≈6.9 performed
// in the first pass). These pins hold the performed-time contract:
// clicks save intent outside the totals, breathwork logs its measured
// seconds, course days complete only against a performed entry, a
// check-in requires a chosen mood, and the record is correctable.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerMeditationActions from "../domains/meditation.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(name, fn); }
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  assert.ok(fn, `meditation.${name} not registered`);
  return fn(ctx, { id: null, data: input || {}, meta: {} }, input || {});
}

before(() => { registerMeditationActions(register); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "user_a" } };
const ctxB = { actor: { userId: "user_b" } };

describe("meditation full build — performed time only (S-MED-1)", () => {
  it("play saves an intent and credits NOTHING", () => {
    const r = call("play", ctxA, { sessionId: "s-rain-30" });
    assert.equal(r.ok, true);
    assert.equal(r.result.credited, false);
    assert.equal(r.result.intent.sessionId, "s-rain-30");
    assert.equal(call("history", ctxA, {}).result.count, 0);
    assert.equal(call("streak", ctxA, {}).result.totalMinutes, 0);
    assert.equal(call("intents", ctxA, {}).result.count, 1);
    assert.equal(call("intents", ctxB, {}).result.count, 0);
  });

  it("a 44-second breathwork logs a session and ZERO minutes, seconds kept", () => {
    const r = call("sessionLog", ctxA, {
      trackId: "b-coh-6", title: "Coherent Breathing", category: "breathwork", performedSeconds: 44,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.entry.durationMin, 0);
    assert.equal(r.result.entry.durationSec, 44);
    const st = call("streak", ctxA, {});
    assert.equal(st.result.totalSessions, 1);
    assert.equal(st.result.totalMinutes, 0);
    const longer = call("sessionLog", ctxA, {
      trackId: "b-coh-6", title: "Coherent Breathing", category: "breathwork", performedSeconds: 132,
    });
    assert.equal(longer.result.entry.durationMin, 2);
  });

  it("a course day completes only against its performed entry, and writes nothing itself", () => {
    call("enrollCourse", ctxA, { courseId: "course-basics-7" });
    const refused = call("completeCourseDay", ctxA, { courseId: "course-basics-7", day: 1 });
    assert.equal(refused.ok, false);
    assert.equal(refused.error, "session_not_run");
    assert.equal(call("history", ctxA, {}).result.count, 0);
    // Day 1's session is g-morn-7 — practise it (performed), then complete.
    const sat = call("sessionLog", ctxA, {
      trackId: "g-morn-7", title: "Morning Intention", category: "guided", minutes: 7,
    });
    const done = call("completeCourseDay", ctxA, {
      courseId: "course-basics-7", day: 1, sessionEntryId: sat.result.entry.id,
    });
    assert.equal(done.ok, true);
    assert.equal(done.result.completedCount, 1);
    // The ledger holds exactly the one performed entry — no cascade.
    const hist = call("history", ctxA, {});
    assert.equal(hist.result.count, 1);
    assert.equal(hist.result.sessions[0].courseId, "course-basics-7");
    assert.equal(hist.result.sessions[0].courseDay, 1);
  });

  it("logging is idempotent under a logKey (F11's guard, proven)", () => {
    const first = call("sessionLog", ctxA, { trackId: "g-focus-10", minutes: 10, logKey: "sit-1" });
    const second = call("sessionLog", ctxA, { trackId: "g-focus-10", minutes: 10, logKey: "sit-1" });
    assert.equal(second.result.duplicate, true);
    assert.equal(second.result.entry.id, first.result.entry.id);
    assert.equal(call("history", ctxA, {}).result.count, 1);
  });
});

describe("meditation full build — labels and the journal (S-MED-2/4)", () => {
  it("no catalog entry carries a narrator credit", () => {
    const lib = call("library", ctxA, {});
    assert.ok(lib.result.sessions.every((x) => x.narrator === undefined));
    const pick = call("pickTrack", ctxA, { goal: "breath", minutes: 5 });
    assert.equal(pick.result.narrator, undefined);
  });

  it("the journal and the DTU link live on the entry and read back in history", () => {
    const r = call("sessionLog", ctxA, {
      trackId: "g-focus-10", minutes: 10, rating: 4, journal: "the hinge question",
    });
    assert.equal(r.result.entry.journal, "the hinge question");
    assert.equal(r.result.entry.moodAfter, 4);
    const attached = call("sessionSetDtu", ctxA, { entryId: r.result.entry.id, dtuId: "dtu_test_1" });
    assert.equal(attached.ok, true);
    const hist = call("history", ctxA, {});
    assert.equal(hist.result.sessions[0].journal, "the hinge question");
    assert.equal(hist.result.sessions[0].dtuId, "dtu_test_1");
  });
});

describe("meditation full build — lifecycle (S-MED-3)", () => {
  it("a check-in with no chosen mood records NOTHING", () => {
    const r = call("mood-checkin", ctxA, { note: "no mood sent" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "mood_required");
    assert.equal(call("mood-history", ctxA, {}).result.count, 0);
  });

  it("sessions and check-ins are deletable by their owner only", () => {
    const sat = call("sessionLog", ctxA, { trackId: "g-focus-10", minutes: 10 });
    const ci = call("mood-checkin", ctxA, { mood: 2 });
    assert.equal(call("sessionDelete", ctxB, { entryId: sat.result.entry.id }).ok, false);
    assert.equal(call("moodDelete", ctxB, { checkinId: ci.result.checkin.id }).ok, false);
    assert.equal(call("sessionDelete", ctxA, { entryId: sat.result.entry.id }).ok, true);
    assert.equal(call("moodDelete", ctxA, { checkinId: ci.result.checkin.id }).ok, true);
    assert.equal(call("history", ctxA, {}).result.count, 0);
    assert.equal(call("mood-history", ctxA, {}).result.count, 0);
  });

  it("course progress reverses: un-complete and unenroll", () => {
    call("enrollCourse", ctxA, { courseId: "course-basics-7" });
    const sat = call("sessionLog", ctxA, { trackId: "g-morn-7", minutes: 7 });
    call("completeCourseDay", ctxA, { courseId: "course-basics-7", day: 1, sessionEntryId: sat.result.entry.id });
    const un = call("uncompleteCourseDay", ctxA, { courseId: "course-basics-7", day: 1 });
    assert.equal(un.ok, true);
    assert.equal(un.result.completedCount, 0);
    // The performed entry stays in the ledger; its provenance clears.
    const hist = call("history", ctxA, {});
    assert.equal(hist.result.count, 1);
    assert.equal(hist.result.sessions[0].courseId, null);
    assert.equal(call("unenrollCourse", ctxA, { courseId: "course-basics-7" }).ok, true);
    assert.equal(call("courses", ctxA, {}).result.courses.find((c) => c.id === "course-basics-7").enrolled, false);
  });

  it("a reminder is editable in place", () => {
    const set = call("setReminder", ctxA, { time: "07:30", days: ["mon"], label: "Morning sit" });
    const id = set.result.reminder.id;
    const upd = call("updateReminder", ctxA, { reminderId: id, time: "06:45", label: "Earlier sit" });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.reminder.time, "06:45");
    assert.equal(upd.result.reminder.label, "Earlier sit");
    assert.equal(call("updateReminder", ctxA, { reminderId: id, time: "25:00" }).ok, false);
  });
});
