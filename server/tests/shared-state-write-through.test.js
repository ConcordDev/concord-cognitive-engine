// Pins multi-HTTP shared-state write-through helpers (fail-soft, no Redis required).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createSessionActivityBridge,
  createMacroRateBridge,
  createApiRateBridge,
  createChatSessionBridge,
  createStyleVectorBridge,
  createSocketRoomBridge,
  installMapWriteThrough,
  serializeChatSession,
  deserializeChatSession,
  sharedStateCoverage,
} from "../lib/concurrency/shared-state.js";

describe("shared-state write-through", () => {
  it("session activity write-behind no-ops without redis", () => {
    const bridge = createSessionActivityBridge(() => null);
    bridge.writeBehindTouch("jti-1", Date.now());
    bridge.writeBehindClear("jti-1");
    assert.ok(true);
  });

  it("hydrateInto falls back to local map", async () => {
    const bridge = createSessionActivityBridge(() => null);
    const map = new Map([["a", 100]]);
    const v = await bridge.hydrateInto(map, "a");
    assert.equal(v, 100);
    const miss = await bridge.hydrateInto(map, "missing");
    assert.equal(miss, null);
  });

  it("macro rate write-behind no-ops without redis", () => {
    const bridge = createMacroRateBridge(() => null);
    bridge.writeBehindHit("scope.metrics", 60000);
    assert.ok(true);
  });

  it("api rate bridge exists", () => {
    const bridge = createApiRateBridge(() => null);
    bridge.writeBehindHit("user:1", 60000);
    assert.ok(true);
  });

  it("coverage doc lists priority keys including chat/style/rooms", () => {
    const c = sharedStateCoverage();
    assert.ok(c.writeThrough.includes("_SESSION_ACTIVITY.lastSeen"));
    assert.ok(c.writeThrough.includes("_macroRateLimits"));
    assert.ok(c.writeThrough.some((x) => x.includes("STATE.sessions")));
    assert.ok(c.writeThrough.some((x) => x.includes("STATE.styleVectors")));
    assert.ok(c.writeThrough.some((x) => x.includes("socket.io rooms")));
    assert.ok(c.perNodeOk.includes("STATE.qualia"));
    // sessions no longer hard stickyRequired once Redis KV is live
    assert.ok(!c.stickyRequired.includes("STATE.sessions"));
  });

  it("with mock redis, session touch writes setEx", async () => {
    const calls = [];
    const fake = {
      setEx: async (k, ttl, v) => { calls.push(["setEx", k, ttl, v]); },
      del: async (k) => { calls.push(["del", k]); },
      get: async () => null,
    };
    const bridge = createSessionActivityBridge(() => fake);
    bridge.writeBehindTouch("abc", 12345);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(calls[0][0], "setEx");
    assert.match(calls[0][1], /session-activity:abc$/);
    bridge.writeBehindClear("abc");
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(calls.at(-1)[0], "del");
  });

  it("serialize/deserialize chat session round-trips Sets", () => {
    const sess = {
      ownerId: "u1",
      participantIds: new Set(["u1", "u2"]),
      createdAt: "2026-01-01T00:00:00.000Z",
      messages: [{ role: "user", content: "hi" }],
      currentLens: "chat",
      lensHistory: [],
      crossDomainContext: {},
    };
    const raw = serializeChatSession(sess);
    assert.deepEqual(raw.participantIds, ["u1", "u2"]);
    const back = deserializeChatSession(raw);
    assert.ok(back.participantIds instanceof Set);
    assert.ok(back.participantIds.has("u2"));
    assert.equal(back.messages.length, 1);
  });

  it("chat session bridge writeBehind + hydrate with mock redis", async () => {
    const store = new Map();
    const fake = {
      setEx: async (k, ttl, v) => { store.set(k, v); },
      del: async (k) => { store.delete(k); },
      get: async (k) => store.get(k) ?? null,
      multi() {
        const ops = [];
        const api = {
          sAdd(k, v) { ops.push(["sAdd", k, v]); return api; },
          expire(k, t) { ops.push(["expire", k, t]); return api; },
          exec: async () => ops,
        };
        return api;
      },
      sAdd: async () => 1,
      sRem: async () => 1,
      sMembers: async () => [],
    };
    const bridge = createChatSessionBridge(() => fake);
    const map = new Map();
    const sess = {
      ownerId: "u1",
      participantIds: new Set(["u1"]),
      createdAt: "2026-01-01T00:00:00.000Z",
      messages: [{ role: "user", content: "hello" }],
    };
    bridge.writeBehindSession("s1", sess);
    await new Promise((r) => setTimeout(r, 15));
    assert.ok([...store.keys()].some((k) => k.includes("chat-session:s1")));

    const other = new Map();
    const hydrated = await bridge.hydrateInto(other, "s1");
    assert.ok(hydrated);
    assert.equal(hydrated.messages[0].content, "hello");
    assert.ok(other.has("s1"));
  });

  it("style vector bridge writeBehind + hydrate", async () => {
    const store = new Map();
    const fake = {
      setEx: async (k, ttl, v) => { store.set(k, v); },
      del: async (k) => { store.delete(k); },
      get: async (k) => store.get(k) ?? null,
    };
    const bridge = createStyleVectorBridge(() => fake);
    bridge.writeBehindStyle("s9", { abstraction: 0.4, warmth: 0.6 });
    await new Promise((r) => setTimeout(r, 15));
    const map = new Map();
    const v = await bridge.hydrateInto(map, "s9");
    assert.equal(v.abstraction, 0.4);
  });

  it("socket room bridge join/leave with mock redis", async () => {
    const members = new Map();
    const fake = {
      multi() {
        const api = {
          sAdd(k, v) {
            if (!members.has(k)) members.set(k, new Set());
            members.get(k).add(v);
            return api;
          },
          expire() { return api; },
          exec: async () => [],
        };
        return api;
      },
      sRem: async (k, v) => { members.get(k)?.delete(v); },
      sMembers: async (k) => [...(members.get(k) || [])],
    };
    const bridge = createSocketRoomBridge(() => fake);
    bridge.writeBehindJoin("user:u1", "sockA");
    await new Promise((r) => setTimeout(r, 10));
    const m = await bridge.members("user:u1");
    assert.deepEqual(m, ["sockA"]);
    bridge.writeBehindLeave("user:u1", "sockA");
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(await bridge.members("user:u1"), []);
  });

  it("installMapWriteThrough triggers onSet", () => {
    const hits = [];
    const map = new Map();
    installMapWriteThrough(map, {
      onSet: (k, v) => hits.push(["set", k, v]),
      onDelete: (k) => hits.push(["del", k]),
    });
    map.set("a", { n: 1 });
    map.delete("a");
    assert.deepEqual(hits[0], ["set", "a", { n: 1 }]);
    assert.deepEqual(hits[1], ["del", "a"]);
    assert.equal(map.__concordWriteThrough, true);
  });

  it("writeBehindRecent flushes in-place mutated sessions", async () => {
    const store = new Map();
    const fake = {
      setEx: async (k, ttl, v) => { store.set(k, v); },
      get: async (k) => store.get(k) ?? null,
      del: async () => {},
    };
    const bridge = createChatSessionBridge(() => fake);
    const map = new Map();
    map.set("s1", {
      ownerId: "u1",
      participantIds: new Set(["u1"]),
      createdAt: "2026-01-01T00:00:00.000Z",
      messages: [],
    });
    // in-place mutation (no Map.set)
    map.get("s1").messages.push({ role: "user", content: "pushed" });
    const n = bridge.writeBehindRecent(map, 10);
    assert.equal(n, 1);
    await new Promise((r) => setTimeout(r, 15));
    const raw = JSON.parse([...store.values()][0]);
    assert.equal(raw.messages[0].content, "pushed");
  });
});
