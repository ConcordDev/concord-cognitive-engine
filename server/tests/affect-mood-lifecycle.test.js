// S-AFF-7 pins (build(affect)) — mood lifecycle completions.
//
// F12: check-ins had create + read but no correction path — a mistapped
// mood or typo'd note was permanent, and the record could not be
// removed. updateCheckin / deleteCheckin complete the lifecycle.
// F13: the nudges macro returned only ENABLED reminders as
// result.reminders, so toggling one off made it vanish from the list
// as if deleted — and impossible to switch back on.
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

describe("S-AFF-7 check-in edit/delete (F12)", () => {
  it("updateCheckin edits mood + note and re-derives the label", () => {
    const created = call("checkin", ctxA, { mood: 2, note: "typo note" });
    const id = created.result.entry.id;
    const r = call("updateCheckin", ctxA, { id, mood: 5, note: "fixed note" });
    assert.equal(r.ok, true);
    assert.equal(r.result.entry.mood, 5);
    assert.equal(r.result.entry.moodLabel, "Great");
    assert.equal(r.result.entry.note, "fixed note");
    const h = call("checkinHistory", ctxA);
    assert.equal(h.result.entries[0].mood, 5);
    assert.equal(h.result.entries[0].note, "fixed note");
  });

  it("updateCheckin validates mood against the scale", () => {
    const created = call("checkin", ctxA, { mood: 3 });
    const r = call("updateCheckin", ctxA, { id: created.result.entry.id, mood: 9 });
    assert.equal(r.ok, false);
    assert.match(r.error, /between/);
  });

  it("update/delete are scoped to the owner", () => {
    const created = call("checkin", ctxA, { mood: 3 });
    const id = created.result.entry.id;
    assert.equal(call("updateCheckin", ctxB, { id, mood: 1 }).ok, false);
    assert.equal(call("deleteCheckin", ctxB, { id }).ok, false);
    assert.equal(call("checkinHistory", ctxA).result.totalCheckins, 1);
  });

  it("deleteCheckin removes the entry and derived views follow", () => {
    const a = call("checkin", ctxA, { mood: 5, activities: ["walk"] });
    call("checkin", ctxA, { mood: 1, activities: ["walk"] });
    const r = call("deleteCheckin", ctxA, { id: a.result.entry.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalCheckins, 1);
    const h = call("checkinHistory", ctxA);
    assert.equal(h.result.entries.length, 1);
    assert.equal(h.result.entries[0].mood, 1);
    // The correlation recomputes from what remains.
    const corr = call("activityCorrelation", ctxA, { minSamples: 1 });
    assert.equal(corr.result.correlations.length, 1);
    assert.equal(corr.result.correlations[0].samples, 1);
    assert.equal(corr.result.correlations[0].avgMood, 1);
  });

  it("deleting an unknown id is an honest error, not a silent ok", () => {
    const r = call("deleteCheckin", ctxA, { id: "chk_nope" });
    assert.equal(r.ok, false);
    assert.match(r.error, /not found/);
  });
});

describe("S-AFF-7 reminder toggle survival (F13)", () => {
  it("a disabled reminder stays in the list and produces no due nudge", () => {
    const created = call("setReminder", ctxA, { condition: "daily" });
    const id = created.result.reminder.id;
    const off = call("setReminder", ctxA, { id, time: "20:00", condition: "daily", enabled: false });
    assert.equal(off.ok, true);
    assert.equal(off.result.reminder.enabled, false);
    const n = call("nudges", ctxA);
    assert.equal(n.result.reminders.length, 1);
    assert.equal(n.result.reminders[0].enabled, false);
    assert.equal(n.result.due.length, 0);
    // And it can be switched back on.
    call("setReminder", ctxA, { id, time: "20:00", condition: "daily", enabled: true });
    const n2 = call("nudges", ctxA);
    assert.equal(n2.result.reminders[0].enabled, true);
    assert.equal(n2.result.due.length, 1);
  });
});

describe("S-AFF-7 correlation at n=1 (F14)", () => {
  it("a single activity log yields a row with its sample count", () => {
    call("checkin", ctxA, { mood: 5, activities: ["walk"] });
    const r = call("activityCorrelation", ctxA, { minSamples: 1 });
    assert.equal(r.result.hasData, true);
    assert.equal(r.result.correlations.length, 1);
    assert.equal(r.result.correlations[0].samples, 1);
    assert.equal(r.result.correlations[0].activity, "walk");
  });
});
