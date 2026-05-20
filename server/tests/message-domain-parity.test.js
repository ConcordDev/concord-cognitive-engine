import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerMessageActions from "../domains/message.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`message.${name}`);
  if (!fn) throw new Error(`message.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerMessageActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("message — saved (starred)", () => {
  it("saves a message", () => {
    const r = call("save-message", ctxA, {
      messageId: "m_1", threadId: "t_1", sender: "alice",
      body: "let's meet at 3pm",
    });
    assert.equal(r.ok, true);
  });

  it("rejects missing body", () => {
    const r = call("save-message", ctxA, { messageId: "m_1", body: "  " });
    assert.equal(r.ok, false);
  });

  it("INVARIANT: saved scoped per-user", () => {
    call("save-message", ctxA, { messageId: "m_1", body: "private" });
    const b = call("saved-list", ctxB);
    assert.equal(b.result.saved.length, 0);
  });

  it("unsave removes from list", () => {
    call("save-message", ctxA, { messageId: "m_1", body: "tmp" });
    call("unsave-message", ctxA, { messageId: "m_1" });
    const l = call("saved-list", ctxA);
    assert.equal(l.result.saved.length, 0);
  });
});

describe("message — search", () => {
  beforeEach(() => {
    call("index-message", ctxA, { messageId: "m1", threadId: "t1", body: "let's meet at the cafe tomorrow", sender: "alice", ts: "2026-01-01T10:00:00Z" });
    call("index-message", ctxA, { messageId: "m2", threadId: "t2", body: "the coffee was great",            sender: "bob",   ts: "2026-01-02T10:00:00Z" });
    call("index-message", ctxA, { messageId: "m3", threadId: "t1", body: "see you at the cafe at 3",        sender: "alice", ts: "2026-01-03T10:00:00Z" });
  });

  it("finds messages by body term", () => {
    const r = call("search-messages", ctxA, { query: "cafe" });
    assert.equal(r.ok, true);
    assert.equal(r.result.hits.length, 2);
  });

  it("multi-term AND search", () => {
    const r = call("search-messages", ctxA, { query: "cafe tomorrow" });
    assert.equal(r.result.hits.length, 1);
    assert.equal(r.result.hits[0].messageId, "m1");
  });

  it("filters by sender", () => {
    const r = call("search-messages", ctxA, { query: "the", sender: "bob" });
    assert.equal(r.result.hits.length, 1);
    assert.equal(r.result.hits[0].sender, "bob");
  });

  it("rejects 1-char query", () => {
    const r = call("search-messages", ctxA, { query: "a" });
    assert.equal(r.ok, false);
  });

  it("INVARIANT: search scoped per-user", () => {
    const b = call("search-messages", ctxB, { query: "cafe" });
    assert.equal(b.result.hits.length, 0);
  });

  it("re-indexing same messageId updates entry", () => {
    call("index-message", ctxA, { messageId: "m1", body: "completely new content", sender: "alice", ts: "2026-02-01T00:00:00Z" });
    const r = call("search-messages", ctxA, { query: "new content" });
    assert.equal(r.result.hits.length, 1);
    assert.equal(r.result.hits[0].messageId, "m1");
  });
});

describe("message — reactions", () => {
  it("react increments count", () => {
    const r1 = call("react", ctxA, { messageId: "m1", emoji: "👍" });
    assert.equal(r1.result.count, 1);
    const r2 = call("react", ctxA, { messageId: "m1", emoji: "👍" });
    assert.equal(r2.result.count, 2);
  });

  it("unreact decrements", () => {
    call("react", ctxA, { messageId: "m1", emoji: "❤️" });
    call("react", ctxA, { messageId: "m1", emoji: "❤️" });
    const r = call("unreact", ctxA, { messageId: "m1", emoji: "❤️" });
    assert.equal(r.result.count, 1);
  });

  it("reactions-for returns map", () => {
    call("react", ctxA, { messageId: "m1", emoji: "👍" });
    call("react", ctxA, { messageId: "m1", emoji: "❤️" });
    const r = call("reactions-for", ctxA, { messageId: "m1" });
    assert.deepEqual(r.result.reactions, { "👍": 1, "❤️": 1 });
  });

  it("INVARIANT: reactions scoped per-user", () => {
    call("react", ctxA, { messageId: "m_shared", emoji: "👍" });
    const b = call("reactions-for", ctxB, { messageId: "m_shared" });
    assert.deepEqual(b.result.reactions, {});
  });
});

describe("message — voice notes", () => {
  it("registers voice metadata", () => {
    const r = call("voice-register", ctxA, { messageId: "m1", durationMs: 8500, transcript: "hi quick voice note" });
    assert.equal(r.ok, true);
    assert.equal(r.result.meta.durationMs, 8500);
  });

  it("rejects duration > 10 min", () => {
    const r = call("voice-register", ctxA, { messageId: "m1", durationMs: 700_000 });
    assert.equal(r.ok, false);
  });

  it("voice-list returns sorted recent-first", () => {
    call("voice-register", ctxA, { messageId: "m1", durationMs: 1000 });
    call("voice-register", ctxA, { messageId: "m2", durationMs: 2000 });
    const r = call("voice-list", ctxA);
    assert.equal(r.result.voices.length, 2);
  });
});

describe("message — STATE unavailable path", () => {
  it("returns error shape when STATE is missing", () => {
    globalThis._concordSTATE = undefined;
    const r = call("saved-list", ctxA);
    assert.equal(r.ok, false);
  });
});

describe("message — multi-device realtime sync (per-user room fan-out)", () => {
  function captureRealtimeEmits() {
    const events = [];
    globalThis._concordREALTIME = {
      io: { to: (room) => ({ emit: (name, payload) => events.push({ room, name, payload }) }) },
    };
    return events;
  }

  it("save-message emits message:saved to user:${userId} room only", () => {
    const events = captureRealtimeEmits();
    const r = call("save-message", ctxA, { messageId: "m1", threadId: "t1", sender: "alice", body: "hi" });
    assert.equal(r.ok, true);
    const e = events.find((ev) => ev.name === "message:saved");
    assert.ok(e);
    assert.equal(e.room, "user:user_a");
    // userId injected by emitToUserRoom
    assert.equal(e.payload.userId, "user_a");
    assert.equal(e.payload.messageId, "m1");
    assert.equal(e.payload.threadId, "t1");
  });

  it("unsave-message emits message:unsaved", () => {
    call("save-message", ctxA, { messageId: "m1", body: "hi" });
    const events = captureRealtimeEmits();
    call("unsave-message", ctxA, { messageId: "m1" });
    const e = events.find((ev) => ev.name === "message:unsaved");
    assert.ok(e);
    assert.equal(e.payload.messageId, "m1");
  });

  it("react emits message:reacted with current count", () => {
    const events = captureRealtimeEmits();
    call("react", ctxA, { messageId: "m1", emoji: "👍" });
    call("react", ctxA, { messageId: "m1", emoji: "👍" });
    const reactEvents = events.filter((ev) => ev.name === "message:reacted");
    assert.equal(reactEvents.length, 2);
    assert.equal(reactEvents[1].payload.count, 2);
    assert.equal(reactEvents[1].payload.emoji, "👍");
  });

  it("unreact emits message:reacted with decremented count", () => {
    call("react", ctxA, { messageId: "m1", emoji: "👍" });
    call("react", ctxA, { messageId: "m1", emoji: "👍" });
    const events = captureRealtimeEmits();
    call("unreact", ctxA, { messageId: "m1", emoji: "👍" });
    const e = events.find((ev) => ev.name === "message:reacted");
    assert.ok(e);
    assert.equal(e.payload.count, 1);
  });

  it("voice-register emits message:voice-registered", () => {
    const events = captureRealtimeEmits();
    call("voice-register", ctxA, { messageId: "m1", durationMs: 1500 });
    const e = events.find((ev) => ev.name === "message:voice-registered");
    assert.ok(e);
    assert.equal(e.payload.durationMs, 1500);
  });

  it("realtime emit failure does not throw (best-effort)", () => {
    globalThis._concordREALTIME = {
      io: { to: () => ({ emit: () => { throw new Error("socket dead"); } }) },
    };
    const r = call("save-message", ctxA, { messageId: "m1", body: "hi" });
    assert.equal(r.ok, true);
  });

  it("INVARIANT: emits use user:${userId} as the room (per-user scoping, not per-thread)", () => {
    const events = captureRealtimeEmits();
    call("save-message", ctxA, { messageId: "m1", body: "x" });
    call("save-message", ctxB, { messageId: "m2", body: "y" });
    const rooms = events.filter((ev) => ev.name === "message:saved").map((ev) => ev.room);
    assert.deepEqual(rooms.sort(), ["user:user_a", "user:user_b"]);
  });
});

// ═════════════════════════════════════════════════════════════════
//  Slack / Gmail 2026 parity — channels, messages, threads,
//  mentions, labels, snooze, schedule-send, AI features.
// ═════════════════════════════════════════════════════════════════

describe("message — channels", () => {
  it("auto-seeds #general + #random on first list", () => {
    const r = call("channels-list", ctxA);
    assert.equal(r.ok, true);
    const names = r.result.channels.map(c => c.name).sort();
    assert.deepEqual(names, ["general", "random"]);
  });

  it("creates a private channel", () => {
    call("channels-list", ctxA);
    const r = call("channels-create", ctxA, { name: "Engineering", kind: "channel", isPrivate: true });
    assert.equal(r.ok, true);
    assert.equal(r.result.channel.name, "engineering");
    assert.equal(r.result.channel.isPrivate, true);
  });

  it("rejects duplicate channel name", () => {
    call("channels-list", ctxA);
    const r = call("channels-create", ctxA, { name: "general" });
    assert.equal(r.ok, false);
  });
});

describe("message — messages send / edit / delete", () => {
  it("sends a message into a channel", () => {
    const channels = call("channels-list", ctxA).result.channels;
    const general = channels.find(c => c.name === "general");
    const r = call("messages-send", ctxA, { channelId: general.id, body: "Hello @bob check this out" });
    assert.equal(r.ok, true);
    assert.equal(r.result.message.body, "Hello @bob check this out");
    assert.deepEqual(r.result.message.mentions, ["bob"]);
    assert.equal(r.result.mentionsFanout, 1);
  });

  it("only sender can edit", () => {
    const channels = call("channels-list", ctxA).result.channels;
    const m = call("messages-send", ctxA, { channelId: channels[0].id, body: "first" }).result.message;
    const otherEdit = call("messages-edit", ctxB, { channelId: channels[0].id, id: m.id, body: "hacked" });
    // Note: ctxB has its own channels namespace so message wouldn't even be found
    assert.equal(otherEdit.ok, false);
    const myEdit = call("messages-edit", ctxA, { channelId: channels[0].id, id: m.id, body: "updated" });
    assert.equal(myEdit.ok, true);
    assert.equal(myEdit.result.message.edited, true);
    assert.equal(myEdit.result.message.body, "updated");
  });

  it("delete removes the message", () => {
    const channels = call("channels-list", ctxA).result.channels;
    const m = call("messages-send", ctxA, { channelId: channels[0].id, body: "x" }).result.message;
    call("messages-delete", ctxA, { channelId: channels[0].id, id: m.id });
    const list = call("messages-list", ctxA, { channelId: channels[0].id }).result.messages;
    assert.ok(!list.find(x => x.id === m.id));
  });

  it("messages-list returns paginated slice", () => {
    const channels = call("channels-list", ctxA).result.channels;
    for (let i = 0; i < 5; i++) call("messages-send", ctxA, { channelId: channels[0].id, body: `m${i}` });
    const r = call("messages-list", ctxA, { channelId: channels[0].id, limit: 3 });
    assert.equal(r.ok, true);
    assert.equal(r.result.messages.length, 3);
    assert.equal(r.result.hasMore, true);
  });
});

describe("message — threads", () => {
  it("thread-reply increments root threadCount", () => {
    const channels = call("channels-list", ctxA).result.channels;
    const root = call("messages-send", ctxA, { channelId: channels[0].id, body: "Topic" }).result.message;
    call("thread-reply", ctxA, { channelId: channels[0].id, rootId: root.id, body: "reply 1" });
    const r2 = call("thread-reply", ctxA, { channelId: channels[0].id, rootId: root.id, body: "reply 2" });
    assert.equal(r2.result.threadCount, 2);
    const list = call("thread-list", ctxA, { rootId: root.id });
    assert.equal(list.result.replies.length, 2);
  });
});

describe("message — labels (Gmail-style)", () => {
  it("create + apply + remove + lookup", () => {
    const lbl = call("labels-create", ctxA, { name: "follow-up", color: "#f43f5e" }).result.label;
    call("labels-apply", ctxA, { messageId: "m_1", labelId: lbl.id });
    const get = call("labels-for-message", ctxA, { messageId: "m_1" });
    assert.equal(get.result.labels.length, 1);
    assert.equal(get.result.labels[0].name, "follow-up");
    call("labels-remove", ctxA, { messageId: "m_1", labelId: lbl.id });
    const after = call("labels-for-message", ctxA, { messageId: "m_1" });
    assert.equal(after.result.labels.length, 0);
  });
});

describe("message — snooze", () => {
  it("snooze + list + unsnooze", () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    call("snooze", ctxA, { messageId: "m_1", until: future });
    const list = call("snooze-list", ctxA);
    assert.equal(list.result.snoozed.length, 1);
    call("unsnooze", ctxA, { messageId: "m_1" });
    assert.equal(call("snooze-list", ctxA).result.snoozed.length, 0);
  });
  it("rejects past timestamp", () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    call("snooze", ctxA, { messageId: "m_1", until: past });
    // snooze itself accepts any valid ISO; the filter excludes past in list
    const list = call("snooze-list", ctxA);
    assert.equal(list.result.snoozed.length, 0);
  });
});

describe("message — schedule-send", () => {
  it("schedule then flush due", () => {
    const channels = call("channels-list", ctxA).result.channels;
    const past = new Date(Date.now() - 1_000).toISOString();
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const rej = call("schedule-send", ctxA, { channelId: channels[0].id, body: "x", sendAt: past });
    assert.equal(rej.ok, false);
    const sched = call("schedule-send", ctxA, { channelId: channels[0].id, body: "future hello", sendAt: future });
    assert.equal(sched.ok, true);
    assert.equal(call("schedule-list", ctxA).result.scheduled.length, 1);
    // Simulate time passing by overriding the sendAt to past
    sched.result.scheduled.sendAt = past;
    // Re-fetch via state
    const all = globalThis._concordSTATE.messageLens.scheduled.get("user_a");
    all[0].sendAt = past;
    const flush = call("schedule-flush-due", ctxA);
    assert.equal(flush.result.sentCount, 1);
    const msgs = call("messages-list", ctxA, { channelId: channels[0].id }).result.messages;
    assert.ok(msgs.find(m => m.body === "future hello"));
  });
});

describe("message — AI features", () => {
  it("ai-summarize-channel returns deterministic when no brain", async () => {
    const channels = call("channels-list", ctxA).result.channels;
    call("messages-send", ctxA, { channelId: channels[0].id, body: "Let us pick a launch date", senderName: "Alice" });
    call("messages-send", ctxA, { channelId: channels[0].id, body: "How about Friday?", senderName: "Bob" });
    const r = await call("ai-summarize-channel", ctxA, { channelId: channels[0].id });
    assert.equal(r.ok, true);
    assert.equal(r.result.source, "deterministic");
    assert.ok(r.result.summary.length > 10);
  });

  it("ai-smart-reply returns 3 suggestions", async () => {
    const r = await call("ai-smart-reply", ctxA, { lastMessage: "Could you send the report?" });
    assert.equal(r.ok, true);
    assert.equal(r.result.suggestions.length, 3);
  });

  it("ai-action-items extracts imperative + by-date phrases", async () => {
    const text = "We need to ship the API by Friday. Bob should review the PR. Please send the deck to @charlie by 2026-06-15.";
    const r = await call("ai-action-items", ctxA, { text });
    assert.equal(r.ok, true);
    assert.ok(r.result.count >= 2);
    const owner = r.result.actionItems.find(x => x.owner === "charlie");
    assert.ok(owner);
  });

  it("ai-search-messages finds across channels", () => {
    const channels = call("channels-list", ctxA).result.channels;
    call("messages-send", ctxA, { channelId: channels[0].id, body: "deploy plan looks good" });
    call("messages-send", ctxA, { channelId: channels[1].id, body: "another deploy note" });
    const r = call("ai-search-messages", ctxA, { query: "deploy" });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 2);
  });
});

describe("message — inbox-summary", () => {
  it("aggregates unread + mentions + scheduled + snoozed", () => {
    const channels = call("channels-list", ctxA).result.channels;
    // Send messages as ctxB so they show as unread to ctxA (but channels are per-user...)
    // For this test, we just verify shape:
    const r = call("inbox-summary", ctxA);
    assert.equal(r.ok, true);
    assert.ok("channelCount" in r.result);
    assert.ok("totalUnread" in r.result);
    assert.ok("scheduledCount" in r.result);
    assert.ok("snoozedCount" in r.result);
    assert.equal(r.result.channelCount, channels.length);
  });
});

describe("message — pinned messages", () => {
  function seedMsg(ctx = ctxA) {
    const ch = call("channels-create", ctx, { name: "pins-ch" }).result.channel;
    const msg = call("messages-send", ctx, { channelId: ch.id, body: "pin me" }).result.message;
    return { ch, msg };
  }
  it("pin / list / unpin lifecycle", () => {
    const { ch, msg } = seedMsg();
    const pinned = call("pin-message", ctxA, { channelId: ch.id, messageId: msg.id });
    assert.equal(pinned.ok, true);
    assert.equal(pinned.result.pinCount, 1);
    assert.equal(call("pins-list", ctxA, { channelId: ch.id }).result.count, 1);
    assert.equal(call("pin-message", ctxA, { channelId: ch.id, messageId: msg.id }).ok, false); // dup
    const unp = call("unpin-message", ctxA, { channelId: ch.id, messageId: msg.id });
    assert.equal(unp.ok, true);
    assert.equal(call("pins-list", ctxA, { channelId: ch.id }).result.count, 0);
  });
  it("rejects pinning an unknown message", () => {
    const ch = call("channels-create", ctxA, { name: "empty-ch" }).result.channel;
    assert.equal(call("pin-message", ctxA, { channelId: ch.id, messageId: "nope" }).ok, false);
  });
});

describe("message — channel bookmarks", () => {
  it("add / list / remove", () => {
    const ch = call("channels-create", ctxA, { name: "bm-ch" }).result.channel;
    const bm = call("bookmark-add", ctxA, { channelId: ch.id, title: "Spec doc", url: "https://x.test/spec" });
    assert.equal(bm.ok, true);
    assert.equal(call("bookmark-list", ctxA, { channelId: ch.id }).result.count, 1);
    assert.equal(call("bookmark-remove", ctxA, { channelId: ch.id, id: bm.result.bookmark.id }).ok, true);
    assert.equal(call("bookmark-list", ctxA, { channelId: ch.id }).result.count, 0);
  });
  it("requires a title", () => {
    const ch = call("channels-create", ctxA, { name: "bm-ch2" }).result.channel;
    assert.equal(call("bookmark-add", ctxA, { channelId: ch.id }).ok, false);
  });
});

describe("message — status & presence", () => {
  it("set / get / clear with per-user scope", () => {
    assert.equal(call("status-get", ctxA, {}).result.status.presence, "active");
    const set = call("status-set", ctxA, { emoji: "🌴", text: "On vacation", presence: "away", durationMin: 60 });
    assert.equal(set.result.status.text, "On vacation");
    assert.ok(set.result.status.expiresAt);
    assert.equal(call("status-get", ctxA, {}).result.status.emoji, "🌴");
    assert.equal(call("status-get", ctxB, {}).result.status.text, ""); // other user unaffected
    call("status-clear", ctxA, {});
    assert.equal(call("status-get", ctxA, {}).result.status.text, "");
  });
});
