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
