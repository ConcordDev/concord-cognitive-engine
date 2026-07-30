/**
 * Chat session ownership gate — security audit 2026-07-30.
 *
 * `/api/chat` used to sit in server.js's `alwaysPublic` array: a
 * method-agnostic, header-blind bypass that skipped auth entirely for the
 * whole prefix. Confirmed live (real server boot + real HTTP requests) that
 * this let ANY anonymous caller read GET /api/chat/conversations (every
 * user's session titles/summaries/last-message text, no ownership filter at
 * all) and GET /api/chat/summary/:sessionId / GET /api/chat/context for any
 * supplied sessionId — while SIMULTANEOUSLY breaking every requireAuth()
 * route on the same prefix for legitimate users, because requests never
 * reached authMiddleware's JWT/cookie decode at all.
 *
 * Fix: removed "/api/chat" from alwaysPublic (server.js), replaced with
 * precise !_hasAuthHeader-gated bypasses for only the two genuinely
 * anonymous entry points (POST /api/chat, POST /api/chat/stream), and added
 * assertSessionAccessible() ownership checks to the three vulnerable GET
 * routes here.
 *
 * This test hermetically mounts the real registerChatRoutes with a stub
 * dependency graph (no server.js boot) and pins the three routes'
 * ownership-gating behavior directly. The `alwaysPublic` middleware removal
 * itself is covered by the full server.js test suite continuing to pass
 * (three-gate-consistency.test.js et al.) plus manual live verification
 * (7 scenarios: anonymous 401, cross-user 403, owner 200 — see commit
 * message for the full transcript).
 *
 * Run: node --test tests/chat-session-ownership-gate.test.js
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import registerChatRoutes from "../routes/chat.js";

function makeApp(STATE) {
  const app = express();
  app.use(express.json());
  // Test-only auth shim: a request may set x-test-user-id to simulate an
  // already-authenticated caller (mirrors what authMiddleware would have
  // done after decoding a real JWT/cookie) — omitting it simulates a fully
  // anonymous request, exactly like the confirmed-live exploit.
  app.use((req, _res, next) => {
    const uid = req.get("x-test-user-id");
    if (uid) req.user = { id: uid };
    next();
  });

  registerChatRoutes(app, {
    STATE,
    makeCtx: (req) => ({ actor: { userId: req.user?.id || null } }),
    runMacro: async (domain, name) => {
      if (domain === "chat" && name === "context") return { ok: true, domain, name };
      if (domain === "chat" && name === "summary") return { ok: true, domain, name, summary: null };
      return { ok: true };
    },
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

function seedSession(STATE, id, ownerId, msg) {
  STATE.sessions.set(id, {
    ownerId,
    participantIds: ownerId ? new Set([ownerId]) : new Set(),
    createdAt: new Date().toISOString(),
    messages: [
      { role: "user", content: msg, ts: new Date().toISOString() },
      { role: "assistant", content: `reply to: ${msg}`, ts: new Date().toISOString() },
    ],
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

describe("GET /api/chat/conversations — ownership scoping", () => {
  let STATE, app;
  before(() => {
    STATE = { sessions: new Map() };
    seedSession(STATE, "victim-session", "victim_id", "my secret");
    seedSession(STATE, "attacker-own-session", "attacker_id", "unrelated");
    app = makeApp(STATE);
  });

  it("401s a fully anonymous caller (no credentials at all)", async () => {
    const { status } = await req(app, "GET", "/api/chat/conversations");
    assert.equal(status, 401);
  });

  it("a real user only sees their own session, never another user's", async () => {
    const { status, body } = await req(app, "GET", "/api/chat/conversations", { userId: "attacker_id" });
    assert.equal(status, 200);
    const ids = body.conversations.map((c) => c.id);
    assert.ok(ids.includes("attacker-own-session"), "own session must be visible");
    assert.ok(!ids.includes("victim-session"), "another user's session must NOT be visible");
  });

  it("the real owner sees their own session with real content", async () => {
    const { status, body } = await req(app, "GET", "/api/chat/conversations", { userId: "victim_id" });
    assert.equal(status, 200);
    const ids = body.conversations.map((c) => c.id);
    assert.ok(ids.includes("victim-session"));
  });
});

describe("GET /api/chat/summary/:sessionId — ownership gate", () => {
  let STATE, app;
  before(() => {
    STATE = { sessions: new Map() };
    seedSession(STATE, "sess-a", "owner_a", "owner a's message");
    app = makeApp(STATE);
  });

  it("rejects a different authenticated user with 403 session_forbidden", async () => {
    const { status, body } = await req(app, "GET", "/api/chat/summary/sess-a", { userId: "someone_else" });
    assert.equal(status, 403);
    assert.equal(body.error, "session_forbidden");
  });

  it("allows the real owner through to the handler", async () => {
    const { status, body } = await req(app, "GET", "/api/chat/summary/sess-a", { userId: "owner_a" });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
  });

  it("a nonexistent sessionId is not blocked by the ownership gate (no session to own)", async () => {
    const { status } = await req(app, "GET", "/api/chat/summary/does-not-exist", { userId: "owner_a" });
    assert.equal(status, 200);
  });
});

describe("GET /api/chat/context — ownership gate", () => {
  let STATE, app;
  before(() => {
    STATE = { sessions: new Map() };
    seedSession(STATE, "sess-b", "owner_b", "owner b's message");
    app = makeApp(STATE);
  });

  it("rejects a different authenticated user with 403 session_forbidden", async () => {
    const { status, body } = await req(app, "GET", "/api/chat/context?sessionId=sess-b", { userId: "not_owner_b" });
    assert.equal(status, 403);
    assert.equal(body.error, "session_forbidden");
  });

  it("allows the real owner through to the handler", async () => {
    const { status, body } = await req(app, "GET", "/api/chat/context?sessionId=sess-b", { userId: "owner_b" });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
  });
});
