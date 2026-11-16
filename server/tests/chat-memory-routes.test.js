/**
 * Chat memory routes — FIX-feed-002 / FIX-transfer-005 (chat-memory leg).
 *
 * The client hook (concord-frontend/hooks/useConversationMemory.ts,
 * mounted by PersistentChatRail on every lens page) calls
 *   GET  /api/chat/memory/:sessionId           (stats on session change)
 *   POST /api/chat/memory/:sessionId/compress  (rolling-window compress)
 * and until these routes were registered both 404'd on ordinary lens
 * loads — the session-console noise both tickets record. The machinery
 * behind them (lib/conversation-memory.js: getSessionMemoryStats,
 * compressRollingWindow) already existed and already fired from the
 * /api/chat turn path; only the HTTP surface was missing.
 *
 * This suite hermetically mounts the real registerChatRoutes with a
 * stub dependency graph (the chat-session-ownership-gate.test.js
 * recipe — no server.js boot) and pins the contract:
 *   - signed-out → 401 on both routes (requireAuth)
 *   - account 1 reads its own memory by id → 200 with the real,
 *     non-zero stats (counts + topics, no message bodies)
 *   - GET never 404s for a signed-in caller. A never-seen id and a
 *     non-owned id (including ownerless / no persisted owner, and a
 *     failed owner lookup) both return 200 with the same zeroed stats
 *     body, byte-identical, with none of the real session's data.
 *     That is what keeps PersistentChatRail's fetch quiet on every
 *     lens load (FIX-feed-002 / FIX-transfer-005).
 *   - compress of a missing or non-owned id → 404, and the window
 *     is not written
 *   - an ownerless in-memory session is not public. If chat_sessions
 *     still has owner_id (the state snapshot drops ownerId), that
 *     owner reads real stats and anyone else gets the zeroed body.
 *   - a participant already recorded on the session may read (the
 *     existing shared-session allow; no admin bypass)
 *   - below the window threshold, compress is an honest no-op
 *     ({ ok:false, error:"below_threshold" }) at 200
 *   - at the threshold, compress actually compresses: the window
 *     trims by COMPRESSION_BATCH, a conversation_memory DTU is
 *     minted, and the stats show the cycle. Extraction takes the
 *     module's raw fallback path — the same path production takes
 *     when the brain is down — because the test pins the utility
 *     brain's address to a refuse-fast loopback port before the
 *     route module (and its brain config) is imported. (An
 *     unresolvable brain hostname can hang DNS until the fetch's
 *     abort timer, which returns "timeout" instead of falling
 *     back; a refused connection fails fast and deterministically
 *     in every environment.)
 *
 * Run: node --test server/tests/chat-memory-routes.test.js
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import express from "express";

let registerChatRoutes;
let routesLoaded;
async function loadRoutes() {
  if (!routesLoaded) {
    process.env.BRAIN_UTILITY_URL = "http://127.0.0.1:9";
    process.env.BRAIN_UTILITY_URLS = "http://127.0.0.1:9";
    routesLoaded = import("../routes/chat.js").then((m) => {
      registerChatRoutes = m.default;
    });
  }
  return routesLoaded;
}

function makeApp(STATE) {
  const app = express();
  app.use(express.json());
  // Test-only auth shim: x-test-user-id simulates an already-
  // authenticated caller; omitting it simulates an anonymous request.
  app.use((req, _res, next) => {
    const uid = req.get("x-test-user-id");
    if (uid) req.user = { id: uid };
    next();
  });

  registerChatRoutes(app, {
    STATE,
    makeCtx: (req) => ({ actor: { userId: req.user?.id || null } }),
    runMacro: async () => ({ ok: true }),
    enforceRequestInvariants: (_req, body) => body,
    enforceEthosInvariant: () => {},
    uid: () => "test_uid",
    kernelTick: () => {},
    uiJson: (res, body) => res.json(body),
    _withAck: (x) => x,
    _extractReply: (x) => x,
    clamp: (v) => v,
    nowISO: () => new Date().toISOString(),
    saveStateDebounced: () => {},
    ETHOS_INVARIANTS: {},
    validate: () => (_req, _res, next) => next(),
    perEndpointRateLimit: () => (_req, _res, next) => next(),
    requireAuth: () => (req, res, next) => {
      if (!req.user) return res.status(401).json({ ok: false, error: "Unauthorized" });
      next();
    },
    realtimeEmit: () => {},
  });
  return app;
}

const SECRET = "secret-fact-PLUM-77";

function seedSession(STATE, id, ownerId, messageCount) {
  const messages = [];
  for (let i = 0; i < messageCount; i++) {
    messages.push({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `message ${i} about lattice routing and memory ${SECRET}`,
      ts: new Date().toISOString(),
    });
  }
  STATE.sessions.set(id, {
    ownerId,
    participantIds: ownerId ? new Set([ownerId]) : new Set(),
    createdAt: new Date().toISOString(),
    messages,
  });
}

function assertNoMemoryData(body) {
  const raw = JSON.stringify(body);
  assert.equal(raw.includes(SECRET), false, "response leaked memory content");
  assert.equal(raw.includes("activeMessages"), false, "response leaked memory stats");
  assert.equal(raw.includes("topics"), false, "response leaked memory topics");
  assert.equal(raw.includes("windowUtilization"), false);
  assert.deepEqual(body, { ok: false, error: "not_found" });
}

const ZEROED_STATS = {
  ok: true,
  activeMessages: 0,
  totalMessagesProcessed: 0,
  compressionCycles: 0,
  memoryDtuCount: 0,
  megaCount: 0,
  topics: [],
  windowUtilization: "0/30",
};

function assertZeroedStats(body) {
  assert.deepEqual(body, ZEROED_STATS);
  const raw = JSON.stringify(body);
  assert.equal(raw.includes(SECRET), false, "zeroed stats leaked memory content");
  assert.equal(body.activeMessages, 0);
  assert.deepEqual(body.topics, []);
}

async function req(app, method, path, opts = {}) {
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const headers = { ...(opts.userId ? { "x-test-user-id": opts.userId } : {}) };
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers });
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    return { status: res.status, body, text };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe("GET /api/chat/memory/:sessionId", () => {
  let STATE, app;
  before(async () => {
    await loadRoutes();
    STATE = { sessions: new Map(), dtus: new Map() };
    seedSession(STATE, "mem-session", "mem-owner", 3);
    seedSession(STATE, "legacy-session", null, 2);
    seedSession(STATE, "db-down-session", null, 1);
    // Snapshot reload drops ownerId; chat_sessions.owner_id still names the owner.
    seedSession(STATE, "restored-session", null, 4);
    seedSession(STATE, "shared-session", "mem-owner", 2);
    STATE.sessions.get("shared-session").participantIds.add("mem-guest");
    const persistedOwners = new Map([["restored-session", "mem-owner"]]);
    STATE.db = {
      prepare(sql) {
        if (!String(sql).includes("owner_id")) throw new Error(`unexpected sql: ${sql}`);
        return {
          get(id) {
            if (id === "db-down-session") throw new Error("db down");
            const owner = persistedOwners.get(id);
            return owner ? { owner_id: owner } : undefined;
          },
        };
      },
    };
    STATE.dtus.set("dtu-mem-1", {
      id: "dtu-mem-1",
      machine: { kind: "conversation_memory", sessionId: "mem-session", topics: ["lattice", SECRET] },
    });
    STATE.dtus.set("dtu-restored", {
      id: "dtu-restored",
      machine: { kind: "conversation_memory", sessionId: "restored-session", topics: [SECRET] },
    });
    STATE.dtus.set("dtu-mega-1", {
      id: "dtu-mega-1",
      machine: { kind: "conversation_memory_mega", sessionIds: ["mem-session"] },
    });
    app = makeApp(STATE);
  });

  it("signed-out GET /api/chat/memory/:id returns 401", async () => {
    const r = await req(app, "GET", "/api/chat/memory/mem-session");
    assert.equal(r.status, 401);
    assert.equal(r.body.ok, false);
    assert.equal(JSON.stringify(r.body).includes(SECRET), false);
    assert.equal(JSON.stringify(r.body).includes("activeMessages"), false);
  });

  it("account 2 GET of account 1's memory id returns the zeroed stats and none of the real session", async () => {
    const r = await req(app, "GET", "/api/chat/memory/mem-session", { userId: "someone-else" });
    assert.equal(r.status, 200);
    assertZeroedStats(r.body);
    assert.equal(r.body.activeMessages === 3, false);
    assert.equal(r.body.topics.includes(SECRET), false);
    assert.equal(r.body.topics.includes("lattice"), false);
  });

  it("account 1 GET of its own memory id returns 200 with the memory stats", async () => {
    const r = await req(app, "GET", "/api/chat/memory/mem-session", { userId: "mem-owner" });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.activeMessages, 3);
    assert.equal(r.body.totalMessagesProcessed, 3);
    assert.equal(r.body.compressionCycles, 0);
    assert.equal(r.body.memoryDtuCount, 1);
    assert.equal(r.body.megaCount, 1);
    assert.deepEqual([...r.body.topics].sort(), ["lattice", SECRET].sort());
    assert.equal(r.body.windowUtilization, "3/30");
    assert.equal(JSON.stringify(r.body).includes("message 0 about"), false, "stats must not leak message bodies");
  });

  it("a participant already on the session reads it; a stranger does not", async () => {
    const guest = await req(app, "GET", "/api/chat/memory/shared-session", { userId: "mem-guest" });
    assert.equal(guest.status, 200);
    assert.equal(guest.body.ok, true);
    assert.equal(guest.body.activeMessages, 2);
    const stranger = await req(app, "GET", "/api/chat/memory/shared-session", { userId: "someone-else" });
    assert.equal(stranger.status, 200);
    assertZeroedStats(stranger.body);
    assert.notEqual(stranger.body.activeMessages, 2);
  });

  it("snapshot-restored memory: persisted owner reads it, another account gets zeroed stats", async () => {
    const owner = await req(app, "GET", "/api/chat/memory/restored-session", { userId: "mem-owner" });
    assert.equal(owner.status, 200);
    assert.equal(owner.body.ok, true);
    assert.equal(owner.body.activeMessages, 4);
    assert.ok(owner.body.topics.includes(SECRET));
    const other = await req(app, "GET", "/api/chat/memory/restored-session", { userId: "someone-else" });
    assert.equal(other.status, 200);
    assertZeroedStats(other.body);
  });

  it("an ownerless memory id with no persisted owner returns the zeroed stats", async () => {
    const r = await req(app, "GET", "/api/chat/memory/legacy-session", { userId: "anyone" });
    assert.equal(r.status, 200);
    assertZeroedStats(r.body);
    assert.notEqual(r.body.activeMessages, 2);
  });

  it("the zeroed body for a non-owner equals the nonexistent-id body", async () => {
    const denied = await req(app, "GET", "/api/chat/memory/mem-session", { userId: "someone-else" });
    const missing = await req(app, "GET", "/api/chat/memory/brand-new-session", { userId: "mem-owner" });
    assert.equal(denied.status, 200);
    assert.equal(missing.status, 200);
    assert.equal(denied.text, missing.text, "non-owner and missing id must be byte-identical");
    assertZeroedStats(denied.body);
    assertZeroedStats(missing.body);
  });

  it("a failed owner lookup does not fall open", async () => {
    const r = await req(app, "GET", "/api/chat/memory/db-down-session", { userId: "mem-owner" });
    assert.equal(r.status, 200);
    assertZeroedStats(r.body);
    assert.notEqual(r.body.activeMessages, 1, "the real message count must not leak when owner lookup throws");
  });
});

describe("POST /api/chat/memory/:sessionId/compress", () => {
  let STATE, app;
  before(async () => {
    await loadRoutes();
    STATE = { sessions: new Map(), dtus: new Map() };
    seedSession(STATE, "small-session", "mem-owner", 3);
    seedSession(STATE, "big-session", "mem-owner", 55);
    seedSession(STATE, "legacy-session", null, 3);
    seedSession(STATE, "restored-session", null, 3);
    STATE.db = {
      prepare() {
        return {
          get(id) {
            return id === "restored-session" ? { owner_id: "mem-owner" } : undefined;
          },
        };
      },
    };
    app = makeApp(STATE);
  });

  it("signed-out POST /api/chat/memory/:id/compress returns 401", async () => {
    const r = await req(app, "POST", "/api/chat/memory/small-session/compress");
    assert.equal(r.status, 401);
    assert.equal(JSON.stringify(r.body).includes(SECRET), false);
  });

  it("account 2 POST compress of account 1's memory id returns 404 and does not write", async () => {
    const beforeLen = STATE.sessions.get("small-session").messages.length;
    const r = await req(app, "POST", "/api/chat/memory/small-session/compress", { userId: "someone-else" });
    assert.equal(r.status, 404);
    assertNoMemoryData(r.body);
    assert.equal(STATE.sessions.get("small-session").messages.length, beforeLen);
  });

  it("nonexistent memory id compress returns 404", async () => {
    const r = await req(app, "POST", "/api/chat/memory/nope/compress", { userId: "mem-owner" });
    assert.equal(r.status, 404);
    assertNoMemoryData(r.body);
    const denied = await req(app, "POST", "/api/chat/memory/small-session/compress", { userId: "someone-else" });
    assert.deepEqual(r.body, denied.body);
  });

  it("an ownerless session compress returns 404 and does not write", async () => {
    const beforeLen = STATE.sessions.get("legacy-session").messages.length;
    const r = await req(app, "POST", "/api/chat/memory/legacy-session/compress", { userId: "someone-else" });
    assert.equal(r.status, 404);
    assertNoMemoryData(r.body);
    assert.equal(STATE.sessions.get("legacy-session").messages.length, beforeLen);
  });

  it("snapshot-restored session: owner may compress, another account gets 404", async () => {
    const other = await req(app, "POST", "/api/chat/memory/restored-session/compress", { userId: "someone-else" });
    assert.equal(other.status, 404);
    assertNoMemoryData(other.body);
    assert.equal(STATE.sessions.get("restored-session").messages.length, 3);
    const owner = await req(app, "POST", "/api/chat/memory/restored-session/compress", { userId: "mem-owner" });
    assert.equal(owner.status, 200);
    assert.equal(owner.body.ok, false);
    assert.equal(owner.body.error, "below_threshold");
    assert.equal(owner.body.stats.activeMessages, 3);
  });

  it("is an honest no-op below the window threshold", async () => {
    const r = await req(app, "POST", "/api/chat/memory/small-session/compress", { userId: "mem-owner" });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, false);
    assert.equal(r.body.error, "below_threshold");
    assert.equal(r.body.stats.activeMessages, 3);
    assert.equal(STATE.sessions.get("small-session").messages.length, 3, "no-op must not trim the window");
  });

  it("compresses at the threshold: window trims, a memory DTU is minted, stats show the cycle", async () => {
    const r = await req(app, "POST", "/api/chat/memory/big-session/compress", { userId: "mem-owner" });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.messagesCompressed, 20);
    assert.ok(r.body.dtusCreated >= 1, "at least one conversation_memory DTU created");
    assert.equal(STATE.sessions.get("big-session").messages.length, 35);
    assert.equal(r.body.stats.compressionCycles, 1);
    assert.ok(r.body.stats.memoryDtuCount >= 1);
    assert.equal(r.body.stats.totalMessagesProcessed, 55);

    const after = await req(app, "GET", "/api/chat/memory/big-session", { userId: "mem-owner" });
    assert.equal(after.body.activeMessages, 35);
    assert.equal(after.body.compressionCycles, 1);
    const other = await req(app, "GET", "/api/chat/memory/big-session", { userId: "someone-else" });
    assert.equal(other.status, 200);
    assertZeroedStats(other.body);
    assert.notEqual(other.body.activeMessages, 35);
  });
});
