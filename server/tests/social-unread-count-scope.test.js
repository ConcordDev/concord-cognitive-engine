// Audit fix sweep (PR #2356) — FIX-social-003 (server half): the
// unread count behind the badge skipped the notification-type
// preference filter the list applies, so badge and panel measured
// different sets. The count now filters exactly like getNotifications.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createNotification, getNotifications, getUnreadCount,
} from "../emergent/social-layer.js";

function seededState() {
  const STATE = {};
  createNotification(STATE, { userId: "u1", type: "like", fromUserId: "u2", content: "liked" });
  createNotification(STATE, { userId: "u1", type: "like", fromUserId: "u3", content: "liked" });
  createNotification(STATE, { userId: "u1", type: "follow", fromUserId: "u2", content: "followed" });
  return STATE;
}

describe("social unread count scope", () => {
  it("without preferences, count and list agree", () => {
    const STATE = seededState();
    assert.equal(getUnreadCount(STATE, "u1").unreadCount, 3);
    assert.equal(getNotifications(STATE, "u1", { limit: 50, unreadOnly: true }).total, 3);
  });

  it("muted types are excluded from BOTH the count and the list", () => {
    const STATE = seededState();
    STATE._social.profiles.set("u1", { notificationTypes: { like: false } });
    assert.equal(getUnreadCount(STATE, "u1").unreadCount, 1);
    assert.equal(getNotifications(STATE, "u1", { limit: 50, unreadOnly: true }).total, 1);
  });
});
