// FIX-collab-001 C2 — room membership. A room was single-user by schema
// (collab_rooms carries only its owner's user_id; every room verb scoped
// to that owner). These pins cover the membership build: the invite
// state machine (pending → accepted / declined, declined grants
// nothing), member-aware list/detail, tier semantics on update, the
// owner's exclusive close/invite, and the refusal paths — against the
// dual store (STATE roomMembers + collab_room_members SQL read-back),
// proven across a simulated restart.

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
const stranger = () => ({ actor: { userId: "user_stranger", name: "Stranger" }, userId: "user_stranger", db });

function openRoom(ctx) {
  const created = call("room-open", ctx, { title: "Jam room", note: "shared note" });
  assert.equal(created.ok, true);
  return created.result.roomId;
}
function inviteAndAccept(roomId, tier = "comment") {
  const inv = call("room-invite", owner(), { id: roomId, inviteeId: "user_member", tier });
  assert.equal(inv.ok, true, JSON.stringify(inv));
  const res = call("room-invite-respond", member(), { inviteId: inv.result.invite.id, accept: true });
  assert.equal(res.ok, true, JSON.stringify(res));
  return res;
}

describe("collab room membership (FIX-collab-001 C2)", () => {
  it("invite → accept makes the room readable and listed for the member", () => {
    const id = openRoom(owner());
    inviteAndAccept(id);
    const detail = call("room-detail", member(), { id });
    assert.equal(detail.ok, true);
    assert.equal(detail.result.room.note, "shared note");
    assert.equal(detail.result.shared, true);
    assert.equal(detail.result.myTier, "comment");
    const list = call("room-list", member(), {});
    const shared = list.result.rooms.find((r) => r.id === id);
    assert.ok(shared, "shared room listed for member");
    assert.equal(shared.shared, true);
    assert.equal(shared.title, "Jam room");
  });

  it("a pending invitee sees nothing — not the detail, not the list", () => {
    const id = openRoom(owner());
    const inv = call("room-invite", owner(), { id, inviteeId: "user_member", tier: "edit" });
    assert.equal(inv.ok, true);
    assert.equal(call("room-detail", member(), { id }).error, "room_not_found");
    const list = call("room-list", member(), {});
    assert.equal(list.result.rooms.some((r) => r.id === id), false);
  });

  it("a declined invite grants nothing, and a re-invite can still land", () => {
    const id = openRoom(owner());
    const inv = call("room-invite", owner(), { id, inviteeId: "user_member" });
    const dec = call("room-invite-respond", member(), { inviteId: inv.result.invite.id, accept: false });
    assert.equal(dec.ok, true);
    assert.equal(dec.result.invite.status, "declined");
    assert.equal(call("room-detail", member(), { id }).error, "room_not_found");
    // Declining once is not a lifetime ban: a fresh invite re-opens.
    const inv2 = call("room-invite", owner(), { id, inviteeId: "user_member" });
    assert.equal(inv2.ok, true);
    assert.equal(inv2.result.invite.status, "pending");
    assert.notEqual(inv2.result.invite.id, inv.result.invite.id);
  });

  it("invite refusals: self-invite, duplicate pending, already-member, bad tier", () => {
    const id = openRoom(owner());
    assert.equal(call("room-invite", owner(), { id, inviteeId: "user_owner" }).error, "cannot invite yourself");
    assert.equal(call("room-invite", owner(), { id, inviteeId: "user_member", tier: "owner" }).error, "tier must be view, comment, or edit");
    const inv = call("room-invite", owner(), { id, inviteeId: "user_member" });
    const dup = call("room-invite", owner(), { id, inviteeId: "user_member" });
    assert.equal(dup.ok, true);
    assert.equal(dup.result.duplicate, true);
    assert.equal(dup.result.invite.id, inv.result.invite.id);
    call("room-invite-respond", member(), { inviteId: inv.result.invite.id, accept: true });
    assert.equal(call("room-invite", owner(), { id, inviteeId: "user_member" }).error, "already a member");
  });

  it("respond refusals: not your invitation, double response, non-boolean", () => {
    const id = openRoom(owner());
    const inv = call("room-invite", owner(), { id, inviteeId: "user_member" });
    assert.equal(
      call("room-invite-respond", stranger(), { inviteId: inv.result.invite.id, accept: true }).error,
      "invitation not found",
    );
    assert.equal(
      call("room-invite-respond", member(), { inviteId: inv.result.invite.id, accept: "yes" }).error,
      "accept must be a boolean",
    );
    call("room-invite-respond", member(), { inviteId: inv.result.invite.id, accept: true });
    assert.equal(
      call("room-invite-respond", member(), { inviteId: inv.result.invite.id, accept: true }).error,
      "invitation already accepted",
    );
  });

  it("a stranger gets room_not_found everywhere; a member's invite attempt is named", () => {
    const id = openRoom(owner());
    inviteAndAccept(id);
    assert.equal(call("room-invite", stranger(), { id, inviteeId: "user_x" }).error, "room_not_found");
    assert.equal(call("room-invite", member(), { id, inviteeId: "user_x" }).error, "only the owner can invite members");
    assert.equal(call("room-members", stranger(), { id }).error, "room_not_found");
    assert.equal(call("room-detail", stranger(), { id }).error, "room_not_found");
  });

  it("tier semantics: view/comment members cannot edit; edit member edits the note, never the title", () => {
    const id = openRoom(owner());
    inviteAndAccept(id, "comment");
    assert.equal(
      call("room-update", member(), { id, note: "member edit" }).error,
      "your tier cannot edit this room",
    );
    // Promote: owner removes and re-invites at edit tier.
    call("room-member-remove", owner(), { id, userId: "user_member" });
    inviteAndAccept(id, "edit");
    const upd = call("room-update", member(), { id, note: "member note v2" });
    assert.equal(upd.ok, true, JSON.stringify(upd));
    assert.equal(call("room-detail", owner(), { id }).result.room.note, "member note v2");
    assert.equal(
      call("room-update", member(), { id, title: "renamed" }).error,
      "only the owner can rename the room",
    );
    // The SQL row still belongs to the owner after a member edit.
    const row = db.prepare("SELECT user_id FROM collab_rooms WHERE id = ?").get(id);
    assert.equal(row.user_id, "user_owner");
  });

  it("close stays owner-only, is named for members, and membership dies with the room", () => {
    const id = openRoom(owner());
    inviteAndAccept(id);
    assert.equal(call("room-close", member(), { id }).error, "only the owner can close the room");
    assert.equal(call("room-close", owner(), { id }).ok, true);
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM collab_room_members WHERE room_id = ?").get(id).n,
      0,
    );
    assert.equal(call("room-detail", member(), { id }).error, "room_not_found");
  });

  it("room-members: owner sees pending + accepted; a member sees accepted only; owner cannot be removed", () => {
    const id = openRoom(owner());
    inviteAndAccept(id);
    call("room-invite", owner(), { id, inviteeId: "user_stranger" }); // stays pending
    const ownerView = call("room-members", owner(), { id });
    assert.equal(ownerView.ok, true);
    assert.equal(ownerView.result.memberCount, 1);
    assert.equal(ownerView.result.members.length, 2); // accepted + pending
    const memberView = call("room-members", member(), { id });
    assert.equal(memberView.result.members.length, 1);
    assert.equal(memberView.result.members[0].status, "accepted");
    assert.equal(
      call("room-member-remove", owner(), { id, userId: "user_owner" }).error,
      "the owner cannot be removed",
    );
    assert.equal(
      call("room-member-remove", member(), { id, userId: "user_stranger" }).error,
      "only the owner can remove members",
    );
  });

  it("a member can leave; the owner can remove; a removed member loses the room", () => {
    const id = openRoom(owner());
    inviteAndAccept(id);
    const leave = call("room-member-remove", member(), { id, userId: "user_member" });
    assert.equal(leave.ok, true);
    assert.equal(call("room-detail", member(), { id }).error, "room_not_found");
    inviteAndAccept(id);
    const removed = call("room-member-remove", owner(), { id, userId: "user_member" });
    assert.equal(removed.ok, true);
    assert.equal(call("room-detail", member(), { id }).error, "room_not_found");
    assert.equal(call("room-member-remove", owner(), { id, userId: "user_member" }).error, "not a member");
  });

  it("membership survives a restart through the SQL read-back", () => {
    const id = openRoom(owner());
    inviteAndAccept(id, "edit");
    // Restart: STATE cleared — rooms and members re-read from SQL.
    globalThis._concordSTATE = { db, collabLens: {} };
    const detail = call("room-detail", member(), { id });
    assert.equal(detail.ok, true);
    assert.equal(detail.result.myTier, "edit");
    const roster = call("room-members", member(), { id });
    assert.equal(roster.result.memberCount, 1);
  });

  it("room-invite-list: received and sent scopes carry the room title", () => {
    const id = openRoom(owner());
    call("room-invite", owner(), { id, inviteeId: "user_member" });
    const received = call("room-invite-list", member(), {});
    assert.equal(received.result.total, 1);
    assert.equal(received.result.invitations[0].roomTitle, "Jam room");
    assert.equal(received.result.invitations[0].status, "pending");
    const sent = call("room-invite-list", owner(), { scope: "sent" });
    assert.equal(sent.result.total, 1);
    assert.equal(call("room-invite-list", stranger(), {}).result.total, 0);
  });
});
