// Behavioral tests for the artistry notification feed (follow/commentAdd/
// appreciate -> platform notification substrate -> notifications-list /
// notifications-mark-read).
//
// Closes docs/WAVE4_INVENTORY.md / artistry-capability-map.md item 14:
// "Notification feed (new follower, new comment, new appreciation) |
// GENUINELY MISSING". The capability-map entry undersold this as a
// cross-cutting concern out of scope; in fact `createNotification()`
// (server/emergent/social-layer.js) is already imported cross-directory
// from a non-social domain precedent (server/emergent/byo-budget-alert-
// cycle.js), and other domain files already import freely from
// ../emergent/*.js (civic-bonds.js -> microbond-governance.js, repair.js
// -> repair-cortex.js / world-health-monitor.js) — so artistry.js doing
// the same needed no server.js change.
//
// Covers: a notification is created on follow / commentAdd / appreciate
// (toggle-ON only); self-actions never notify (self-follow was already
// rejected upstream, self-comment and self-appreciate are new guards
// added here); un-appreciating never notifies; repeat/idempotent follow
// calls don't re-notify; the artistry notifications-list macro is scoped
// to the three types this unit produces (follow/comment/like), excluding
// unrelated notification types that share the same underlying store;
// notifications-mark-read (single + all) works; and — the load-bearing
// assertion — every notification actually lands in the REAL
// `STATE._social.notifications` Map that `server/emergent/social-layer.js`
// owns, not a fabricated in-memory stub local to this domain.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerArtistryActions from "../../domains/artistry.js";
import { createNotification } from "../../emergent/social-layer.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`artistry.${name}`);
  assert.ok(fn, `artistry.${name} not registered`);
  return fn(ctx, { id: null, data: params, meta: {} }, params);
}

before(() => { registerArtistryActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "artist_a" }, userId: "artist_a" };
const ctxB = { actor: { userId: "artist_b" }, userId: "artist_b" };

// Direct read against the real substrate social-layer.js owns — the
// honesty check that this isn't a fabricated local stub.
function rawNotifs(userId) {
  const social = globalThis._concordSTATE._social;
  if (!social) return [];
  return social.notifications.get(userId) || [];
}

describe("artistry.follow -> notification", () => {
  it("a new follow notifies the target with type 'follow', landing in the real STATE._social.notifications store", () => {
    const r = call("follow", ctxA, { targetUserId: "artist_b" });
    assert.equal(r.ok, true);

    const notifs = rawNotifs("artist_b");
    assert.equal(notifs.length, 1);
    assert.equal(notifs[0].type, "follow");
    assert.equal(notifs[0].fromUserId, "artist_a");
    assert.match(notifs[0].content, /artist_a/);
    assert.equal(notifs[0].read, false);
  });

  it("a repeat follow (already following) is idempotent and does not re-notify", () => {
    call("follow", ctxA, { targetUserId: "artist_b" });
    const r2 = call("follow", ctxA, { targetUserId: "artist_b" });
    assert.equal(r2.ok, true);
    assert.equal(rawNotifs("artist_b").length, 1, "second idempotent follow call must not add a second notification");
  });

  it("self-follow is rejected upstream and never notifies (no notification bucket even created for the actor)", () => {
    const r = call("follow", ctxA, { targetUserId: "artist_a" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "cannot_follow_self");
    assert.equal(rawNotifs("artist_a").length, 0);
  });
});

describe("artistry.commentAdd -> notification", () => {
  it("commenting on someone else's project notifies the owner with type 'comment'", () => {
    const proj = call("projectCreate", ctxA, { title: "Dune Concepts" });
    const projectId = proj.result.project.id;

    const c = call("commentAdd", ctxB, { projectId, body: "love this piece" });
    assert.equal(c.ok, true);

    const notifs = rawNotifs("artist_a");
    assert.equal(notifs.length, 1);
    assert.equal(notifs[0].type, "comment");
    assert.equal(notifs[0].fromUserId, "artist_b");
    assert.equal(notifs[0].postId, projectId);
    assert.match(notifs[0].content, /Dune Concepts/);
  });

  it("commenting on your own project never self-notifies", () => {
    const proj = call("projectCreate", ctxA, { title: "Solo Piece" });
    const projectId = proj.result.project.id;
    call("commentAdd", ctxA, { projectId, body: "note to self" });
    assert.equal(rawNotifs("artist_a").length, 0);
  });

  it("commenting on an unknown/nonexistent projectId is a silent no-op for notifications (never throws)", () => {
    const r = call("commentAdd", ctxB, { projectId: "does-not-exist", body: "hi" });
    assert.equal(r.ok, true); // pre-existing behavior: comments aren't validated against project existence
    // No owner could be resolved, so nobody gets notified — and nothing throws.
    assert.equal(rawNotifs("artist_a").length, 0);
  });
});

describe("artistry.appreciate -> notification", () => {
  it("liking (toggle ON) someone else's project notifies the owner with type 'like'", () => {
    const proj = call("projectCreate", ctxA, { title: "Nebula Study" });
    const projectId = proj.result.project.id;

    const r = call("appreciate", ctxB, { projectId });
    assert.equal(r.ok, true);
    assert.equal(r.result.appreciated, true);

    const notifs = rawNotifs("artist_a");
    assert.equal(notifs.length, 1);
    assert.equal(notifs[0].type, "like");
    assert.equal(notifs[0].fromUserId, "artist_b");
    assert.equal(notifs[0].postId, projectId);
  });

  it("un-appreciating (toggle OFF) never notifies", () => {
    const proj = call("projectCreate", ctxA, { title: "Nebula Study" });
    const projectId = proj.result.project.id;

    call("appreciate", ctxB, { projectId }); // ON -> 1 notification
    const r2 = call("appreciate", ctxB, { projectId }); // OFF
    assert.equal(r2.ok, true);
    assert.equal(r2.result.appreciated, false);

    assert.equal(rawNotifs("artist_a").length, 1, "un-appreciating must not add a second notification");
  });

  it("appreciating your own project never self-notifies", () => {
    const proj = call("projectCreate", ctxA, { title: "Self Love" });
    const projectId = proj.result.project.id;
    call("appreciate", ctxA, { projectId });
    assert.equal(rawNotifs("artist_a").length, 0);
  });

  it("re-liking after an unlike (ON -> OFF -> ON) notifies again on the second ON transition", () => {
    const proj = call("projectCreate", ctxA, { title: "Cycle" });
    const projectId = proj.result.project.id;
    call("appreciate", ctxB, { projectId }); // ON
    call("appreciate", ctxB, { projectId }); // OFF
    call("appreciate", ctxB, { projectId }); // ON again
    assert.equal(rawNotifs("artist_a").length, 2);
  });
});

describe("artistry.notifications-list", () => {
  it("returns follow/comment/like notifications for the caller, newest first, with an unread count", () => {
    const proj = call("projectCreate", ctxA, { title: "Feed Target" });
    const projectId = proj.result.project.id;
    call("follow", ctxB, { targetUserId: "artist_a" });
    call("commentAdd", ctxB, { projectId, body: "nice" });
    call("appreciate", ctxB, { projectId });

    const list = call("notifications-list", ctxA, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 3);
    assert.equal(list.result.unread, 3);
    // newest-first: appreciate fired last, so it's at index 0.
    assert.equal(list.result.notifications[0].type, "like");
    const types = list.result.notifications.map((n) => n.type).sort();
    assert.deepEqual(types, ["comment", "follow", "like"]);
  });

  it("scopes strictly to artistry's own types — an unrelated notification type in the same shared store is excluded", () => {
    call("follow", ctxB, { targetUserId: "artist_a" });
    // Inject an unrelated notification type directly via the real substrate,
    // simulating what another lens (e.g. a DM or budget alert) would produce
    // into the SAME shared store.
    createNotification(globalThis._concordSTATE, {
      userId: "artist_a", type: "dm", fromUserId: "artist_b", content: "unrelated DM",
    });

    assert.equal(rawNotifs("artist_a").length, 2, "sanity: both notifications really exist in the shared store");
    const list = call("notifications-list", ctxA, {});
    assert.equal(list.result.count, 1, "notifications-list must exclude the non-artistry type");
    assert.equal(list.result.notifications[0].type, "follow");
  });

  it("respects unreadOnly and limit params", () => {
    const proj = call("projectCreate", ctxA, { title: "T" });
    const projectId = proj.result.project.id;
    call("follow", ctxB, { targetUserId: "artist_a" });
    call("commentAdd", ctxB, { projectId, body: "a" });

    const limited = call("notifications-list", ctxA, { limit: 1 });
    assert.equal(limited.result.notifications.length, 1);

    call("notifications-mark-read", ctxA, { id: rawNotifs("artist_a")[0].id });
    const unreadOnly = call("notifications-list", ctxA, { unreadOnly: true });
    assert.equal(unreadOnly.result.count, 1);
  });

  it("returns an empty feed (not an error) for a user with no notifications", () => {
    const r = call("notifications-list", ctxA, {});
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.notifications, []);
    assert.equal(r.result.count, 0);
    assert.equal(r.result.unread, 0);
  });
});

