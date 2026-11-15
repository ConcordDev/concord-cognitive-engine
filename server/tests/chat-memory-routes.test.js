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
 *   - anonymous → 401 on both routes (requireAuth)
 *   - another user's session → 403 session_forbidden on both routes
 *   - the owner reads real stats (counts + topics, no message bodies)
 *   - a session the server has never seen reads as zeroed stats at 200
 *     (never a 404 during a normal load), and compress answers
 *     session_not_found at 200 without claiming anything happened
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

function seedSession(STATE, id, ownerId, messageCount) {
  const messages = [];
  for (let i = 0; i < messageCount; i++) {
    messages.push({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `message ${i} about lattice routing and memory`,
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

async function req(app, method, path, opts = {}) {
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const headers = { ...(opts.userId ? { "x-test-user-id": opts.userId } : {}) };
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
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
    STATE.dtus.set("dtu-mem-1", {
      id: "dtu-mem-1",
      machine: { kind: "conversation_memory", sessionId: "mem-session", topics: ["lattice", "memory"] },
    });
    STATE.dtus.set("dtu-mega-1", {
      id: "dtu-mega-1",
      machine: { kind: "conversation_memory_mega", sessionIds: ["mem-session"] },
    });
    app = makeApp(STATE);
  });

  it("rejects anonymous callers with 401", async () => {
    const r = await req(app, "GET", "/api/chat/memory/mem-session");
    assert.equal(r.status, 401);
    assert.equal(r.body.ok, false);
  });

  it("refuses another user's session with 403 session_forbidden", async () => {
    const r = await req(app, "GET", "/api/chat/memory/mem-session", { userId: "someone-else" });
    assert.equal(r.status, 403);
    assert.deepEqual(r.body, { ok: false, error: "session_forbidden" });
  });

  it("returns the owner's real stats — counts and topics, no bodies", async () => {
    const r = await req(app, "GET", "/api/chat/memory/mem-session", { userId: "mem-owner" });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.activeMessages, 3);
    assert.equal(r.body.totalMessagesProcessed, 3);
    assert.equal(r.body.compressionCycles, 0);
    assert.equal(r.body.memoryDtuCount, 1);
    assert.equal(r.body.megaCount, 1);
    assert.deepEqual([...r.body.topics].sort(), ["lattice", "memory"]);
    assert.equal(r.body.windowUtilization, "3/30");
    assert.ok(!JSON.stringify(r.body).includes("message 0 about"), "stats must not leak message bodies");
  });

  it("reads a legacy ownerless session (pre-ownership permissive rule)", async () => {
    const r = await req(app, "GET", "/api/chat/memory/legacy-session", { userId: "anyone" });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.activeMessages, 2);
  });

  it("answers a never-seen session with zeroed stats at 200 — never a 404", async () => {
    const r = await req(app, "GET", "/api/chat/memory/brand-new-session", { userId: "mem-owner" });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, {
      ok: true,
      activeMessages: 0,
      totalMessagesProcessed: 0,
      compressionCycles: 0,
      memoryDtuCount: 0,
      megaCount: 0,
      topics: [],
      windowUtilization: "0/30",
    });
  });
});

describe("POST /api/chat/memory/:sessionId/compress", () => {
  let STATE, app;
  before(async () => {
    await loadRoutes();
    STATE = { sessions: new Map(), dtus: new Map() };
    seedSession(STATE, "small-session", "mem-owner", 3);
    seedSession(STATE, "big-session", "mem-owner", 55);
    app = makeApp(STATE);
  });

  it("rejects anonymous callers with 401", async () => {
    const r = await req(app, "POST", "/api/chat/memory/small-session/compress");
    assert.equal(r.status, 401);
  });

  it("refuses another user's session with 403 session_forbidden", async () => {
    const r = await req(app, "POST", "/api/chat/memory/small-session/compress", { userId: "someone-else" });
    assert.equal(r.status, 403);
    assert.deepEqual(r.body, { ok: false, error: "session_forbidden" });
  });

  it("answers an unknown session session_not_found at 200, claiming nothing", async () => {
    const r = await req(app, "POST", "/api/chat/memory/nope/compress", { userId: "mem-owner" });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, false);
    assert.equal(r.body.error, "session_not_found");
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
  });
});
