/**
 * proximity-chat contract test (V1.2 Wave A — Society & Presence).
 *
 * Pins the range-gating contract for the real-time-only proximity chat
 * channel: recipients are resolved from the SENDER's live, server-tracked
 * position via a real 3D distance calculation (city-presence.js's own
 * getNearbyUsers — no separate/mocked distance math), never a client-
 * supplied position claim.
 *
 * Run: node --test tests/proximity-chat.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  configurePresence,
  updateUserPosition,
  setUserVisibility,
  removeUser,
} from "../lib/city-presence.js";

import {
  resolveProximityRecipients,
  buildProximityChatMessage,
  PROXIMITY_CHAT_RADIUS_M,
  PROXIMITY_CHAT_BODY_MAX_LEN,
  _resetRateLimitState,
} from "../lib/proximity-chat.js";

const USERS = ["u_alice", "u_bob", "u_carl", "u_dana"];

beforeEach(() => {
  configurePresence({ db: null, fireTrigger: null });
  _resetRateLimitState();
  for (const uid of USERS) {
    try { removeUser(uid); } catch { /* not present, fine */ }
  }
});

describe("resolveProximityRecipients — real distance-gated recipient set", () => {
  it("includes a user well within the default radius", () => {
    updateUserPosition("u_alice", { cityId: "c1", x: 0, y: 0, z: 0 });
    updateUserPosition("u_bob", { cityId: "c1", x: 10, y: 0, z: 0 }); // 10m away
    const recipients = resolveProximityRecipients("u_alice");
    assert.ok(recipients.includes("u_bob"), "a user 10m away must be in range at the default ~40m radius");
    removeUser("u_alice");
    removeUser("u_bob");
  });

  it("excludes a user well outside the default radius — a real distance calculation, not a mock", () => {
    updateUserPosition("u_alice", { cityId: "c1", x: 0, y: 0, z: 0 });
    // Place bob exactly on the boundary the default radius should reject:
    // default is PROXIMITY_CHAT_RADIUS_M (~40m); 500m is unambiguously out of range.
    updateUserPosition("u_bob", { cityId: "c1", x: 500, y: 0, z: 0 });
    const recipients = resolveProximityRecipients("u_alice");
    assert.equal(recipients.includes("u_bob"), false, "a user 500m away must NOT be in range at the default radius");
    removeUser("u_alice");
    removeUser("u_bob");
  });

  it("respects an explicit radius override — same real math, wider window", () => {
    updateUserPosition("u_alice", { cityId: "c1", x: 0, y: 0, z: 0 });
    updateUserPosition("u_bob", { cityId: "c1", x: 100, y: 0, z: 0 }); // 100m away
    // Out of range at the default (~40m)...
    assert.equal(resolveProximityRecipients("u_alice", PROXIMITY_CHAT_RADIUS_M).includes("u_bob"), false);
    // ...but in range once the caller widens the radius past 100m.
    assert.equal(resolveProximityRecipients("u_alice", 150).includes("u_bob"), true);
    removeUser("u_alice");
    removeUser("u_bob");
  });

  it("computes distance in full 3D — a vertical gap alone can put a user out of range", () => {
    updateUserPosition("u_alice", { cityId: "c1", x: 0, y: 0, z: 0 });
    updateUserPosition("u_bob", { cityId: "c1", x: 0, y: 500, z: 0 }); // directly above, 500m up
    const recipients = resolveProximityRecipients("u_alice");
    assert.equal(recipients.includes("u_bob"), false, "500m of pure vertical distance must still exceed the radius");
    removeUser("u_alice");
    removeUser("u_bob");
  });

  it("never includes the sender themselves", () => {
    updateUserPosition("u_alice", { cityId: "c1", x: 0, y: 0, z: 0 });
    const recipients = resolveProximityRecipients("u_alice");
    assert.equal(recipients.includes("u_alice"), false);
    removeUser("u_alice");
  });

  it("excludes users in a different city even if coordinates would otherwise be in range", () => {
    updateUserPosition("u_alice", { cityId: "c1", x: 0, y: 0, z: 0 });
    updateUserPosition("u_bob", { cityId: "c2", x: 1, y: 0, z: 1 });
    const recipients = resolveProximityRecipients("u_alice");
    assert.equal(recipients.includes("u_bob"), false);
    removeUser("u_alice");
    removeUser("u_bob");
  });

  it("excludes a hidden (ghost) user even though they are in range", () => {
    updateUserPosition("u_alice", { cityId: "c1", x: 0, y: 0, z: 0 });
    updateUserPosition("u_bob", { cityId: "c1", x: 5, y: 0, z: 5 });
    setUserVisibility("u_bob", "hidden");
    const recipients = resolveProximityRecipients("u_alice");
    assert.equal(recipients.includes("u_bob"), false, "a ghost-mode user must not receive proximity chat");
    removeUser("u_alice");
    removeUser("u_bob");
  });

  it("returns an empty array for a sender with no live presence yet", () => {
    assert.deepEqual(resolveProximityRecipients("u_never_moved"), []);
  });

  it("returns multiple in-range recipients and skips the one out of range", () => {
    updateUserPosition("u_alice", { cityId: "c1", x: 0, y: 0, z: 0 });
    updateUserPosition("u_bob", { cityId: "c1", x: 8, y: 0, z: 0 });     // in range
    updateUserPosition("u_carl", { cityId: "c1", x: 12, y: 0, z: 0 });   // in range
    updateUserPosition("u_dana", { cityId: "c1", x: 900, y: 0, z: 0 });  // out of range
    const recipients = resolveProximityRecipients("u_alice");
    assert.equal(recipients.includes("u_bob"), true);
    assert.equal(recipients.includes("u_carl"), true);
    assert.equal(recipients.includes("u_dana"), false);
    for (const uid of ["u_alice", "u_bob", "u_carl", "u_dana"]) removeUser(uid);
  });
});

