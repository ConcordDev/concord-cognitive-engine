// FIX-collab-001 C3 — in-room discussion + presence. Comments and
// presence existed only on documents; rooms ride the same machinery
// (same comment shape, mention extractor, notification pusher, 45s
// presence prune) under a room key, gated by C2 membership: only the
// owner and accepted members can comment, read or appear — and
// @-mentions notify room members only, never outsiders.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerCollabActions from "../domains/collab.js";
import { up as roomsUp } from "../migrations/463_collab_rooms.js";
import { up as membersUp } from "../migrations/508_collab_room_members.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`collab.${name}`);
  assert.ok(fn, `collab.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

let db;
before(() => { registerCollabActions(register); });
beforeEach(() => {
  db = new Database(":memory:");
  roomsUp(db);
  membersUp(db);
  globalThis._concordSTATE = { db, collabLens: {} };
  globalThis._concordSaveStateDebounced = () => {};
});

const owner = () => ({ actor: { userId: "user_owner", name: "Owner" }, userId: "user_owner", db });
const member = () => ({ actor: { userId: "user_member", name: "Member" }, userId: "user_member", db });
const viewer = () => ({ actor: { userId: "user_viewer", name: "Viewer" }, userId: "user_viewer", db });
const stranger = () => ({ actor: { userId: "user_stranger", name: "Stranger" }, userId: "user_stranger", db });

function openRoomWithMember(tier = "comment") {
  const created = call("room-open", owner(), { title: "Jam room", note: "shared note" });
  const id = created.result.roomId;
  const inv = call("room-invite", owner(), { id, inviteeId: "user_member", tier });
  call("room-invite-respond", member(), { inviteId: inv.result.invite.id, accept: true });
  return id;
}
function notificationsFor(userId) {
  const s = globalThis._concordSTATE.collabLens;
  return s.notifications?.get(userId) || [];
}

describe("collab room discussion + presence (FIX-collab-001 C3)", () => {
  it("owner and comment-tier member discuss; the thread reads back in order", () => {
    const id = openRoomWithMember();
    const c1 = call("room-comment-add", owner(), { id, text: "first" });
    assert.equal(c1.ok, true, JSON.stringify(c1));
    const c2 = call("room-comment-add", member(), { id, text: "second", parentId: c1.result.comment.id });
    assert.equal(c2.ok, true, JSON.stringify(c2));
    assert.equal(c2.result.comment.threadId, c1.result.comment.id);
    const list = call("room-comment-list", member(), { id });
    assert.equal(list.result.total, 2);
    assert.deepEqual(list.result.comments.map((c) => c.text), ["first", "second"]);
  });

  it("a view-tier member can read but cannot comment — named refusal", () => {
    const id = openRoomWithMember("view");
    // user_member holds the view tier in this room.
    assert.equal(call("room-comment-list", member(), { id }).ok, true);
    assert.equal(
      call("room-comment-add", member(), { id, text: "should not land" }).error,
      "your tier cannot comment in this room",
    );
    assert.equal(call("room-comment-list", owner(), { id }).result.total, 0);
  });

  it("non-members are refused everywhere: comment, read, presence", () => {
    const id = openRoomWithMember();
    assert.equal(call("room-comment-add", stranger(), { id, text: "intruder" }).error, "room_not_found");
    assert.equal(call("room-comment-list", stranger(), { id }).error, "room_not_found");
    assert.equal(call("room-presence-update", stranger(), { id }).error, "room_not_found");
    assert.equal(call("room-presence-state", stranger(), { id }).error, "room_not_found");
    assert.equal(call("room-comment-list", owner(), { id }).result.total, 0);
  });

  it("presence lists only members: a refused heartbeat never lands in the roster", () => {
    const id = openRoomWithMember();
    call("room-presence-update", stranger(), { id });
    call("room-presence-update", owner(), { id });
    call("room-presence-update", member(), { id });
    const state = call("room-presence-state", member(), { id });
    assert.equal(state.ok, true);
    assert.equal(state.result.online, 2);
    assert.deepEqual(
      state.result.presence.map((p) => p.userId).sort(),
      ["user_member", "user_owner"],
    );
    const mine = state.result.presence.find((p) => p.userId === "user_member");
    assert.equal(mine.tier, "comment");
    assert.equal(mine.isOwner, false);
  });

  it("@-mentions notify room members only — an outsider mention notifies nobody", () => {
    const id = openRoomWithMember();
    const posted = call("room-comment-add", owner(), { id, text: "hey @user_member and @user_stranger" });
    assert.equal(posted.ok, true);
    assert.equal(notificationsFor("user_member").length, 1);
    assert.equal(notificationsFor("user_member")[0].kind, "mention");
    assert.equal(notificationsFor("user_stranger").length, 0);
  });

  it("a reply notifies the parent author; a bad parent is refused", () => {
    const id = openRoomWithMember();
    const c1 = call("room-comment-add", member(), { id, text: "question" });
    const reply = call("room-comment-add", owner(), { id, text: "answer", parentId: c1.result.comment.id });
    assert.equal(reply.ok, true);
    assert.equal(notificationsFor("user_member").filter((n) => n.kind === "reply").length, 1);
    assert.equal(
      call("room-comment-add", owner(), { id, text: "orphan", parentId: "cmt_missing" }).error,
      "parent comment not found",
    );
    assert.equal(call("room-comment-add", owner(), { id, text: "  " }).error, "comment text is required");
  });

  it("a second room's discussion is separate, and a removed member loses the thread", () => {
    const id = openRoomWithMember();
    const other = call("room-open", owner(), { title: "Other", note: "n" }).result.roomId;
    call("room-comment-add", owner(), { id, text: "in jam room" });
    assert.equal(call("room-comment-list", owner(), { id: other }).result.total, 0);
    call("room-member-remove", owner(), { id, userId: "user_member" });
    assert.equal(call("room-comment-list", member(), { id }).error, "room_not_found");
    assert.equal(call("room-presence-state", member(), { id }).error, "room_not_found");
  });
});