describe("artistry.notifications-mark-read", () => {
  it("marks a single notification read by id", () => {
    call("follow", ctxA, { targetUserId: "artist_b" });
    const id = rawNotifs("artist_b")[0].id;

    const r = call("notifications-mark-read", ctxB, { id });
    assert.equal(r.ok, true);
    assert.equal(r.result.id, id);
    assert.equal(rawNotifs("artist_b")[0].read, true);
  });

  it("rejects an unknown notification id", () => {
    const r = call("notifications-mark-read", ctxB, { id: "nope" });
    assert.equal(r.ok, false);
  });

  it("marks all of the caller's notifications read with { all: true }", () => {
    const proj = call("projectCreate", ctxA, { title: "T" });
    const projectId = proj.result.project.id;
    call("follow", ctxB, { targetUserId: "artist_a" });
    call("commentAdd", ctxB, { projectId, body: "a" });
    assert.equal(call("notifications-list", ctxA, {}).result.unread, 2);

    const r = call("notifications-mark-read", ctxA, { all: true });
    assert.equal(r.ok, true);
    assert.equal(r.result.markedRead, 2);
    assert.equal(call("notifications-list", ctxA, {}).result.unread, 0);
  });
});

describe("artistry notifications — degrade graceful when STATE is absent", () => {
  it("notifications-list/mark-read return {ok:false, state_unavailable}, never throw", () => {
    globalThis._concordSTATE = undefined;
    const list = call("notifications-list", ctxA, {});
    assert.equal(list.ok, false);
    assert.equal(list.error, "state_unavailable");
    const mark = call("notifications-mark-read", ctxA, { all: true });
    assert.equal(mark.ok, false);
    assert.equal(mark.error, "state_unavailable");
  });

  it("follow/commentAdd/appreciate never throw even though the notification substrate has no STATE bucket yet (fresh {} state)", () => {
    // getArtState() lazily builds globalThis._concordSTATE.artistryLens, and
    // notifyArtistry() lazily builds STATE._social via createNotification's
    // getSocialState() — both must cope with a bare {} STATE with neither
    // bucket pre-existing.
    globalThis._concordSTATE = {};
    const r = call("follow", ctxA, { targetUserId: "artist_b" });
    assert.equal(r.ok, true);
    assert.equal(rawNotifs("artist_b").length, 1);
  });
});
