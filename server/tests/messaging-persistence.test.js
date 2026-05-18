// server/tests/messaging-persistence.test.js
//
// Tier-2 contract tests for Message lens Sprint A #1 — DB substrate
// (migration 209). Real SQLite, real CRUD round-trip, real role
// enforcement, real reaction toggle, real thread threading.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  createConversation, getConversation, listConversationsForUser,
  addParticipant, removeParticipant, getRole, hasRole, listParticipants,
  postMessage, getMessage, listMessages, editMessage, deleteMessage,
  togglePin, toggleReaction, markRead, listReadReceipts, unreadCountForConversation,
  saveDraft, getDraft, clearDraft,
  addBookmark, removeBookmark, listBookmarks,
  snoozeThread, getThreadSubscription,
  setPresence, getPresenceMany,
} from "../lib/messaging/persistence.js";

let db;

before(async () => {
  db = new Database(":memory:");
  const mig = await import("../migrations/209_messaging_substrate.js");
  mig.up(db);
});
after(() => { try { db.close(); } catch { /* ok */ } });

describe("messaging-persistence: conversations CRUD", () => {
  it("createConversation(dm) requires exactly 2 participants", () => {
    const r = createConversation(db, { kind: "dm", ownerId: "u_a", participants: ["u_b", "u_c"] });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "dm_needs_exactly_two_participants");
  });

  it("createConversation(dm) builds a deterministic sorted id", () => {
    const r1 = createConversation(db, { kind: "dm", ownerId: "u_zeta", participants: ["u_alpha"] });
    const r2 = createConversation(db, { kind: "dm", ownerId: "u_alpha", participants: ["u_zeta"] });
    assert.equal(r1.id, r2.id, "dm id is sorted-pair, identical both directions");
    assert.ok(r1.id.startsWith("dm:u_alpha:u_zeta"));
  });

  it("createConversation(group) needs at least 2 participants", () => {
    const r = createConversation(db, { kind: "group", ownerId: "u_solo", participants: [] });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "group_needs_at_least_two_participants");
  });

  it("createConversation(channel) writes a row + auto-adds owner as 'owner'", () => {
    const r = createConversation(db, { kind: "channel", title: "general", ownerId: "u_owner", workspaceId: "ws_test" });
    assert.equal(r.ok, true);
    assert.ok(r.id.startsWith("channel:"));
    assert.equal(getRole(db, r.id, "u_owner"), "owner");
    const row = getConversation(db, r.id);
    assert.equal(row.kind, "channel");
    assert.equal(row.workspace_id, "ws_test");
  });

  it("listConversationsForUser scopes by participation + kind", () => {
    const dm = createConversation(db, { kind: "dm", ownerId: "u_a", participants: ["u_b"] });
    const ch = createConversation(db, { kind: "channel", title: "scoped", ownerId: "u_a" });
    addParticipant(db, { conversationId: ch.id, userId: "u_b", role: "member" });
    const all = listConversationsForUser(db, "u_b");
    assert.ok(all.find((c) => c.id === dm.id));
    assert.ok(all.find((c) => c.id === ch.id));
    const onlyDMs = listConversationsForUser(db, "u_b", { kind: "dm" });
    assert.ok(onlyDMs.every((c) => c.kind === "dm"));
  });
});

describe("messaging-persistence: roles + participation", () => {
  let cid;
  before(() => {
    const r = createConversation(db, { kind: "channel", title: "perms-chan", ownerId: "u_owner" });
    cid = r.id;
    addParticipant(db, { conversationId: cid, userId: "u_admin", role: "admin" });
    addParticipant(db, { conversationId: cid, userId: "u_member", role: "member" });
    addParticipant(db, { conversationId: cid, userId: "u_guest", role: "guest" });
  });
  it("hasRole orders owner > admin > member > guest", () => {
    assert.ok(hasRole(db, cid, "u_owner", "owner"));
    assert.ok(hasRole(db, cid, "u_admin", "member"));
    assert.ok(!hasRole(db, cid, "u_member", "admin"));
    assert.ok(hasRole(db, cid, "u_guest", "guest"));
    assert.ok(!hasRole(db, cid, "u_outsider", "guest"));
  });
  it("removeParticipant never removes the owner", () => {
    const r = removeParticipant(db, { conversationId: cid, userId: "u_owner" });
    assert.equal(r.removed, 0);
    assert.equal(getRole(db, cid, "u_owner"), "owner");
  });
  it("removeParticipant removes a non-owner", () => {
    const r = removeParticipant(db, { conversationId: cid, userId: "u_guest" });
    assert.equal(r.removed, 1);
    assert.equal(getRole(db, cid, "u_guest"), null);
  });
});

