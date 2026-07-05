// Verification-audit fix — pins the correct `realtimeEmit` calling
// convention for the brawl-invite paths.
//
// `realtimeEmit`'s real signature (server.js:8066) is
// `realtimeEmit(event, payload, { sessionId, orgId, userId, requestId })`
// — the target room is derived INTERNALLY from `userId`/`sessionId`/
// `orgId` in the options object, never from a caller-built room string
// as the first argument. Two call sites used to call it the wrong way
// (`realtimeEmit(`user:${id}`, "brawl-invited", {...})`, as if the
// signature were `(room, event, payload)`), which meant a real
// `realtimeEmit` would fall through to an unscoped global `io.emit()`
// under a garbled event name instead of a room-scoped "brawl-invited".
//
// This test spies on `realtimeEmit` and asserts the brawl-queue
// heartbeat (`runBrawlQueueCycle`) calls it with the CORRECT shape:
// event name first, payload second, `{ userId }` third.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { runBrawlQueueCycle } from "../emergent/brawl-queue-cycle.js";
import { joinQueue, _reset } from "../lib/brawl.js";

describe("brawl-queue-cycle realtimeEmit call shape", () => {
  beforeEach(() => _reset());

  it("calls realtimeEmit(event, payload, { userId }) for both paired players — not (room, event, payload)", async () => {
    joinQueue("user_a");
    joinQueue("user_b");

    const calls = [];
    const realtimeEmit = (...args) => { calls.push(args); };

    const result = await runBrawlQueueCycle({ realtimeEmit });

    assert.equal(result.ok, true);
    assert.equal(result.paired, 1);
    assert.equal(calls.length, 2, "expected one realtimeEmit call per paired player");

    for (const [event, payload, opts] of calls) {
      // Event name must be the literal event, never a pre-built room
      // string like "user:user_a:brawl-invited" (the old, broken shape).
      assert.equal(event, "brawl-invited");
      assert.equal(typeof event, "string");
      assert.ok(!event.startsWith("user:"), "event must not be a room string");

      // Payload is a plain object carrying the invite data, not a
      // second event-name string (the old broken call passed the event
      // name as the SECOND argument).
      assert.equal(typeof payload, "object");
      assert.ok(payload.inviteId);
      assert.notEqual(payload, "brawl-invited");

      // Third argument is the options object realtimeEmit destructures
      // `userId` from — this is how the target room is derived
      // internally (`user:${userId}`), NOT baked into the event name.
      assert.equal(typeof opts, "object");
      assert.ok(opts.userId === "user_a" || opts.userId === "user_b");
    }

    const targetedUsers = calls.map(([, , opts]) => opts.userId).sort();
    assert.deepEqual(targetedUsers, ["user_a", "user_b"]);
  });

  it("is a no-op (no realtimeEmit calls) when fewer than 2 players are queued", async () => {
    joinQueue("solo");
    const calls = [];
    const realtimeEmit = (...args) => { calls.push(args); };
    const result = await runBrawlQueueCycle({ realtimeEmit });
    assert.equal(result.ok, true);
    assert.equal(result.paired, 0);
    assert.equal(calls.length, 0);
  });
});
