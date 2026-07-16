// server/tests/depth/productivity-reminder-delivery-behavior.test.js
//
// Behavioral coverage for the productivity-reminder-sweep heartbeat — the
// real-time (socket-connected-tab) delivery channel that closes
// docs/WAVE4_INVENTORY.md row 282 ("No reminder delivery channel (on-demand
// check only)"). Honest scope: this is NOT an OS-level push notification —
// this codebase has no service-worker Web Push pipeline. The sweep pushes a
// `productivity:reminder-fired` event to a user's `user:${userId}` socket
// room (the room every authenticated socket auto-joins — server.js:8535)
// the moment a reminder becomes due, and marks it fired using the EXACT
// same computeDueReminders/markRemindersFired helpers reminders-due's
// markFired path already used before this change (refactored to share
// logic, not duplicate it).
//
// Run: node --test tests/depth/productivity-reminder-delivery-behavior.test.js

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerProductivityActions from "../../domains/productivity.js";
import { runHeartbeatModuleNow } from "../../emergent/heartbeat-registry.js";
import { validateEvent } from "../../lib/event-shapes.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`productivity.${name}`);
  assert.ok(fn, `productivity.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };
const dayOffset = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

let emitted;
function installRealtimeMock() {
  emitted = [];
  globalThis._concordREALTIME = {
    io: {
      to: (room) => ({
        emit: (name, payload) => { emitted.push({ room, name, payload }); },
      }),
    },
  };
}

// registerHeartbeat throws if `handler` isn't a function / frequency isn't a
// positive int — a successful `before()` already proves registration
// succeeded once; heartbeat REGISTRY entries persist for the process
// lifetime (Map.set is idempotent), so re-registering in beforeEach isn't
// needed and would just be redundant work.
before(() => { registerProductivityActions(register); });

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  installRealtimeMock();
});

async function runSweep() {
  return runHeartbeatModuleNow("productivity-reminder-sweep", {
    state: globalThis._concordSTATE,
    db: null,
    reason: "test",
  });
}

describe("productivity-reminder-sweep — heartbeat identifies + fires due reminders", () => {
  it("identifies a reminder that just became due and marks it fired via the shared markFired logic", async () => {
    const t = call("task-add", ctxA, { content: "Ping" }).result.task;
    const r = call("reminder-add", ctxA, { taskId: t.id, remindAt: dayOffset(-1) + "T09:00" }).result.reminder;
    assert.equal(r.fired, false);

    const res = await runSweep();
    assert.equal(res.ok, true);

    // Assert against real state, not just "it ran": the reminder row itself
    // is flipped, and reminders-due (the pre-existing manual path) now
    // reports it as no longer due — same contract markFired always had.
    const listed = call("reminder-list", ctxA, {}).result.reminders.find((x) => x.id === r.id);
    assert.equal(listed.fired, true);
    assert.equal(call("reminders-due", ctxA, {}).result.count, 0);
  });

  it("does not touch a reminder that is not yet due", async () => {
    const t = call("task-add", ctxA, { content: "Later" }).result.task;
    const r = call("reminder-add", ctxA, { taskId: t.id, remindAt: dayOffset(5) + "T09:00" }).result.reminder;

    await runSweep();

    const listed = call("reminder-list", ctxA, {}).result.reminders.find((x) => x.id === r.id);
    assert.equal(listed.fired, false);
  });

  it("does not re-fire (and does not re-deliver) an already-fired reminder on a subsequent sweep", async () => {
    const t = call("task-add", ctxA, { content: "Once" }).result.task;
    call("reminder-add", ctxA, { taskId: t.id, remindAt: dayOffset(-1) + "T09:00" });

    await runSweep();
    assert.equal(emitted.length, 1);

    // Second sweep pass — nothing new should fire or deliver.
    emitted = [];
    await runSweep();
    assert.equal(emitted.length, 0);
  });
});

describe("productivity-reminder-sweep — real per-user socket delivery", () => {
  it("emits productivity:reminder-fired to the exact user:<id> room with the right userId + reminder payload", async () => {
    const t = call("task-add", ctxA, { content: "Stand up" }).result.task;
    const r = call("reminder-add", ctxA, { taskId: t.id, remindAt: dayOffset(-1) + "T09:00", note: "ring me" }).result.reminder;

    await runSweep();

    assert.equal(emitted.length, 1);
    const evt = emitted[0];
    assert.equal(evt.room, "user:user_a");
    assert.equal(evt.name, "productivity:reminder-fired");
    assert.equal(evt.payload.userId, "user_a");
    assert.equal(evt.payload.reminder.id, r.id);
    assert.equal(evt.payload.reminder.taskId, t.id);
    assert.equal(evt.payload.reminder.task, "Stand up");
    assert.equal(evt.payload.reminder.note, "ring me");
    assert.equal(evt.payload.reminder.kind, "time");
    assert.ok(typeof evt.payload.ts === "number");
  });

  it("delivers independently per user — one user's due reminder never reaches another user's room", async () => {
    const ta = call("task-add", ctxA, { content: "A's task" }).result.task;
    const tb = call("task-add", ctxB, { content: "B's task" }).result.task;
    call("reminder-add", ctxA, { taskId: ta.id, remindAt: dayOffset(-1) + "T09:00" });
    call("reminder-add", ctxB, { taskId: tb.id, remindAt: dayOffset(-1) + "T09:00" });

    await runSweep();

    assert.equal(emitted.length, 2);
    const rooms = emitted.map((e) => e.room).sort();
    assert.deepEqual(rooms, ["user:user_a", "user:user_b"]);
  });
});

describe("productivity-reminder-sweep — offline user (no connected socket)", () => {
  it("still correctly marks the reminder fired with no crash when REALTIME is unavailable", async () => {
    globalThis._concordREALTIME = null; // simulate: no socket transport wired up at all
    const t = call("task-add", ctxB, { content: "Offline" }).result.task;
    const r = call("reminder-add", ctxB, { taskId: t.id, remindAt: dayOffset(-1) + "T09:00" }).result.reminder;

    await assert.doesNotReject(() => runSweep());

    const listed = call("reminder-list", ctxB, {}).result.reminders.find((x) => x.id === r.id);
    assert.equal(listed.fired, true, "reminder is still marked fired even with no live delivery");
  });

  it("still correctly marks fired when REALTIME.io has no matching room/emit surface", async () => {
    globalThis._concordREALTIME = { io: null };
    const t = call("task-add", ctxB, { content: "No IO" }).result.task;
    const r = call("reminder-add", ctxB, { taskId: t.id, remindAt: dayOffset(-1) + "T09:00" }).result.reminder;

    await assert.doesNotReject(() => runSweep());

    const listed = call("reminder-list", ctxB, {}).result.reminders.find((x) => x.id === r.id);
    assert.equal(listed.fired, true);
  });
});

describe("productivity-reminder-sweep — defensive against malformed state", () => {
  it("never throws given a corrupt reminders list mixed with a legitimate due reminder", async () => {
    const t = call("task-add", ctxA, { content: "Good one" }).result.task;
    const good = call("reminder-add", ctxA, { taskId: t.id, remindAt: dayOffset(-1) + "T09:00" }).result.reminder;

    // Reach past the public macro surface (which validates on the way in)
    // to simulate a corrupted in-memory record — e.g. from a future bad
    // migration/import path — mixed into the same user's array.
    const map = globalThis._concordSTATE.productivityLens.reminders;
    map.get("user_a").push(
      null,
      undefined,
      "garbage-string",
      42,
      { kind: "time" }, // missing remindAt entirely
      { kind: "time", remindAt: 1234567 }, // remindAt not a string
      { kind: "time", remindAt: "not-a-date" },
      { id: "no-kind-field", remindAt: dayOffset(-1) + "T09:00" }, // no kind
    );

    await assert.doesNotReject(() => runSweep());

    // The legitimate reminder in the same array is still correctly
    // processed despite the garbage neighbors. Read the raw map directly
    // rather than through reminder-list — reminder-list is a pre-existing,
    // unrelated macro that (like the rest of the public surface) has never
    // had to defend against hand-corrupted records, since reminder-add
    // always validates on the way in; this test is only about the sweep's
    // own defensiveness against data it didn't itself create.
    const rawList = map.get("user_a");
    const listed = rawList.find((x) => x && x.id === good.id);
    assert.ok(listed, "legitimate reminder survives alongside the corrupt entries");
    assert.equal(listed.fired, true);
    assert.equal(emitted.some((e) => e.payload?.reminder?.id === good.id), true);
  });

  it("never throws when a user's reminders value is not an array at all", async () => {
    globalThis._concordSTATE.productivityLens = { reminders: new Map([["user_c", "not-an-array"]]) };
    await assert.doesNotReject(() => runSweep());
  });

  it("never throws when productivityLens.reminders is missing entirely", async () => {
    globalThis._concordSTATE.productivityLens = {};
    await assert.doesNotReject(() => runSweep());
  });

  it("never throws when STATE itself has no productivityLens at all", async () => {
    globalThis._concordSTATE = { dtus: new Map() };
    await assert.doesNotReject(() => runSweep());
  });
});

describe("reminders-due manual check — unchanged regression", () => {
  it("surfaces past-due time reminders and marks them fired on explicit markFired (pre-existing contract)", () => {
    const t = call("task-add", ctxA, { content: "Ping" }).result.task;
    call("reminder-add", ctxA, { taskId: t.id, remindAt: dayOffset(-1) + "T09:00" });
    call("reminder-add", ctxA, { taskId: t.id, remindAt: dayOffset(5) + "T09:00" });
    const due = call("reminders-due", ctxA, { markFired: true });
    assert.equal(due.result.count, 1);
    assert.equal(call("reminders-due", ctxA, {}).result.count, 0);
  });

  it("without markFired, reminders-due is read-only — nothing gets marked fired", () => {
    const t = call("task-add", ctxA, { content: "Read only" }).result.task;
    call("reminder-add", ctxA, { taskId: t.id, remindAt: dayOffset(-1) + "T09:00" });
    const due1 = call("reminders-due", ctxA, {});
    assert.equal(due1.result.count, 1);
    const due2 = call("reminders-due", ctxA, {});
    assert.equal(due2.result.count, 1, "still due — no markFired means no mutation");
  });

  it("manual check still works after the background sweep already fired a reminder", async () => {
    const t = call("task-add", ctxA, { content: "Swept first" }).result.task;
    call("reminder-add", ctxA, { taskId: t.id, remindAt: dayOffset(-1) + "T09:00" });
    await runSweep();
    // The manual check now correctly reports nothing due (already fired by
    // the sweep) rather than erroring or double-firing.
    const due = call("reminders-due", ctxA, { markFired: true });
    assert.equal(due.result.count, 0);
  });
});

describe("event-shapes.js — productivity:reminder-fired", () => {
  it("validates the full payload the sweep actually emits", () => {
    const r = validateEvent("productivity:reminder-fired", {
      userId: "user_a",
      reminder: { id: "rem_1", taskId: "tsk_1", task: "Ping", remindAt: "2026-07-15T09:00", note: "", kind: "time" },
      ts: Date.now(), // realtime-emit reserved field — must not count as "unknown"
    });
    assert.equal(r.ok, true);
  });

  it("rejects a payload missing the required reminder field", () => {
    const r = validateEvent("productivity:reminder-fired", { userId: "user_a" });
    assert.equal(r.ok, false);
    assert.deepEqual(r.missing, ["reminder"]);
  });

  it("rejects an unknown top-level field (typo protection)", () => {
    const r = validateEvent("productivity:reminder-fired", {
      userId: "user_a", reminder: { id: "rem_1" }, remindr: "typo",
    });
    assert.equal(r.ok, false);
    assert.deepEqual(r.unknown, ["remindr"]);
  });
});
