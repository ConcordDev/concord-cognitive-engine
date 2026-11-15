// FIX-social-015 — following someone now tells them.
//
// followUser updated the indexes and metrics but never created the
// notification every sibling action (like, comment, mention, share,
// pack join) creates — so "followed you" never appeared; testers saw
// only message notifications. Pinned: a NEW follow creates exactly one
// 'follow' notification for the followed user (verb-phrase content the
// notification UI renders after the actor's name); a repeat follow
// creates none; an unfollow + re-follow is a new follow and notifies
// again; the follower's own notifications stay empty.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  upsertProfile,
  followUser,
  unfollowUser,
  getNotifications,
  getUnreadCount,
} from "../emergent/social-layer.js";

function makeSTATE() {
  return { dtus: new Map() };
}

describe("follow notifications (FIX-social-015)", () => {
  let STATE;
  beforeEach(() => {
    STATE = makeSTATE();
    upsertProfile(STATE, "u1", { displayName: "Ann" });
    upsertProfile(STATE, "u2", { displayName: "Bo" });
  });

  it("a new follow notifies the followed user, once", () => {
    const r = followUser(STATE, "u1", "u2");
    assert.equal(r.ok, true);
    assert.equal(r.isNew, true);

    const inbox = getNotifications(STATE, "u2");
    assert.equal(inbox.total, 1);
    const n = inbox.notifications[0];
    assert.equal(n.type, "follow");
    assert.equal(n.fromUserId, "u1");
    assert.equal(n.userId, "u2");
    assert.equal(n.content, "started following you");
    assert.equal(n.read, false);
    assert.equal(getUnreadCount(STATE, "u2").unreadCount, 1);

    // The follower is not notified about their own action.
    assert.equal(getNotifications(STATE, "u1").total, 0);
  });

  it("a repeat follow notifies nothing new", () => {
    followUser(STATE, "u1", "u2");
    const again = followUser(STATE, "u1", "u2");
    assert.equal(again.ok, true);
    assert.equal(again.isNew, false);
    assert.equal(getNotifications(STATE, "u2").total, 1);
  });

  it("unfollow then re-follow is a new follow and notifies again", () => {
    followUser(STATE, "u1", "u2");
    unfollowUser(STATE, "u1", "u2");
    followUser(STATE, "u1", "u2");
    assert.equal(getNotifications(STATE, "u2").total, 2);
  });
});
