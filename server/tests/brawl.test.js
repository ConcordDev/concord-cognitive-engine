// Phase CA7 — Brawl mode tests.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  inviteBrawl, acceptBrawl, declineBrawl,
  isInBrawl, getBrawlOpponent, endBrawl, listOpenInvitesFor,
  _reset,
} from "../lib/brawl.js";

describe("Phase CA7 — brawl invites", () => {
  beforeEach(() => { _reset(); });

  it("invite + accept sets both users in brawl", () => {
    const i = inviteBrawl("a", "b");
    assert.equal(i.ok, true);
    const acc = acceptBrawl(i.inviteId, "b");
    assert.equal(acc.ok, true);
    assert.equal(acc.profile, "sifu_brawler");
    assert.equal(isInBrawl("a"), true);
    assert.equal(isInBrawl("b"), true);
    assert.equal(getBrawlOpponent("a"), "b");
  });

  it("self-invite rejected", () => {
    const r = inviteBrawl("a", "a");
    assert.equal(r.ok, false);
    assert.equal(r.error, "self_invite");
  });

  it("decline removes the invite, no brawl", () => {
    const i = inviteBrawl("a", "b");
    declineBrawl(i.inviteId, "b");
    assert.equal(isInBrawl("a"), false);
  });

  it("only the invitee can accept", () => {
    const i = inviteBrawl("a", "b");
    const r = acceptBrawl(i.inviteId, "c");
    assert.equal(r.ok, false);
    assert.equal(r.error, "not_invited");
  });

  it("re-invite returns the existing open one", () => {
    const a = inviteBrawl("a", "b");
    const b = inviteBrawl("a", "b");
    assert.equal(a.inviteId, b.inviteId);
    assert.equal(b.alreadyOpen, true);
  });

  it("endBrawl clears both sides", () => {
    const i = inviteBrawl("a", "b");
    acceptBrawl(i.inviteId, "b");
    endBrawl("a");
    assert.equal(isInBrawl("a"), false);
    assert.equal(isInBrawl("b"), false);
  });

  it("listOpenInvitesFor returns invites where user is the target", () => {
    inviteBrawl("a", "b");
    inviteBrawl("c", "b");
    inviteBrawl("a", "d");
    const forB = listOpenInvitesFor("b");
    assert.equal(forB.length, 2);
  });
});
