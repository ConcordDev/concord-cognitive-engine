// F5 — brawl disconnect cleanup. A crashed/closed socket used to linger in the
// matchmaking queue and hold phantom invites until the TTL expired. The master
// disconnect handler now calls brawl.cleanupForUser(userId), which drops them
// from the queue and cancels invites they're a party to.
//
// Run: node --test tests/brawl-disconnect-cleanup.test.js

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  inviteBrawl, joinQueue, queueStatus, listOpenInvitesFor, cleanupForUser, _reset,
} from "../lib/brawl.js";

describe("F5 — brawl disconnect cleanup", () => {
  beforeEach(() => _reset());

  it("drops the user from the queue and cancels their pending invites", () => {
    joinQueue("a");
    inviteBrawl("a", "b"); // a is a party to this invite
    assert.equal(queueStatus("a").inQueue, true);
    assert.ok(listOpenInvitesFor("b").length >= 1, "invite exists before cleanup");

    const r = cleanupForUser("a");
    assert.equal(r.ok, true);
    assert.equal(queueStatus("a").inQueue, false, "removed from matchmaking queue");
    assert.ok(r.invitesCleared >= 1, "invites involving the user were cleared");
    assert.equal(listOpenInvitesFor("b").length, 0, "the a→b invite is gone");
  });

  it("is idempotent and safe for a user with no brawl state", () => {
    assert.equal(cleanupForUser("nobody").ok, true);
    assert.equal(cleanupForUser("nobody").invitesCleared, 0);
    assert.equal(cleanupForUser().ok, false); // missing user id
  });
});