describe("messaging-persistence: messages + threads + read receipts", () => {
  let cid;
  before(() => {
    const r = createConversation(db, { kind: "channel", title: "msgs-chan", ownerId: "u_a", participants: ["u_b"] });
    cid = r.id;
  });

  it("postMessage requires non-empty body for text kind", () => {
    const r = postMessage(db, { conversationId: cid, authorId: "u_a", body: "" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "body_required");
  });

  it("postMessage writes a row + bumps conversation updated_at", () => {
    const before = getConversation(db, cid).updated_at;
    const r = postMessage(db, { conversationId: cid, authorId: "u_a", body: "hello", mentions: ["u_b"] });
    assert.equal(r.ok, true);
    const after = getConversation(db, cid).updated_at;
    assert.ok(after >= before);
    const m = getMessage(db, r.id);
    assert.deepEqual(m.mentions, ["u_b"]);
  });

  it("threaded post: parent_message_id wires the child", () => {
    const parent = postMessage(db, { conversationId: cid, authorId: "u_a", body: "root" });
    const child = postMessage(db, { conversationId: cid, authorId: "u_b", body: "reply", parentMessageId: parent.id });
    assert.equal(child.ok, true);
    const threadMsgs = listMessages(db, cid, { parentMessageId: parent.id });
    assert.equal(threadMsgs.length, 1);
    assert.equal(threadMsgs[0].body, "reply");
    const rootLevel = listMessages(db, cid, { parentMessageId: null });
    assert.ok(rootLevel.every((m) => m.parent_message_id === null));
  });

  it("editMessage rejects non-author", () => {
    const r = postMessage(db, { conversationId: cid, authorId: "u_a", body: "mine" });
    const e = editMessage(db, { id: r.id, userId: "u_b", body: "stolen" });
    assert.equal(e.ok, false);
    assert.equal(e.reason, "forbidden");
  });

  it("deleteMessage soft-deletes + hides from listMessages by default", () => {
    const r = postMessage(db, { conversationId: cid, authorId: "u_a", body: "delete me" });
    const d = deleteMessage(db, { id: r.id, userId: "u_a" });
    assert.equal(d.ok, true);
    const msgs = listMessages(db, cid);
    assert.ok(!msgs.find((m) => m.id === r.id));
  });

  it("togglePin requires member+", () => {
    const r = postMessage(db, { conversationId: cid, authorId: "u_a", body: "pin me" });
    const p = togglePin(db, { id: r.id, userId: "u_outsider", pin: true });
    assert.equal(p.reason, "forbidden");
    const p2 = togglePin(db, { id: r.id, userId: "u_a", pin: true });
    assert.equal(p2.pinned, true);
  });

  it("toggleReaction add → remove cycle", () => {
    const r = postMessage(db, { conversationId: cid, authorId: "u_a", body: "react" });
    const on = toggleReaction(db, { id: r.id, userId: "u_b", emoji: "🚀" });
    assert.equal(on.action, "added");
    assert.equal(on.totalForEmoji, 1);
    const off = toggleReaction(db, { id: r.id, userId: "u_b", emoji: "🚀" });
    assert.equal(off.action, "removed");
    assert.equal(off.totalForEmoji, 0);
  });

  it("markRead writes a receipt and updates last_read", () => {
    const m = postMessage(db, { conversationId: cid, authorId: "u_a", body: "unread!" });
    markRead(db, { messageId: m.id, userId: "u_b" });
    const r = listReadReceipts(db, m.id);
    assert.ok(r.some((x) => x.user_id === "u_b"));
  });

  it("unreadCountForConversation respects last_read pointer + excludes own messages", () => {
    // Fresh channel for a clean count
    const c2 = createConversation(db, { kind: "channel", title: "unread-chan", ownerId: "u_a", participants: ["u_b"] });
    postMessage(db, { conversationId: c2.id, authorId: "u_a", body: "1" });
    postMessage(db, { conversationId: c2.id, authorId: "u_a", body: "2" });
    postMessage(db, { conversationId: c2.id, authorId: "u_b", body: "from me" });
    // u_b's view: 2 unread from a, 0 from self
    assert.equal(unreadCountForConversation(db, c2.id, "u_b"), 2);
    // Mark them as read
    const all = listMessages(db, c2.id);
    for (const m of all) if (m.author_id !== "u_b") markRead(db, { messageId: m.id, userId: "u_b" });
    assert.equal(unreadCountForConversation(db, c2.id, "u_b"), 0);
  });
});

describe("messaging-persistence: drafts / bookmarks / snooze / presence", () => {
  let cid;
  before(() => {
    const r = createConversation(db, { kind: "channel", title: "ux-chan", ownerId: "u_a", participants: ["u_b"] });
    cid = r.id;
  });

  it("saveDraft → getDraft round-trip; clearDraft removes it", () => {
    saveDraft(db, { userId: "u_a", conversationId: cid, body: "in progress…" });
    const d = getDraft(db, { userId: "u_a", conversationId: cid });
    assert.equal(d.body, "in progress…");
    clearDraft(db, { userId: "u_a", conversationId: cid });
    assert.equal(getDraft(db, { userId: "u_a", conversationId: cid }), null);
  });

  it("bookmarks add + list + remove round-trip", () => {
    const m = postMessage(db, { conversationId: cid, authorId: "u_a", body: "important" });
    addBookmark(db, { userId: "u_b", messageId: m.id, note: "follow up" });
    const list = listBookmarks(db, "u_b");
    assert.ok(list.find((b) => b.message_id === m.id && b.note === "follow up"));
    removeBookmark(db, { userId: "u_b", messageId: m.id });
    assert.equal(listBookmarks(db, "u_b").find((b) => b.message_id === m.id), undefined);
  });

  it("snoozeThread sets snoozed_until + retrievable via getThreadSubscription", () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    snoozeThread(db, { userId: "u_b", conversationId: cid, snoozedUntil: future, tag: "later" });
    const sub = getThreadSubscription(db, { userId: "u_b", conversationId: cid });
    assert.equal(sub.snoozed_until, future);
    assert.equal(sub.tag, "later");
  });

  it("setPresence rejects invalid status", () => {
    const r = setPresence(db, { userId: "u_a", status: "spinning" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_status");
  });

  it("setPresence + getPresenceMany round-trip", () => {
    setPresence(db, { userId: "u_a", status: "focus", customText: "deep work", focusUntil: Math.floor(Date.now() / 1000) + 3600 });
    setPresence(db, { userId: "u_b", status: "online" });
    const got = getPresenceMany(db, ["u_a", "u_b"]);
    const a = got.find((p) => p.user_id === "u_a");
    const b = got.find((p) => p.user_id === "u_b");
    assert.equal(a.status, "focus");
    assert.equal(a.custom_text, "deep work");
    assert.equal(b.status, "online");
  });
});
