// Tier-2 contract tests for affect lens mood-tracking parity macros
// (checkin / checkinHistory / trends / activityCorrelation / journalPrompts /
//  setReminder / nudges / exportReport / getScale / setScale).
// Pins streak math, per-user scoping, correlation logic, and CSV export shape.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerAffectActions from "../domains/affect.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  ACTIONS.set(`${domain}.${name}`, fn);
}
function call(name, ctx, params = {}, data = {}) {
  const fn = ACTIONS.get(`affect.${name}`);
  if (!fn) throw new Error(`affect.${name} not registered`);
  return fn(ctx, { id: null, data, meta: {} }, params);
}

before(() => {
  registerAffectActions(register);
});

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("affect — daily check-in + streak", () => {
  it("records a real check-in and returns a streak of 1", () => {
    const r = call("checkin", ctxA, { mood: 4, note: "decent day", activities: ["walk", "Reading"] });
    assert.equal(r.ok, true);
    assert.equal(r.result.entry.mood, 4);
    assert.equal(r.result.entry.moodLabel, "Good");
    assert.deepEqual(r.result.entry.activities, ["walk", "reading"]);
    assert.equal(r.result.currentStreak, 1);
    assert.equal(r.result.totalCheckins, 1);
  });

  it("rejects an out-of-range mood", () => {
    const r = call("checkin", ctxA, { mood: 9 });
    assert.equal(r.ok, false);
    assert.match(r.error, /between/);
  });

  it("INVARIANT: check-ins are scoped per-user", () => {
    call("checkin", ctxA, { mood: 5 });
    const b = call("checkinHistory", ctxB);
    assert.equal(b.result.totalCheckins, 0);
  });

  it("checkinHistory reports streak and today flag", () => {
    call("checkin", ctxA, { mood: 3 });
    const h = call("checkinHistory", ctxA);
    assert.equal(h.ok, true);
    assert.equal(h.result.checkedInToday, true);
    assert.equal(h.result.currentStreak, 1);
    assert.equal(h.result.entries.length, 1);
  });
});

describe("affect — trends", () => {
  it("returns hasData false with no check-ins", () => {
    const r = call("trends", ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.hasData, false);
  });

  it("computes daily averages and overall average from real entries", () => {
    call("checkin", ctxA, { mood: 2 });
    call("checkin", ctxA, { mood: 4 });
    const r = call("trends", ctxA);
    assert.equal(r.result.hasData, true);
    assert.equal(r.result.overallAvg, 3);
    assert.equal(r.result.entryCount, 2);
    assert.equal(r.result.dayOfWeek.length, 7);
  });
});

describe("affect — activity correlation", () => {
  it("returns hasData false with no entries", () => {
    const r = call("activityCorrelation", ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.hasData, false);
  });

  it("identifies an activity that lifts mood above baseline", () => {
    call("checkin", ctxA, { mood: 5, activities: ["exercise"] });
    call("checkin", ctxA, { mood: 5, activities: ["exercise"] });
    call("checkin", ctxA, { mood: 1, activities: ["work"] });
    call("checkin", ctxA, { mood: 1, activities: ["work"] });
    const r = call("activityCorrelation", ctxA, { minSamples: 2 });
    assert.equal(r.result.hasData, true);
    const ex = r.result.correlations.find((c) => c.activity === "exercise");
    assert.equal(ex.effect, "lifts");
    assert.ok(ex.delta > 0);
  });
});

describe("affect — journal prompts", () => {
  it("returns a deterministic set of prompts", () => {
    const r1 = call("journalPrompts", ctxA, { count: 3 });
    const r2 = call("journalPrompts", ctxA, { count: 3 });
    assert.equal(r1.ok, true);
    assert.equal(r1.result.prompts.length, 3);
    assert.deepEqual(r1.result.prompts, r2.result.prompts);
  });

  it("a check-in can carry a journal prompt answer", () => {
    const r = call("checkin", ctxA, { mood: 3, promptId: "prompt_0", promptAnswer: "today was calm" });
    assert.equal(r.result.entry.promptAnswer, "today was calm");
  });
});

