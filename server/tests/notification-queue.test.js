// FIX-social-020 — operator proposals are not user notifications.
//
// STATE.queues.notifications is shared: the autogen pipeline enqueues
// its dtu_proposal candidates there (no title, no target user, a DTU
// payload), and the user-facing /api/notifications routes listed and
// counted the whole array — so the bell panel filled with blank
// 'system' items (a proposal has no message for the panel to render)
// and the badge counted every accumulated proposal as unread (99+).
// isUserNotification is the discriminator those routes now apply,
// combined with the routes' own targetUserId scoping.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isUserNotification } from "../lib/notification-queue.js";

// The routes' exact selection: discriminator + caller scoping.
const forUser = (all, userId) =>
  all.filter((n) => isUserNotification(n) && (!userId || !n.targetUserId || n.targetUserId === userId));

const proposal = (id) => ({
  id, type: "dtu_proposal", status: "queued", why: "pipeline:auto",
  payload: { title: "A candidate DTU", content: "…" }, createdAt: "2026-11-02T00:00:00.000Z",
});
const actionNotif = (id, extra = {}) => ({
  id, type: "action_notification", title: "Reminder fired", payload: { message: "Standup in 10" },
  createdAt: "2026-11-12T00:00:00.000Z", ...extra,
});

describe("isUserNotification (FIX-social-020)", () => {
  it("excludes autogen proposals, keeps genuine notifications", () => {
    assert.equal(isUserNotification(proposal("q1")), false);
    assert.equal(isUserNotification(actionNotif("n1")), true);
    assert.equal(isUserNotification({ id: "n2", type: "reminder", title: "x" }), true);
    assert.equal(isUserNotification(null), false);
    assert.equal(isUserNotification(undefined), false);
    assert.equal(isUserNotification("dtu_proposal"), false);
  });

  it("a queue of 60 proposals + 2 real notifications lists and counts only the 2", () => {
    const all = [
      ...Array.from({ length: 60 }, (_, i) => proposal(`q${i}`)),
      actionNotif("n1"),
      actionNotif("n2", { targetUserId: "u2" }),
      actionNotif("n3", { targetUserId: "u1", readAt: "2026-11-12T01:00:00.000Z" }),
    ];
    const mine = forUser(all, "u1");
    assert.deepEqual(mine.map((n) => n.id), ["n1", "n3"]);
    assert.equal(mine.filter((n) => !n.readAt).length, 1);
    // The proposals themselves are untouched in the shared queue —
    // their operator readers (state snapshot) still see all 60.
    assert.equal(all.filter((n) => n.type === "dtu_proposal").length, 60);
  });
});
