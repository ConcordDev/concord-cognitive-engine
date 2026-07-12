// Pins the event-shapes.js contract for the two new realtime events added by
// the collab session-room live roster sync fix (closes "Live participant
// join/leave with real roster sync" — docs/lens-specs/collab-capability-map.md):
//   - collab:participant-joined — emitted by domains/collab.js#sessionJoin
//   - collab:participant-left   — emitted by domains/collab.js#sessionLeave
// Both are broadcast to the `collab:${sessionId}` room (the same room the
// session's screen-share WebRTC signaling already joins via `room:join`).
//
// Mirrors the pattern tests/wave4-event-worldid.test.js established for
// pinning event-shapes.js entries directly via validateEvent(), without
// booting a socket server.
//
// Run: node --test tests/collab-session-roster-event-shape.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateEvent } from "../lib/event-shapes.js";

describe("event-shapes.js — collab:participant-joined", () => {
  it("validates the full payload domains/collab.js#sessionJoin actually emits", () => {
    const r = validateEvent("collab:participant-joined", {
      sessionId: "sess_1",
      userId: "user_b",
      name: "Bob",
      joinedAt: Date.now(),
      participantCount: 2,
      ts: Date.now(), // realtime-emit reserved field — must not count as "unknown"
    });
    assert.equal(r.ok, true);
  });

  it("validates the minimal required-only payload", () => {
    const r = validateEvent("collab:participant-joined", {
      sessionId: "sess_1", userId: "user_b", name: "Bob",
    });
    assert.equal(r.ok, true);
  });

  it("rejects a payload missing a required field (userId)", () => {
    const r = validateEvent("collab:participant-joined", { sessionId: "sess_1", name: "Bob" });
    assert.equal(r.ok, false);
    assert.deepEqual(r.missing, ["userId"]);
  });

  it("rejects an unknown field (typo protection)", () => {
    const r = validateEvent("collab:participant-joined", {
      sessionId: "sess_1", userId: "user_b", name: "Bob", partcipantCount: 2,
    });
    assert.equal(r.ok, false);
    assert.deepEqual(r.unknown, ["partcipantCount"]);
  });
});

describe("event-shapes.js — collab:participant-left", () => {
  it("validates the full payload domains/collab.js#sessionLeave actually emits", () => {
    const r = validateEvent("collab:participant-left", {
      sessionId: "sess_1", userId: "user_b", participantCount: 1, ts: Date.now(),
    });
    assert.equal(r.ok, true);
  });

  it("validates the minimal required-only payload", () => {
    const r = validateEvent("collab:participant-left", { sessionId: "sess_1", userId: "user_b" });
    assert.equal(r.ok, true);
  });

  it("rejects a payload missing a required field (sessionId)", () => {
    const r = validateEvent("collab:participant-left", { userId: "user_b" });
    assert.equal(r.ok, false);
    assert.deepEqual(r.missing, ["sessionId"]);
  });
});
