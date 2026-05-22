// Contract tests for server/domains/attention.js — focus-tool substrate macros.
// Exercises the Sunsama / Motion–class STATE-backed features: Pomodoro timer,
// daily planner, distraction log, focus analytics, focus-mode, calendar blocks,
// energy tagging and peak-hour discovery.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerAttentionActions from "../domains/attention.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`attention.${name}`);
  if (!fn) throw new Error(`attention.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerAttentionActions(register); });

// Fresh per-user STATE every test so assertions don't leak across cases.
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "att_user_a" }, userId: "att_user_a" };

// Backdate the live timer so pomodoroComplete logs a real (non-zero-minute)
// session — a sub-millisecond test run otherwise rounds actualMinutes to 0,
// which the macro correctly declines to record.
function backdateTimer(minutes) {
  const s = globalThis._concordSTATE?.attentionLens?.pomodoro;
  const timer = s?.get(ctxA.userId);
  if (timer) timer.startedAt = Date.now() - minutes * 60000;
}

describe("attention pure-compute macros", () => {
  it("focusScore handles empty + real session data", () => {
    const empty = ACTIONS.get("attention.focusScore")(ctxA, { id: null, data: {}, meta: {} }, {});
    assert.equal(empty.ok, true);
    const r = ACTIONS.get("attention.focusScore")(ctxA, {
      id: null, meta: {},
      data: { sessions: [
        { id: "s1", taskId: "t1", startTime: "2026-05-21T09:00:00Z", endTime: "2026-05-21T09:40:00Z", interruptions: 0 },
        { id: "s2", taskId: "t1", startTime: "2026-05-21T10:00:00Z", endTime: "2026-05-21T10:30:00Z", interruptions: 2 },
      ] },
    }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.sessionCount, 2);
    assert.ok(r.result.focusScore >= 0 && r.result.focusScore <= 100);
  });

  it("priorityMatrix buckets tasks into Eisenhower quadrants", () => {
    const r = ACTIONS.get("attention.priorityMatrix")(ctxA, {
      id: null, meta: {},
      data: { tasks: [
        { id: "a", name: "Ship", urgency: 9, importance: 9 },
        { id: "b", name: "Cleanup", urgency: 2, importance: 2 },
      ] },
    }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.quadrants["do-first"].count, 1);
    assert.equal(r.result.quadrants["eliminate"].count, 1);
  });

  it("attentionBudget schedules within a time budget", () => {
    const r = ACTIONS.get("attention.attentionBudget")(ctxA, {
      id: null, meta: {},
      data: { tasks: [{ id: "x", name: "Write", cognitiveLoad: 7, estimatedMinutes: 60, priority: 8 }] },
    }, { totalAvailableMinutes: 240 });
    assert.equal(r.ok, true);
    assert.equal(r.result.scheduledTasks, 1);
  });
});

describe("attention Pomodoro timer", () => {
  it("starts, reports status, records interruption, completes with a session", () => {
    const start = call("pomodoroStart", ctxA, { mode: "focus", durationMinutes: 25, taskName: "Deep work" });
    assert.equal(start.ok, true);
    assert.equal(start.result.timer.mode, "focus");

    const status = call("pomodoroStatus", ctxA, {});
    assert.equal(status.ok, true);
    assert.equal(status.result.timer.id, start.result.timer.id);
    assert.ok(status.result.remainingSeconds > 0);

    const intr = call("pomodoroInterrupt", ctxA, {});
    assert.equal(intr.ok, true);
    assert.equal(intr.result.timer.interruptions, 1);

    backdateTimer(25);
    const done = call("pomodoroComplete", ctxA, { energy: "high" });
    assert.equal(done.ok, true);
    assert.ok(done.result.session);
    assert.equal(done.result.session.energy, "high");
  });

  it("pomodoroInterrupt errors without an active timer", () => {
    const r = call("pomodoroInterrupt", ctxA, {});
    assert.equal(r.ok, false);
    assert.equal(r.error, "no_active_timer");
  });

  it("pomodoroStats aggregates completed focus sessions", () => {
    call("pomodoroStart", ctxA, { mode: "focus", durationMinutes: 25 });
    backdateTimer(25);
    call("pomodoroComplete", ctxA, {});
    const stats = call("pomodoroStats", ctxA, {});
    assert.equal(stats.ok, true);
    assert.equal(stats.result.totalSessions, 1);
    assert.ok(stats.result.today.sessions >= 1);
  });
});

describe("attention daily planner", () => {
  it("get → add → move → remove a timeboxed task", () => {
    const empty = call("plannerGet", ctxA, {});
    assert.equal(empty.ok, true);
    assert.equal(empty.result.day.tasks.length, 0);

    const add = call("plannerAddTask", ctxA, { name: "Design review", startMinute: 600, durationMinutes: 90 });
    assert.equal(add.ok, true);
    const taskId = add.result.task.id;

    const move = call("plannerMoveTask", ctxA, { taskId, startMinute: 660, done: true });
    assert.equal(move.ok, true);
    assert.equal(move.result.task.startMinute, 660);
    assert.equal(move.result.task.done, true);

    const remove = call("plannerRemoveTask", ctxA, { taskId });
    assert.equal(remove.ok, true);
    assert.equal(remove.result.day.tasks.length, 0);
  });

  it("plannerAddTask rejects an empty name", () => {
    const r = call("plannerAddTask", ctxA, { name: "" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "name_required");
  });
});

describe("attention distraction log", () => {
  it("logs an interruption and summarises it", () => {
    const log = call("distractionLog", ctxA, { source: "Slack", kind: "notification", durationMinutes: 3 });
    assert.equal(log.ok, true);

    const summary = call("distractionSummary", ctxA, {});
    assert.equal(summary.ok, true);
    assert.equal(summary.result.total, 1);
    assert.equal(summary.result.todayCount, 1);
    assert.equal(summary.result.topSources[0].source, "Slack");
  });

  it("distractionLog rejects a missing source", () => {
    const r = call("distractionLog", ctxA, {});
    assert.equal(r.ok, false);
    assert.equal(r.error, "source_required");
  });
});

describe("attention focus analytics", () => {
  it("returns daily + weekly trend windows", () => {
    call("pomodoroStart", ctxA, { mode: "focus", durationMinutes: 25 });
    backdateTimer(25);
    call("pomodoroComplete", ctxA, {});
    const r = call("focusAnalytics", ctxA, { days: 14 });
    assert.equal(r.ok, true);
    assert.equal(r.result.daily.length, 14);
    assert.ok(Array.isArray(r.result.weekly));
    assert.ok(["improving", "declining", "steady"].includes(r.result.deepWorkTrend));
  });
});

describe("attention focus-mode (DND)", () => {
  it("get default, enable, then disable", () => {
    const def = call("focusModeGet", ctxA, {});
    assert.equal(def.ok, true);
    assert.equal(def.result.mode.enabled, false);

    const on = call("focusModeSet", ctxA, { enabled: true });
    assert.equal(on.ok, true);
    assert.equal(on.result.mode.enabled, true);
    assert.ok(on.result.mode.mutedChannels.length > 0);

    const off = call("focusModeSet", ctxA, { enabled: false });
    assert.equal(off.ok, true);
    assert.equal(off.result.mode.enabled, false);
  });
});

describe("attention calendar focus blocks", () => {
  it("reserve, list, then release a block", () => {
    const res = call("calendarReserve", ctxA, { startMinute: 600, durationMinutes: 90, title: "Strategy" });
    assert.equal(res.ok, true);
    const blockId = res.result.block.id;

    const list = call("calendarBlocks", ctxA, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);

    const rel = call("calendarRelease", ctxA, { blockId });
    assert.equal(rel.ok, true);
    assert.equal(rel.result.released, true);
  });

  it("rejects an overlapping reservation", () => {
    call("calendarReserve", ctxA, { startMinute: 600, durationMinutes: 120 });
    const clash = call("calendarReserve", ctxA, { startMinute: 660, durationMinutes: 60 });
    assert.equal(clash.ok, false);
    assert.equal(clash.error, "time_conflict");
  });
});

describe("attention energy tagging + peak hours", () => {
  it("tags a session's energy and surfaces peak hours", () => {
    call("pomodoroStart", ctxA, { mode: "focus", durationMinutes: 25 });
    backdateTimer(25);
    const done = call("pomodoroComplete", ctxA, {});
    const sessionId = done.result.session.id;

    const tag = call("energyTag", ctxA, { sessionId, energy: "high", mood: "flow" });
    assert.equal(tag.ok, true);
    assert.equal(tag.result.session.energy, "high");

    const peak = call("peakHours", ctxA, {});
    assert.equal(peak.ok, true);
    assert.equal(peak.result.hourly.length, 24);
    assert.equal(peak.result.taggedSessions, 1);
  });

  it("energyTag rejects an unknown session", () => {
    const r = call("energyTag", ctxA, { sessionId: "nope", energy: "high" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "session_not_found");
  });
});
