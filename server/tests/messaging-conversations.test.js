// server/tests/messaging-conversations.test.js
//
// Tier-2 contract tests for Message lens Sprint A — conversations
// + channels macro surfaces. Real migration 209 DB; macros invoked
// directly with stubbed ctx.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import registerMessagingConversationsMacros from "../domains/messaging-conversations.js";
import registerMessagingChannelsMacros from "../domains/messaging-channels.js";

let db; const macros = new Map();

before(async () => {
  db = new Database(":memory:");
  const mig = await import("../migrations/209_messaging_substrate.js");
  mig.up(db);
  registerMessagingConversationsMacros((_d, n, h) => macros.set(n, h));
  registerMessagingChannelsMacros((_d, n, h) => macros.set(n, h));
});
after(() => { try { db.close(); } catch { /* ok */ } });

describe("messaging-conversations: convo macros", () => {
  it("convo_create requires auth", async () => {
    const r = await macros.get("convo_create")({ db }, { kind: "dm", participants: ["u_b"] });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "auth_required");
  });

  it("convo_create(dm) makes a deterministic sorted id", async () => {
    const r1 = await macros.get("convo_create")({ db, actor: { userId: "u_alpha" } }, { kind: "dm", participants: ["u_zeta"] });
    const r2 = await macros.get("convo_create")({ db, actor: { userId: "u_zeta" } }, { kind: "dm", participants: ["u_alpha"] });
    assert.equal(r1.ok, true);
    assert.equal(r1.id, r2.id);
  });

  it("convo_list scopes to caller's participation", async () => {
    await macros.get("convo_create")({ db, actor: { userId: "u_a" } }, { kind: "channel", title: "ch-1" });
    const r = await macros.get("convo_list")({ db, actor: { userId: "u_a" } }, {});
    assert.equal(r.ok, true);
    assert.ok(r.conversations.length >= 1);
    // Each row has an unreadCount
    for (const c of r.conversations) assert.equal(typeof c.unreadCount, "number");
  });

  it("convo_get forbidden for non-participant", async () => {
    const c = await macros.get("convo_create")({ db, actor: { userId: "u_a" } }, { kind: "channel", title: "ch-private" });
    const r = await macros.get("convo_get")({ db, actor: { userId: "u_outsider" } }, { id: c.id });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "forbidden");
  });
});

describe("messaging-conversations: msg macros", () => {
  let cid;
  before(async () => {
    const c = await macros.get("convo_create")({ db, actor: { userId: "u_a" } }, { kind: "channel", title: "msg-ch" });
    cid = c.id;
    await macros.get("convo_add_participant")({ db, actor: { userId: "u_a" } }, { conversationId: cid, userId: "u_b", role: "member" });
  });

  it("msg_post forbidden for non-member", async () => {
    const r = await macros.get("msg_post")({ db, actor: { userId: "u_outsider" } }, { conversationId: cid, body: "hi" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "forbidden");
  });

  it("msg_post parses @mentions out of the body", async () => {
    const r = await macros.get("msg_post")({ db, actor: { userId: "u_a" } }, { conversationId: cid, body: "hey @u_b take a look" });
    assert.equal(r.ok, true);
    assert.deepEqual(r.message.mentions, ["u_b"]);
  });

  it("threaded post: parentMessageId is honored", async () => {
    const root = await macros.get("msg_post")({ db, actor: { userId: "u_a" } }, { conversationId: cid, body: "root" });
    const reply = await macros.get("msg_post")({ db, actor: { userId: "u_b" } }, { conversationId: cid, body: "reply", parentMessageId: root.id });
    assert.equal(reply.ok, true);
    const thread = await macros.get("msg_list")({ db, actor: { userId: "u_a" } }, { conversationId: cid, parentMessageId: root.id });
    assert.equal(thread.messages.length, 1);
    assert.equal(thread.messages[0].body, "reply");
  });

  it("msg_react toggles", async () => {
    const m = await macros.get("msg_post")({ db, actor: { userId: "u_a" } }, { conversationId: cid, body: "react?" });
    const on = await macros.get("msg_react")({ db, actor: { userId: "u_b" } }, { id: m.id, emoji: "👀" });
    assert.equal(on.action, "added");
    const off = await macros.get("msg_react")({ db, actor: { userId: "u_b" } }, { id: m.id, emoji: "👀" });
    assert.equal(off.action, "removed");
  });

  it("msg_pin requires member+", async () => {
    const m = await macros.get("msg_post")({ db, actor: { userId: "u_a" } }, { conversationId: cid, body: "pin" });
    const p = await macros.get("msg_pin")({ db, actor: { userId: "u_outsider" } }, { id: m.id, pin: true });
    assert.equal(p.reason, "forbidden");
  });

  it("msg_edit / msg_delete author-only", async () => {
    const m = await macros.get("msg_post")({ db, actor: { userId: "u_a" } }, { conversationId: cid, body: "mine" });
    const e = await macros.get("msg_edit")({ db, actor: { userId: "u_b" } }, { id: m.id, body: "stolen" });
    assert.equal(e.reason, "forbidden");
    const ok = await macros.get("msg_edit")({ db, actor: { userId: "u_a" } }, { id: m.id, body: "edited" });
    assert.equal(ok.ok, true);
  });

  it("msg_mark_read writes a receipt + msg_read_receipts surfaces it", async () => {
    const m = await macros.get("msg_post")({ db, actor: { userId: "u_a" } }, { conversationId: cid, body: "ack me" });
    await macros.get("msg_mark_read")({ db, actor: { userId: "u_b" } }, { messageId: m.id });
    const r = await macros.get("msg_read_receipts")({ db, actor: { userId: "u_a" } }, { messageId: m.id });
    assert.ok(r.receipts.some((x) => x.user_id === "u_b"));
  });
});

describe("messaging-conversations: drafts + bookmarks + snooze + presence", () => {
  let cid;
  before(async () => {
    const c = await macros.get("convo_create")({ db, actor: { userId: "u_a" } }, { kind: "channel", title: "drafts-ch" });
    cid = c.id;
  });

  it("draft_save → draft_get → draft_clear", async () => {
    await macros.get("draft_save")({ db, actor: { userId: "u_a" } }, { conversationId: cid, body: "in progress…" });
    const g = await macros.get("draft_get")({ db, actor: { userId: "u_a" } }, { conversationId: cid });
    assert.equal(g.draft.body, "in progress…");
    await macros.get("draft_clear")({ db, actor: { userId: "u_a" } }, { conversationId: cid });
    const g2 = await macros.get("draft_get")({ db, actor: { userId: "u_a" } }, { conversationId: cid });
    assert.equal(g2.draft, null);
  });

  it("msg_post auto-clears the caller's draft", async () => {
    await macros.get("draft_save")({ db, actor: { userId: "u_a" } }, { conversationId: cid, body: "wip" });
    await macros.get("msg_post")({ db, actor: { userId: "u_a" } }, { conversationId: cid, body: "shipped!" });
    const g = await macros.get("draft_get")({ db, actor: { userId: "u_a" } }, { conversationId: cid });
    assert.equal(g.draft, null);
  });

  it("bookmark_add / list / remove", async () => {
    const m = await macros.get("msg_post")({ db, actor: { userId: "u_a" } }, { conversationId: cid, body: "important" });
    const a = await macros.get("bookmark_add")({ db, actor: { userId: "u_b" } }, { messageId: m.id, note: "follow up" });
    assert.equal(a.ok, true);
    const l = await macros.get("bookmark_list")({ db, actor: { userId: "u_b" } }, {});
    assert.ok(l.bookmarks.find((b) => b.message_id === m.id));
    await macros.get("bookmark_remove")({ db, actor: { userId: "u_b" } }, { messageId: m.id });
    const l2 = await macros.get("bookmark_list")({ db, actor: { userId: "u_b" } }, {});
    assert.equal(l2.bookmarks.find((b) => b.message_id === m.id), undefined);
  });

  it("thread_snooze persists snoozedUntil + tag", async () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    await macros.get("thread_snooze")({ db, actor: { userId: "u_b" } }, { conversationId: cid, snoozedUntil: future, tag: "later" });
    const r = await macros.get("thread_subscription")({ db, actor: { userId: "u_b" } }, { conversationId: cid });
    assert.equal(r.subscription.snoozed_until, future);
    assert.equal(r.subscription.tag, "later");
  });

  it("presence_set + presence_get_many round-trip", async () => {
    await macros.get("presence_set")({ db, actor: { userId: "u_a" } }, { status: "focus", customText: "deep work" });
    const r = await macros.get("presence_get_many")({ db }, { userIds: ["u_a"] });
    assert.equal(r.presence[0].status, "focus");
    assert.equal(r.presence[0].custom_text, "deep work");
  });
});

