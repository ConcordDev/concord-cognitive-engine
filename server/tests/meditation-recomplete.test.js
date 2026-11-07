// server/tests/meditation-recomplete.test.js
//
// Q22 (E-92): completeCourseDay deduped completedDays but pushed the
// practice-ledger session on EVERY call, so re-completing a day
// inflated totalSessions / totalMinutes. Pins: first completion logs
// exactly one session; repeats log none, report alreadyCompleted, and
// leave streak totals unchanged; a different day still logs.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerMeditationActions from "../domains/meditation.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, params = {}) {
  const fn = ACTIONS.get(`meditation.${name}`);
  if (!fn) throw new Error(`meditation.${name} not registered`);
  return fn({ actor: { userId: "med-1" } }, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerMeditationActions(register); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const COURSE = "course-basics-7";

const DAY_SESSION = { 1: "g-morn-7", 2: "g-focus-10" };
// S-MED-1: completing a day requires the day's session to have been PRACTISED — log it first.
function practise(day, seconds = 600) {
  const r = call("sessionLog", { trackId: DAY_SESSION[day], title: `Day ${day}`, performedSeconds: seconds });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.result.entry.id;
}

describe("meditation course-day completion (Q22, S-MED-1)", () => {
  it("completion without a practised session is refused and writes nothing", () => {
    const refused = call("completeCourseDay", { courseId: COURSE, day: 1 });
    assert.equal(refused.ok, false);
    assert.equal(refused.error, "session_not_run");
    assert.equal(call("history", {}).result.count, 0, "a bare click credits no session");
  });

  it("first completion of a practised day completes it; repeats add nothing and say so", () => {
    const entryId = practise(1);
    const first = call("completeCourseDay", { courseId: COURSE, day: 1, sessionEntryId: entryId });
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(first.result.alreadyCompleted, false);
    assert.equal(first.result.completedCount, 1);
    assert.equal(call("history", {}).result.count, 1);
    const before = call("streak", {}).result;
    assert.equal(before.totalSessions, 1);

    for (let i = 0; i < 3; i++) {
      const again = call("completeCourseDay", { courseId: COURSE, day: 1, sessionEntryId: entryId });
      assert.equal(again.ok, true);
      assert.equal(again.result.alreadyCompleted, true, "a repeat names itself");
      assert.equal(again.result.completedCount, 1, "course progress unchanged");
    }
    assert.equal(call("history", {}).result.count, 1, "no extra ledger sessions");
    const after = call("streak", {}).result;
    assert.equal(after.totalSessions, before.totalSessions, "session count not inflated");
    assert.equal(after.totalMinutes, before.totalMinutes, "minutes not inflated");
  });

  it("a different practised day advances course progress", () => {
    call("completeCourseDay", { courseId: COURSE, day: 1, sessionEntryId: practise(1) });
    const second = call("completeCourseDay", { courseId: COURSE, day: 2, sessionEntryId: practise(2) });
    assert.equal(second.ok, true, JSON.stringify(second));
    assert.equal(second.result.alreadyCompleted, false);
    assert.equal(second.result.completedCount, 2);
    assert.equal(call("history", {}).result.count, 2);
    const progress = call("courseProgress", { courseId: COURSE }).result;
    assert.equal(progress.completedCount, 2);
    assert.equal(progress.nextDay, 3);
  });
});
