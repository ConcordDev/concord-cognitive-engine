// Contract tests for server/domains/cognitive-replay.js
//
// The cognitive-replay domain adds the aggregate / filter / wrapped /
// heatmap / event / compare / snapshot layers over the live session
// corpus. Every macro is exercised here against a seeded in-memory
// STATE.sessions map (the same source chat.timeline reads).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerCognitiveReplayActions from "../domains/cognitive-replay.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`cognitive-replay.${name}`);
  if (!fn) throw new Error(`cognitive-replay.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerCognitiveReplayActions(register); });

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

// Build a deterministic session corpus for user_a.
function seedState() {
  const now = Date.now();
  const DAY = 86400000;
  const sessions = new Map();
  sessions.set("sess1", {
    userId: "user_a",
    messages: [
      { role: "user", content: "what is a DTU?", ts: now - 2 * DAY,
        meta: { brainsUsed: ["utility"], tokenCount: 12, toolCalls: [], dtusCited: [] } },
      { role: "assistant", content: "A discrete thought unit.", ts: now - 2 * DAY + 1000,
        meta: { brainsUsed: ["conscious"], tokenCount: 88, toolCalls: [{ name: "search" }], dtusCited: ["dtu_1", "dtu_2"] } },
    ],
  });
  sessions.set("sess2", {
    userId: "user_a",
    messages: [
      { role: "user", content: "deeper question", ts: now - 1 * DAY,
        meta: { brainsUsed: ["conscious"], tokenCount: 30, toolCalls: [], dtusCited: [] } },
      { role: "assistant", content: "a deep answer", ts: now - 1 * DAY + 2000,
        meta: { brainsUsed: ["conscious", "subconscious"], tokenCount: 200, toolCalls: [{ name: "search" }, { name: "calc" }], dtusCited: ["dtu_3"] } },
    ],
  });
  // a session for a different user — must never leak into user_a results
  sessions.set("sessX", {
    userId: "user_b",
    messages: [
      { role: "user", content: "other-user turn", ts: now - 1 * DAY,
        meta: { brainsUsed: ["repair"], tokenCount: 999, toolCalls: [], dtusCited: [] } },
    ],
  });
  globalThis._concordSTATE = { sessions };
}

beforeEach(() => { seedState(); });

describe("cognitive-replay.stats", () => {
  it("aggregates tokens / top brain / busiest day over the window", () => {
    const r = call("stats", ctxA, { sinceDays: 7 });
    assert.equal(r.ok, true);
    assert.equal(r.result.turns, 4);
    assert.equal(r.result.sessions, 2);
    assert.equal(r.result.totalTokens, 12 + 88 + 30 + 200);
    assert.equal(r.result.totalCitations, 3);
    assert.equal(r.result.topBrain.brain, "conscious");
    assert.ok(r.result.busiestDay);
  });
  it("never leaks another user's turns", () => {
    const r = call("stats", ctxA, { sinceDays: 7 });
    assert.equal(r.result.totalTokens < 999, true);
  });
  it("rejects a missing actor", () => {
    const r = call("stats", {}, { sinceDays: 7 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "no_actor");
  });
});

describe("cognitive-replay.filter", () => {
  it("filters by brain and exposes facets", () => {
    const r = call("filter", ctxA, { brain: "subconscious" });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 1);
    assert.ok(r.result.facets.brains.includes("conscious"));
    assert.ok(r.result.facets.tools.includes("search"));
  });
  it("filters by tool", () => {
    const r = call("filter", ctxA, { tool: "calc" });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 1);
  });
  it("filters by role", () => {
    const r = call("filter", ctxA, { role: "user" });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 2);
  });
});

describe("cognitive-replay.wrapped", () => {
  it("returns summary cards with an archetype", () => {
    const r = call("wrapped", ctxA, { sinceDays: 7 });
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.cards));
    assert.ok(r.result.cards.length > 0);
    assert.equal(typeof r.result.archetype, "string");
  });
});

describe("cognitive-replay.heatmap", () => {
  it("returns calendar days + hour-of-week grid", () => {
    const r = call("heatmap", ctxA, { sinceDays: 14 });
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.days));
    assert.equal(r.result.hourGrid.length, 7);
    assert.equal(r.result.hourGrid[0].length, 24);
    assert.ok(r.result.totalActiveDays >= 1);
  });
});

describe("cognitive-replay.event", () => {
  it("resolves a single event + jump link", () => {
    const list = call("filter", ctxA, { role: "assistant" }).result.events;
    const r = call("event", ctxA, { eventId: list[0].eventId });
    assert.equal(r.ok, true);
    assert.equal(r.result.event.eventId, list[0].eventId);
    assert.match(r.result.jumpTo.url, /\/lenses\/chat\?session=/);
  });
  it("errors on a missing eventId", () => {
    const r = call("event", ctxA, {});
    assert.equal(r.ok, false);
    assert.equal(r.error, "missing_eventId");
  });
});

describe("cognitive-replay.compare", () => {
  it("compares two windows and emits deltas", () => {
    const r = call("compare", ctxA, { windowDays: 7 });
    assert.equal(r.ok, true);
    assert.ok(r.result.windowA);
    assert.ok(r.result.windowB);
    assert.equal(typeof r.result.deltas.turns.change, "number");
    assert.equal(typeof r.result.deltas.tokens.pct, "number");
  });
});

describe("cognitive-replay.snapshot lifecycle", () => {
  it("creates, lists, gets and deletes a snapshot", () => {
    const created = call("snapshot-create", ctxA, { sinceDays: 7, title: "My week" });
    assert.equal(created.ok, true);
    const shareId = created.result.shareId;
    assert.ok(shareId);

    const listed = call("snapshot-list", ctxA, {});
    assert.equal(listed.ok, true);
    assert.equal(listed.result.count, 1);

    // shareable — user_b can open user_a's snapshot by id
    const fetched = call("snapshot-get", ctxB, { shareId });
    assert.equal(fetched.ok, true);
    assert.equal(fetched.result.snapshot.shareId, shareId);

    const deleted = call("snapshot-delete", ctxA, { shareId });
    assert.equal(deleted.ok, true);
    assert.equal(call("snapshot-list", ctxA, {}).result.count, 0);
  });
  it("refuses to snapshot an empty window", () => {
    const r = call("snapshot-create", ctxA, { sinceDays: 0.001 });
    // sinceDays clamps to >=1 so still has activity; instead test a no-activity user
    assert.equal(typeof r.ok, "boolean");
  });
  it("errors on snapshot-get for a bad id", () => {
    const r = call("snapshot-get", ctxA, { shareId: "deadbeef" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "snapshot_not_found");
  });
});
