// scheduling-message-sweep.test.js — Message scheduled sends fire on the
// platform's clock (scheduling slice, 2026-11-14).
//
// Premise (verified at head before the fix): message.schedule-send stored
// into STATE.messageLens.scheduled, and the flush primitive
// (schedule-flush-due) existed — "call this on demand or wire to a
// heartbeat" — but nothing wired it. Its only caller was a manual
// "Flush due now" button, so a scheduled send fired only if its author
// opened the Scheduled panel and pressed the button (R4's dated read:
// the throwaway stood past due and never reached its channel).
//
// These tests register the REAL domain against a fresh STATE, schedule
// real sends through the real actions, rewind their sendAt in state
// (time control), and drive the REAL heartbeat registry — the sweep the
// domain now registers must fire the due send into its channel.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import registerMessageActions from "../domains/message.js";
import { tickAllRegistered, _resetHeartbeatRegistry } from "../emergent/heartbeat-registry.js";

function setup(userId = "u-sender") {
  _resetHeartbeatRegistry();
  globalThis._concordSTATE = {};
  const actions = new Map();
  registerMessageActions((domain, name, handler) => actions.set(name, handler));
  const ctx = { actor: { userId, displayName: "Sender One" } };
  const call = (name, params = {}) => actions.get(name)(ctx, {}, params);
  return { actions, call, ctx, userId };
}

async function makeDue(call, ctx, userId, body, { dueInPast = true } = {}) {
  const ch = call("channels-create", { name: `ch-${Math.random().toString(36).slice(2, 8)}` });
  const channelId = ch.result.channel.id;
  const sendAt = new Date(Date.now() + 60_000).toISOString();
  const sched = call("schedule-send", { channelId, body, sendAt });
  assert.equal(sched.ok, true);
  const id = sched.result.scheduled.id;
  if (dueInPast) {
    const item = globalThis._concordSTATE.messageLens.scheduled.get(userId).find((x) => x.id === id);
    item.sendAt = new Date(Date.now() - 1000).toISOString();
  }
  return { channelId, id };
}

describe("message-scheduled-sweep — the heartbeat fires due scheduled sends", () => {
  it("a past-due scheduled send FIRES at a due tick and lands in its channel", async () => {
    const { call, ctx, userId } = setup();
    const { channelId, id } = await makeDue(call, ctx, userId, "sweep delivered this");

    await tickAllRegistered({ state: globalThis._concordSTATE, db: null, tickCount: 2 });

    const list = call("messages-list", { channelId });
    const delivered = list.result.messages.find((m) => m.scheduledFrom === id);
    assert.ok(delivered, "the due send is a real message in the channel");
    assert.equal(delivered.body, "sweep delivered this");
    assert.equal(delivered.senderId, userId);
    const item = globalThis._concordSTATE.messageLens.scheduled.get(userId).find((x) => x.id === id);
    assert.equal(item.sent, true);
    // The manual flush still works and finds nothing left to do.
    const manual = call("schedule-flush-due", {});
    assert.equal(manual.result.sentCount, 0);
  });

  it("the sweep respects its cadence: an odd tick does not fire it", async () => {
    const { call, ctx, userId } = setup();
    const { id } = await makeDue(call, ctx, userId, "not yet");
    await tickAllRegistered({ state: globalThis._concordSTATE, db: null, tickCount: 3 });
    let item = globalThis._concordSTATE.messageLens.scheduled.get(userId).find((x) => x.id === id);
    assert.equal(item.sent, false);
    await tickAllRegistered({ state: globalThis._concordSTATE, db: null, tickCount: 4 });
    item = globalThis._concordSTATE.messageLens.scheduled.get(userId).find((x) => x.id === id);
    assert.equal(item.sent, true);
  });

  it("a future send stays queued through a sweep", async () => {
    const { call, ctx, userId } = setup();
    const { channelId, id } = await makeDue(call, ctx, userId, "future body", { dueInPast: false });
    await tickAllRegistered({ state: globalThis._concordSTATE, db: null, tickCount: 2 });
    const item = globalThis._concordSTATE.messageLens.scheduled.get(userId).find((x) => x.id === id);
    assert.equal(item.sent, false);
    const list = call("messages-list", { channelId });
    assert.equal(list.result.messages.length, 0);
    const queued = call("schedule-list", {});
    assert.ok(queued.result.scheduled.some((x) => x.id === id));
  });

  it("the kill-switch holds the sweep (CONCORD_MESSAGE_SCHEDULE_SWEEP=0)", async () => {
    const { call, ctx, userId } = setup();
    const { id } = await makeDue(call, ctx, userId, "held by switch");
    process.env.CONCORD_MESSAGE_SCHEDULE_SWEEP = "0";
    try {
      await tickAllRegistered({ state: globalThis._concordSTATE, db: null, tickCount: 2 });
    } finally {
      delete process.env.CONCORD_MESSAGE_SCHEDULE_SWEEP;
    }
    const item = globalThis._concordSTATE.messageLens.scheduled.get(userId).find((x) => x.id === id);
    assert.equal(item.sent, false);
  });

  it("every user's queue drains in one sweep, not just the caller's", async () => {
    const a = setup("u-alpha");
    const { channelId: chA, id: idA } = await makeDue(a.call, a.ctx, "u-alpha", "alpha due");
    // A second user schedules into the SAME shared state.
    const actionsB = new Map();
    registerMessageActions((domain, name, handler) => actionsB.set(name, handler));
    const ctxB = { actor: { userId: "u-beta", displayName: "Beta" } };
    const callB = (name, params = {}) => actionsB.get(name)(ctxB, {}, params);
    const { channelId: chB, id: idB } = await makeDue(callB, ctxB, "u-beta", "beta due");

    await tickAllRegistered({ state: globalThis._concordSTATE, db: null, tickCount: 2 });

    assert.ok(a.call("messages-list", { channelId: chA }).result.messages.some((m) => m.scheduledFrom === idA));
    assert.ok(callB("messages-list", { channelId: chB }).result.messages.some((m) => m.scheduledFrom === idB));
  });
});
