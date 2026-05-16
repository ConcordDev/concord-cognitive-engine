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
