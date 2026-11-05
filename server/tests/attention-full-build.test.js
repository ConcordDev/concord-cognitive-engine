// Attention full-build pins (S-ATT-3 deep-work rule · S-ATT-6 distraction
// lifecycle · S-ATT-2 trend honesty) against server/domains/attention.js.
// The substrate macros are STATE-backed; the driver ctx shape and STATE
// stubs mirror the shipped domain suites.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

globalThis._concordSTATE = {};
globalThis._concordSaveStateDebounced = () => {};

const actions = new Map();
const { default: registerAttention } = await import("../domains/attention.js");
registerAttention((lens, name, fn) => actions.set(name, fn));
const ctx = { userId: "u-att-test", actor: { userId: "u-att-test" } };
const art = { data: {} };
const call = (name, params = {}) => actions.get(name)(ctx, art, params);
const rewind = (mins) => {
  const timer = globalThis._concordSTATE.attentionLens.pomodoro.get("u-att-test");
  timer.startedAt -= mins * 60000;
};

describe("attention full-build", () => {
  it("an empty analytics window reports no-data, never a trend label", () => {
    const r = call("focusAnalytics", { days: 14 });
    assert.equal(r.result.deepWorkTrend, "no-data");
  });

  it("deep work: a short completed session without DND does not count", () => {
    call("pomodoroStart", { mode: "focus", durationMinutes: 25, taskName: "short" });
    rewind(3);
    const r = call("pomodoroComplete", {});
    assert.equal(r.result.session.deepWork, false);
    assert.equal(r.result.session.dndActive, false);
  });

  it("deep work: a short completed session under Do-Not-Disturb counts (F5)", () => {
    call("focusModeSet", { enabled: true });
    call("pomodoroStart", { mode: "focus", durationMinutes: 25, taskName: "dnd run" });
    rewind(3);
    const r = call("pomodoroComplete", {});
    assert.equal(r.result.session.dndActive, true);
    assert.equal(r.result.session.deepWork, true);
    const stats = call("pomodoroStats");
    assert.equal(stats.result.deepWorkSessions, 1);
    assert.equal(stats.result.totalSessions, 2);
  });

  it("distractionRemove deletes an entry and the aggregates recompute (F9)", () => {
    call("distractionLog", { source: "pin phone", kind: "notification", durationMinutes: 3 });
    const d2 = call("distractionLog", { source: "pin door", kind: "person", durationMinutes: 5 });
    let s = call("distractionSummary");
    assert.equal(s.result.total, 2);
    assert.equal(s.result.lostMinutes, 8);
    const rm = call("distractionRemove", { entryId: d2.result.entry.id });
    assert.equal(rm.ok, true);
    s = call("distractionSummary");
    assert.equal(s.result.total, 1);
    assert.equal(s.result.lostMinutes, 3);
    assert.equal(s.result.topSources[0].source, "pin phone");
  });

  it("distractionRemove on a missing entry is an honest error", () => {
    const rm = call("distractionRemove", { entryId: "dx_missing" });
    assert.equal(rm.ok, false);
    assert.equal(rm.error, "entry_not_found");
  });
});