describe("affect — reminders + nudges", () => {
  it("creates a reminder with defaults", () => {
    const r = call("setReminder", ctxA, { condition: "daily" });
    assert.equal(r.ok, true);
    assert.equal(r.result.reminder.time, "20:00");
    assert.equal(r.result.reminder.condition, "daily");
  });

  it("surfaces a daily nudge when not yet checked in", () => {
    call("setReminder", ctxA, { condition: "daily" });
    const r = call("nudges", ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.checkedInToday, false);
    assert.equal(r.result.due.length, 1);
    assert.equal(r.result.due[0].type, "daily");
  });

  it("daily nudge clears after a check-in", () => {
    call("setReminder", ctxA, { condition: "daily" });
    call("checkin", ctxA, { mood: 4 });
    const r = call("nudges", ctxA);
    assert.equal(r.result.due.length, 0);
  });
});

describe("affect — export report", () => {
  it("exports CSV rows from real check-ins", () => {
    call("checkin", ctxA, { mood: 4, note: "good", activities: ["walk"] });
    const r = call("exportReport", ctxA, { format: "csv" });
    assert.equal(r.ok, true);
    assert.equal(r.result.rows.length, 1);
    assert.match(r.result.csv, /^date,mood,moodLabel/);
    assert.equal(r.result.summary.entryCount, 1);
    assert.equal(r.result.summary.avgMood, 4);
  });
});

describe("affect — customizable mood scale", () => {
  it("returns the default 5-point scale", () => {
    const r = call("getScale", ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.scale.points.length, 5);
    assert.equal(r.result.isCustom, false);
  });

  it("sets a custom scale and rejects duplicate values", () => {
    const ok = call("setScale", ctxA, {
      points: [
        { value: 1, label: "Low", emoji: "🌧" },
        { value: 2, label: "Mid", emoji: "⛅" },
        { value: 3, label: "High", emoji: "☀️" },
      ],
    });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.scale.points.length, 3);
    const dup = call("setScale", ctxA, {
      points: [
        { value: 1, label: "A" },
        { value: 1, label: "B" },
      ],
    });
    assert.equal(dup.ok, false);
    assert.match(dup.error, /unique/);
  });

  it("custom scale governs check-in range validation", () => {
    call("setScale", ctxA, {
      points: [
        { value: 1, label: "Low" },
        { value: 2, label: "Mid" },
        { value: 3, label: "High" },
      ],
    });
    const over = call("checkin", ctxA, { mood: 5 });
    assert.equal(over.ok, false);
    const ok = call("checkin", ctxA, { mood: 3 });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.entry.moodLabel, "High");
  });

  it("reset returns to the default 5-point scale", () => {
    call("setScale", ctxA, {
      points: [
        { value: 1, label: "Low" },
        { value: 2, label: "High" },
      ],
    });
    const reset = call("setScale", ctxA, { reset: true });
    assert.equal(reset.ok, true);
    assert.equal(reset.result.isCustom, false);
    assert.equal(reset.result.scale.points.length, 5);
  });
});

describe("affect — trends buckets + day-of-week", () => {
  it("produces weekly buckets and a 7-slot day-of-week array", () => {
    call("checkin", ctxA, { mood: 3 });
    call("checkin", ctxA, { mood: 5 });
    const r = call("trends", ctxA, { granularity: "week" });
    assert.equal(r.result.hasData, true);
    assert.equal(r.result.granularity, "week");
    assert.ok(r.result.buckets.length >= 1);
    assert.equal(r.result.dayOfWeek.length, 7);
    assert.ok(r.result.daily.length >= 1);
  });
});

describe("affect — reminder update path", () => {
  it("updates an existing reminder in place", () => {
    const created = call("setReminder", ctxA, { condition: "daily" });
    const updated = call("setReminder", ctxA, {
      id: created.result.reminder.id,
      time: "07:30",
      condition: "streak_risk",
      enabled: false,
    });
    assert.equal(updated.ok, true);
    assert.equal(updated.result.reminder.time, "07:30");
    assert.equal(updated.result.reminder.condition, "streak_risk");
    assert.equal(updated.result.reminder.enabled, false);
  });

  it("returns an error for an unknown reminder id", () => {
    const r = call("setReminder", ctxA, { id: "rem_nonexistent" });
    assert.equal(r.ok, false);
    assert.match(r.error, /not found/);
  });
});

describe("affect — low-mood nudge", () => {
  it("surfaces a low_mood nudge when recent average is low", () => {
    call("setReminder", ctxA, { condition: "low_mood" });
    call("checkin", ctxA, { mood: 2 });
    call("checkin", ctxA, { mood: 1 });
    const r = call("nudges", ctxA);
    assert.equal(r.ok, true);
    const low = r.result.due.find((d) => d.type === "low_mood");
    assert.ok(low, "expected a low_mood nudge");
  });
});
