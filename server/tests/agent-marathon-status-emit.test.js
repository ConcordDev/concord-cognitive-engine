/**
 * Pinning test for a realtime-emit-signature finding (DET-C batch 5):
 * server/lib/agent-marathon.js's terminal-status hook emitted
 * 'marathon:status' with only (event, payload) — no 3rd options argument.
 * server.js#realtimeEmit only room-scopes delivery to `user:<id>` when it
 * receives `userId` via that 3rd argument; a bare 2-arg call falls through
 * to a GLOBAL io.emit() broadcast, leaking every user's marathon
 * session_id/title to every connected socket instead of just the session
 * owner.
 *
 * The emit was extracted into `emitMarathonStatus` so it's directly
 * testable without spinning up the full runAgentLoop/brain pipeline that
 * `tickMarathon` needs to reach this code path in practice.
 *
 * Run: node --test server/tests/agent-marathon-status-emit.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { emitMarathonStatus } from "../lib/agent-marathon.js";

describe("agent-marathon.js — 'marathon:status' is room-scoped to the session owner", () => {
  let originalEmit;
  let calls;

  beforeEach(() => {
    originalEmit = globalThis._concordRealtimeEmit;
    calls = [];
    globalThis._concordRealtimeEmit = (event, payload, options) => calls.push({ event, payload, options });
  });
  afterEach(() => {
    if (originalEmit === undefined) delete globalThis._concordRealtimeEmit;
    else globalThis._concordRealtimeEmit = originalEmit;
  });

  it("passes userId via the 3rd realtimeEmit options argument on completion", () => {
    const session = { user_id: "marathoner-1", title: "Refactor the auth module" };
    emitMarathonStatus(session, "marathon_abc", "completed", 42);

    assert.equal(calls.length, 1);
    const call = calls[0];
    assert.equal(call.event, "marathon:status");
    // The real bug: userId must arrive via the options arg (3rd param),
    // which is what realtimeEmit's { userId = "" } destructure — and its
    // io.to(`user:${userId}`) room-scoping — actually reads. A bare 2-arg
    // call silently falls through to a global broadcast instead.
    assert.ok(
      call.options && typeof call.options.userId === "string" && call.options.userId.length > 0,
      "userId must be passed as the 3rd realtimeEmit argument (options), not payload alone",
    );
    assert.equal(call.options.userId, "marathoner-1");
    // The payload still carries user_id/session_id/status/title — those
    // fields are unchanged; only the missing room-scoping option was added.
    assert.equal(call.payload.user_id, "marathoner-1");
    assert.equal(call.payload.session_id, "marathon_abc");
    assert.equal(call.payload.status, "completed");
    assert.equal(call.payload.total_turns, 42);
  });

  it("also scopes a paused (blocked) status the same way", () => {
    const session = { user_id: "marathoner-2", title: "Migrate the billing schema" };
    emitMarathonStatus(session, "marathon_xyz", "paused", 7);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.userId, "marathoner-2");
    assert.equal(calls[0].payload.status, "paused");
  });

  it("never throws when no realtime emitter is installed", () => {
    delete globalThis._concordRealtimeEmit;
    assert.doesNotThrow(() => {
      emitMarathonStatus({ user_id: "u1", title: "t" }, "m1", "completed", 1);
    });
  });
});
