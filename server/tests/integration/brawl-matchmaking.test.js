// Phase E7 — brawl matchmaking queue integration test.
//
// Verifies the in-memory queue + popPair pairing flow + heartbeat
// integration. Two users join the queue; popPair returns a paired
// {a, b, inviteId}; both queue spots clear; an invite exists between
// them.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  joinQueue,
  leaveQueue,
  queueStatus,
  popPair,
  acceptBrawl,
  isInBrawl,
  getBrawlOpponent,
  _reset,
} from "../../lib/brawl.js";

describe("Phase E7 — brawl matchmaking queue", () => {
  beforeEach(() => _reset());

  it("joinQueue → popPair → invite → acceptBrawl → both in active brawl", () => {
    const a = joinQueue("user_a");
    const b = joinQueue("user_b");
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    assert.equal(queueStatus().size, 2);

    const pair = popPair();
    assert.equal(pair.ok, true);
    assert.ok(pair.paired);
    assert.equal(pair.paired.a, "user_a");
    assert.equal(pair.paired.b, "user_b");
    assert.ok(pair.paired.inviteId);

    // Both removed from queue.
    assert.equal(queueStatus().size, 0);

    // B accepts the synthesised invite from A.
    const acc = acceptBrawl(pair.paired.inviteId, "user_b");
    assert.equal(acc.ok, true);
    assert.equal(isInBrawl("user_a"), true);
    assert.equal(isInBrawl("user_b"), true);
    assert.equal(getBrawlOpponent("user_a"), "user_b");
    assert.equal(getBrawlOpponent("user_b"), "user_a");
  });

  it("popPair returns null when queue has < 2", () => {
    joinQueue("solo");
    const r = popPair();
    assert.equal(r.ok, true);
    assert.equal(r.paired, null);
    assert.equal(queueStatus().size, 1);
  });

  it("joinQueue is idempotent on same user", () => {
    const r1 = joinQueue("dupe");
    const r2 = joinQueue("dupe");
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
    assert.equal(r2.alreadyQueued, true);
    assert.equal(queueStatus().size, 1);
  });

  it("leaveQueue removes from pool", () => {
    joinQueue("leaver");
    const r = leaveQueue("leaver");
    assert.equal(r.ok, true);
    assert.equal(r.removed, true);
    assert.equal(queueStatus().size, 0);
  });

  it("queue refuses join if already in active brawl", () => {
    // Set up: pair + accept so both are in active brawl state.
    joinQueue("p1");
    joinQueue("p2");
    const pair = popPair();
    acceptBrawl(pair.paired.inviteId, "p2");
    assert.equal(isInBrawl("p1"), true);
    // Now p1 can't re-queue.
    const r = joinQueue("p1");
    assert.equal(r.ok, false);
    assert.equal(r.error, "already_in_brawl");
  });

  it("popPair pairs the two oldest queuers (FIFO)", async () => {
    joinQueue("first");
    // Tiny delay to ensure joinedAt differs.
    await new Promise((r) => setTimeout(r, 5));
    joinQueue("second");
    await new Promise((r) => setTimeout(r, 5));
    joinQueue("third");
    const pair = popPair();
    assert.equal(pair.paired.a, "first");
    assert.equal(pair.paired.b, "second");
    // third is still alone in the queue.
    assert.equal(queueStatus().size, 1);
    assert.equal(queueStatus("third").inQueue, true);
  });

  it("queueStatus(userId) reports per-user state", () => {
    joinQueue("watcher");
    const s = queueStatus("watcher");
    assert.equal(s.ok, true);
    assert.equal(s.inQueue, true);
    assert.ok(typeof s.joinedAt === "number");
    assert.equal(queueStatus("ghost").inQueue, false);
  });
});