describe("messaging-channels: channel macros", () => {
  it("channel_create rejects invalid name", async () => {
    const r = await macros.get("channel_create")({ db, actor: { userId: "u_a" } }, { name: "Bad Name!" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_name");
  });

  it("channel_create + channel_browse round-trip", async () => {
    const r = await macros.get("channel_create")({ db, actor: { userId: "u_a" } }, { name: "general-2026", topic: "watercooler" });
    assert.equal(r.ok, true);
    const b = await macros.get("channel_browse")({ db, actor: { userId: "u_a" } }, { q: "general" });
    assert.ok(b.channels.find((c) => c.id === r.id));
    const row = b.channels.find((c) => c.id === r.id);
    assert.equal(row.joined, true);
    assert.equal(row.memberCount, 1);
  });

  it("channel_join + channel_leave", async () => {
    const r = await macros.get("channel_create")({ db, actor: { userId: "u_a" } }, { name: "joinable" });
    const j = await macros.get("channel_join")({ db, actor: { userId: "u_joiner" } }, { conversationId: r.id });
    assert.equal(j.ok, true);
    const l = await macros.get("channel_leave")({ db, actor: { userId: "u_joiner" } }, { conversationId: r.id });
    assert.equal(l.ok, true);
  });

  it("channel_set_topic admin+", async () => {
    const r = await macros.get("channel_create")({ db, actor: { userId: "u_a" } }, { name: "topical" });
    await macros.get("channel_join")({ db, actor: { userId: "u_member" } }, { conversationId: r.id });
    const noPerm = await macros.get("channel_set_topic")({ db, actor: { userId: "u_member" } }, { conversationId: r.id, topic: "haha" });
    assert.equal(noPerm.reason, "forbidden");
    const ok = await macros.get("channel_set_topic")({ db, actor: { userId: "u_a" } }, { conversationId: r.id, topic: "official" });
    assert.equal(ok.ok, true);
    assert.equal(ok.topic, "official");
  });

  it("channel_members participant-only", async () => {
    const r = await macros.get("channel_create")({ db, actor: { userId: "u_a" } }, { name: "members-ch" });
    const forbid = await macros.get("channel_members")({ db, actor: { userId: "u_outsider" } }, { conversationId: r.id });
    assert.equal(forbid.reason, "forbidden");
    const ok = await macros.get("channel_members")({ db, actor: { userId: "u_a" } }, { conversationId: r.id });
    assert.equal(ok.ok, true);
    assert.ok(ok.members.length >= 1);
  });
});