describe("buildProximityChatMessage — validation + shape", () => {
  it("builds a valid message carrying the sender's live position", () => {
    updateUserPosition("u_alice", { cityId: "c1", x: 3, y: 0, z: 4 });
    const r = buildProximityChatMessage("u_alice", "hey, anyone nearby?");
    assert.equal(r.ok, true);
    assert.equal(r.message.senderId, "u_alice");
    assert.equal(r.message.body, "hey, anyone nearby?");
    assert.deepEqual(r.message.position, { x: 3, y: 0, z: 4 });
    assert.equal(r.message.cityId, "c1");
    assert.ok(r.message.id);
    assert.ok(r.message.ts);
    removeUser("u_alice");
  });

  it("rejects an empty/whitespace-only body", () => {
    updateUserPosition("u_alice", { cityId: "c1", x: 0, y: 0, z: 0 });
    assert.equal(buildProximityChatMessage("u_alice", "   ").ok, false);
    assert.equal(buildProximityChatMessage("u_alice", "").ok, false);
    removeUser("u_alice");
  });

  it("rejects a body over the max length", () => {
    updateUserPosition("u_alice", { cityId: "c1", x: 0, y: 0, z: 0 });
    const tooLong = "x".repeat(PROXIMITY_CHAT_BODY_MAX_LEN + 1);
    const r = buildProximityChatMessage("u_alice", tooLong);
    assert.equal(r.ok, false);
    assert.equal(r.error, "body_too_long");
    removeUser("u_alice");
  });

  it("rejects a sender with no live presence", () => {
    const r = buildProximityChatMessage("u_never_moved", "hello");
    assert.equal(r.ok, false);
    assert.equal(r.error, "no_live_presence");
  });

  it("rejects a missing senderId", () => {
    assert.equal(buildProximityChatMessage(null, "hi").ok, false);
  });

  it("rate-limits a sender who sends far more than the per-window cap", () => {
    updateUserPosition("u_alice", { cityId: "c1", x: 0, y: 0, z: 0 });
    let lastResult = { ok: true };
    for (let i = 0; i < 30; i++) {
      lastResult = buildProximityChatMessage("u_alice", `msg ${i}`);
      if (!lastResult.ok) break;
    }
    assert.equal(lastResult.ok, false);
    assert.equal(lastResult.error, "rate_limited");
    removeUser("u_alice");
  });

  it("clamps an out-of-bounds radius rather than trusting it verbatim", () => {
    updateUserPosition("u_alice", { cityId: "c1", x: 0, y: 0, z: 0 });
    const huge = buildProximityChatMessage("u_alice", "hi", { radius: 999999 });
    assert.equal(huge.ok, true);
    assert.ok(huge.message.radiusM <= 200, "radius must be clamped to the server-side max");
    removeUser("u_alice");
  });
});

describe("end-to-end: build + resolve mirrors the same range gate", () => {
  it("a message built by the sender resolves to exactly the in-range recipients", () => {
    // u_carl sits at x=900 — comfortably out of the default ~40m proximity
    // radius while staying inside the ±1000m world-bounds envelope (a
    // larger value would get silently clamped back to the origin by
    // math-safety.js's clampToWorldBounds, which would defeat this test).
    updateUserPosition("u_alice", { cityId: "c1", x: 0, y: 0, z: 0 });
    updateUserPosition("u_bob", { cityId: "c1", x: 5, y: 0, z: 0 });   // in range
    updateUserPosition("u_carl", { cityId: "c1", x: 900, y: 0, z: 0 }); // out of range

    const built = buildProximityChatMessage("u_alice", "can anyone hear me?");
    assert.equal(built.ok, true);
    const recipients = resolveProximityRecipients("u_alice", built.message.radiusM);
    assert.equal(recipients.includes("u_bob"), true);
    assert.equal(recipients.includes("u_carl"), false);

    removeUser("u_alice");
    removeUser("u_bob");
    removeUser("u_carl");
  });
});
