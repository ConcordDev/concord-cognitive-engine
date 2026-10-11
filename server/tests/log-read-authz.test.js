/**
 * Cross-user log / telemetry / debug read authz.
 *
 * Live finding (2026-10-10): GET /api/logs from a member account returned
 * other sessions' chat logs (session ids, DTU ids, reply text). The same
 * ring was also reachable from /api/events, /api/events/log?type=chat,
 * /api/traces, and the inference debug console.
 *
 * Anonymous → 401. A member sees only their own rows (or 403 when the
 * route is an operator dump). Admin/owner/founder/sovereign see all.
 * Secret-shaped values never appear in a payload.
 *
 * Run: node --test tests/log-read-authz.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import registerDomainRoutes from "../routes/domain.js";
import { createInferenceDebugRouter } from "../routes/inference-debug.js";
import { getConsoleStats, _resetForTests, recordConsolePing } from "../lib/console-stats.js";
import {
  redactLogValue,
  projectLogs,
  actorFromCtx,
  denyUnlessAuthenticated,
  denyUnlessAdmin,
  sessionOwnerLookup,
  buildChatConversations,
  finalizeActivityFeed,
  projectTraces,
  resolveTrace,
  projectBridgeLog,
  selectScopedUserId,
  summarizePerfSamples,
  recordOwnedByCaller,
  filterInferenceTraces,
  projectReasoningTraces,
  reasoningTraceAccess,
  resolveAnonMessageRead,
  combatLogAccess,
} from "../lib/log-access.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_JS = readFileSync(join(__dirname, "../server.js"), "utf8");
const DOMAIN_JS = readFileSync(join(__dirname, "../routes/domain.js"), "utf8");

const JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEifQ.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";

function chatLog(userId, sessionId, reply) {
  return {
    id: `log_${sessionId}`,
    ts: "2026-10-10T00:00:00.000Z",
    type: "chat",
    message: "Chat response generated",
    userId,
    meta: { sessionId, reply, relevant: [`dtu_${sessionId}`], mode: "chat" },
  };
}

function seedState() {
  const sessions = new Map();
  sessions.set("sess-a", {
    ownerId: "user-a",
    participantIds: new Set(["user-a"]),
    createdAt: "2026-10-10T00:00:00.000Z",
    messages: [
      { role: "user", content: "where is my private note", ts: "2026-10-10T00:00:01.000Z" },
      { role: "assistant", content: `reply for A ${JWT}`, ts: "2026-10-10T00:00:02.000Z" },
    ],
  });
  sessions.set("sess-b", {
    ownerId: "user-b",
    participantIds: new Set(["user-b"]),
    createdAt: "2026-10-10T00:00:00.000Z",
    messages: [
      { role: "user", content: "other user secret plan", ts: "2026-10-10T00:00:03.000Z" },
      { role: "assistant", content: "reply for B only", ts: "2026-10-10T00:00:04.000Z" },
    ],
  });
  sessions.set("sess-legacy", {
    createdAt: "2026-10-09T00:00:00.000Z",
    messages: [{ role: "user", content: "unowned legacy chat", ts: "2026-10-09T00:00:01.000Z" }],
  });
  const logs = [
    chatLog("user-a", "sess-a", `hello from A Bearer ${JWT}`),
    chatLog("user-b", "sess-b", "hello from B"),
    { id: "log-hist", ts: "2026-10-10T00:00:05.000Z", type: "chat", message: "historical", meta: { sessionId: "sess-a", reply: "stamped only by session" } },
    { id: "log-sys", ts: "2026-10-10T00:00:06.000Z", type: "seed", message: "boot", meta: { apiKey: "sk-ant-thisisnotarealkey123456", note: "ok" } },
  ];
  return { sessions, logs };
}

function memberCtx(userId, role, state) {
  return { actor: { userId, role }, state };
}

async function req(app, path, user) {
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const headers = {};
    if (user) {
      headers["x-test-user-id"] = user.id;
      headers["x-test-role"] = user.role || "member";
    }
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function mountDomain(state) {
  const app = express();
  app.use((req, _res, next) => {
    const id = req.get("x-test-user-id");
    if (id) req.user = { id, role: req.get("x-test-role") || "member" };
    next();
  });
  registerDomainRoutes(app, {
    STATE: state,
    makeCtx: (req) => ({
      actor: req.user
        ? { userId: req.user.id, id: req.user.id, role: req.user.role || "member" }
        : { userId: "anon", role: "viewer" },
      state,
    }),
    runMacro: async (domain, name, input, ctx) => {
      const actor = actorFromCtx(ctx);
      const owner = sessionOwnerLookup(state.sessions);
      if (domain === "log" && name === "list") {
        const denied = denyUnlessAuthenticated(actor);
        if (denied) return denied;
        return { ok: true, logs: projectLogs(state.logs, actor, { limit: input?.limit || 200, sessionOwner: owner }) };
      }
      if (domain === "audit" && name === "query") {
        const denied = denyUnlessAdmin(actor);
        if (denied) return denied;
        return { ok: true, logs: projectLogs(state.logs, actor, { limit: 2000, sessionOwner: owner }) };
      }
      if (domain === "admin" && name === "logs") {
        const denied = denyUnlessAdmin(actor);
        if (denied) return denied;
        return { ok: true, logs: projectLogs(state.logs, actor, { limit: 200, sessionOwner: owner }) };
      }
      return { ok: true };
    },
    _withAck: (x) => x,
    kernelTick: () => {},
    listDomains: () => [],
    listMacros: () => [],
    _dtusArray: () => [],
    _normalizeText: (s) => s,
    clamp: (n) => n,
    _nowISO: () => new Date().toISOString(),
    saveStateDebounced: () => {},
    retrieveDTUs: () => ({ top: [] }),
    _isShadowDTU: () => false,
    fs: {},
    ensureExperienceLearning: () => {},
    ensureAttentionManager: () => {},
    ensureReflectionEngine: () => {},
    validate: () => (_req, _res, next) => next(),
    requireOwner: (_req, _res, next) => next(),
  });
  return app;
}

function idsOf(logs) {
  return (logs || []).map((l) => l.id);
}

describe("log payload redaction", () => {
  it("strips tokens and secret keys and keeps session ids and ordinary chat text", () => {
    const out = redactLogValue({
      sessionId: "sess-a",
      reply: `see you tomorrow Bearer ${JWT}`,
      apiKey: "sk-live-abcdefghijklmnopqrst",
      access_token: "not-shown",
      founderSecret: "shh",
      note: "the session is fine",
    });
    assert.equal(out.sessionId, "sess-a");
    assert.equal(out.note, "the session is fine");
    assert.equal(out.apiKey, "[redacted]");
    assert.equal(out.access_token, "[redacted]");
    assert.equal(out.founderSecret, "[redacted]");
    assert.ok(!out.reply.includes(JWT), out.reply);
    assert.ok(out.reply.includes("see you tomorrow"), out.reply);
    assert.ok(!JSON.stringify(out).includes("sk-live"), JSON.stringify(out));
  });
});

describe("projectLogs — caller scope", () => {
  const state = seedState();
  const owner = sessionOwnerLookup(state.sessions);

  it("a member sees their stamped rows and historical rows for their session only", () => {
    const logs = projectLogs(state.logs, { userId: "user-a", role: "member" }, { sessionOwner: owner });
    assert.deepEqual(idsOf(logs).sort(), ["log-hist", "log_sess-a"]);
    const own = logs.find((l) => l.id === "log_sess-a");
    assert.equal(own.meta.sessionId, "sess-a");
    assert.ok(own.meta.relevant.includes("dtu_sess-a"));
    assert.ok(!own.meta.reply.includes(JWT));
    assert.ok(!idsOf(logs).includes("log_sess-b"));
    assert.ok(!idsOf(logs).includes("log-sys"));
  });

  it("admin sees every row, still without secrets", () => {
    const logs = projectLogs(state.logs, { userId: "admin-1", role: "admin" }, { sessionOwner: owner });
    assert.deepEqual(idsOf(logs).sort(), ["log-hist", "log-sys", "log_sess-a", "log_sess-b"]);
    const sys = logs.find((l) => l.id === "log-sys");
    assert.equal(sys.meta.apiKey, "[redacted]");
    assert.equal(sys.meta.note, "ok");
  });

  it("owner, founder, and sovereign see every row", () => {
    for (const role of ["owner", "founder", "sovereign"]) {
      const logs = projectLogs(state.logs, { userId: "u", role }, { sessionOwner: owner });
      assert.equal(logs.length, state.logs.length, role);
    }
  });

  it("an anonymous actor sees nothing", () => {
    const denied = denyUnlessAuthenticated(actorFromCtx({ actor: { userId: "anon", role: "member" } }));
    assert.equal(denied.error, "authentication_required");
    assert.deepEqual(projectLogs(state.logs, { userId: null, role: null }, { sessionOwner: owner }), []);
  });
});

describe("GET /api/logs, /api/audit, /api/admin/logs", () => {
  const state = seedState();
  const app = mountDomain(state);

  it("anonymous GET /api/logs is 401", async () => {
    const { status, body } = await req(app, "/api/logs");
    assert.equal(status, 401);
    assert.equal(body.error, "authentication_required");
  });

  it("a member GET /api/logs returns only their chat rows", async () => {
    const { status, body } = await req(app, "/api/logs", { id: "user-a", role: "member" });
    assert.equal(status, 200);
    assert.deepEqual(idsOf(body.logs).sort(), ["log-hist", "log_sess-a"]);
    assert.ok(!JSON.stringify(body).includes("hello from B"));
    assert.ok(!JSON.stringify(body).includes("other user secret plan"));
    assert.ok(!JSON.stringify(body).includes(JWT));
  });

  it("admin GET /api/logs returns every row", async () => {
    const { status, body } = await req(app, "/api/logs", { id: "admin-1", role: "admin" });
    assert.equal(status, 200);
    assert.equal(body.logs.length, state.logs.length);
  });

  it("anonymous GET /api/audit is 401 and a member is 403", async () => {
    const anon = await req(app, "/api/audit");
    assert.equal(anon.status, 401);
    const member = await req(app, "/api/audit", { id: "user-a", role: "member" });
    assert.equal(member.status, 403);
    assert.equal(member.body.error, "forbidden");
  });

  it("admin GET /api/audit sees the ring", async () => {
    const { status, body } = await req(app, "/api/audit", { id: "admin-1", role: "owner" });
    assert.equal(status, 200);
    assert.equal(body.logs.length, state.logs.length);
  });

  it("anonymous GET /api/admin/logs is 401 and a member is 403", async () => {
    const anon = await req(app, "/api/admin/logs");
    assert.equal(anon.status, 401);
    const member = await req(app, "/api/admin/logs", { id: "user-a", role: "member" });
    assert.equal(member.status, 403);
  });

  it("admin GET /api/admin/logs sees every row", async () => {
    const { status, body } = await req(app, "/api/admin/logs", { id: "admin-1", role: "admin" });
    assert.equal(status, 200);
    assert.equal(body.logs.length, state.logs.length);
  });
});

describe("sibling chat, trace, bridge, and telemetry reads", () => {
  const state = seedState();

  it("type=chat conversations are limited to sessions the member owns", () => {
    const member = buildChatConversations(state.sessions, { userId: "user-a", role: "member" }, 20);
    assert.deepEqual(member.map((c) => c.id), ["sess-a"]);
    assert.ok(member[0].lastMessage.includes("reply for A"));
    assert.ok(!member[0].lastMessage.includes(JWT));
    assert.ok(!JSON.stringify(member).includes("other user secret plan"));
    assert.ok(!JSON.stringify(member).includes("unowned legacy chat"));

    const admin = buildChatConversations(state.sessions, { userId: "admin-1", role: "admin" }, 20);
    assert.deepEqual(admin.map((c) => c.id).sort(), ["sess-a", "sess-b", "sess-legacy"]);
  });

  it("a participant can see a shared session and a stranger cannot", () => {
    const sessions = new Map(state.sessions);
    sessions.set("sess-shared", {
      ownerId: "user-b",
      participantIds: new Set(["user-b", "user-a"]),
      messages: [{ role: "user", content: "shared thread", ts: "2026-10-10T01:00:00.000Z" }],
    });
    const member = buildChatConversations(sessions, { userId: "user-a", role: "member" }, 20);
    assert.ok(member.some((c) => c.id === "sess-shared"));
    const stranger = buildChatConversations(sessions, { userId: "user-c", role: "member" }, 20);
    assert.ok(!stranger.some((c) => c.id === "sess-shared"));
  });

  it("activity feed rows without the caller in _parties stay hidden", () => {
    const activities = [
      { id: "mine", timestamp: "2026-10-10T00:00:02.000Z", message: "mine", _parties: ["user-a"] },
      { id: "theirs", timestamp: "2026-10-10T00:00:03.000Z", message: "secret ledger", meta: { token: JWT }, _parties: ["user-b"] },
    ];
    const member = finalizeActivityFeed(activities, { userId: "user-a", role: "member" });
    assert.deepEqual(member.events.map((e) => e.id), ["mine"]);
    assert.equal(member.events[0]._parties, undefined);
    const admin = finalizeActivityFeed(activities, { userId: "admin-1", role: "admin" });
    assert.equal(admin.events.length, 2);
    const leaked = admin.events.find((e) => e.id === "theirs");
    assert.equal(leaked.meta.token, "[redacted]");
  });

  it("traces: a member sees only their userId, and another id is 403", () => {
    const traces = [
      { traceId: "t-a", userId: "user-a", trigger: { prompt: `hi ${JWT}` }, totalDuration: 10 },
      { traceId: "t-b", userId: "user-b", trigger: { prompt: "other" }, totalDuration: 20 },
      { traceId: "t-sys", userId: "system", trigger: { prompt: "boot" }, totalDuration: 5 },
    ];
    const member = projectTraces(traces, { userId: "user-a", role: "member" });
    assert.deepEqual(member.map((t) => t.traceId), ["t-a"]);
    assert.ok(!member[0].trigger.prompt.includes(JWT));
    const admin = projectTraces(traces, { userId: "admin-1", role: "admin" });
    assert.equal(admin.length, 3);
    const foreign = resolveTrace(traces, "t-b", { userId: "user-a", role: "member" });
    assert.equal(foreign.status, 403);
    const missing = resolveTrace(traces, "nope", { userId: "user-a", role: "member" });
    assert.equal(missing.status, 404);
    const own = resolveTrace(traces, "t-a", { userId: "user-a", role: "member" });
    assert.equal(own.status, 200);
  });

  it("bridge log is admin-only", () => {
    const entries = [{ id: "b1", action: "emergent.query", query: `find ${JWT}`, at: "t" }];
    const member = projectBridgeLog(entries, { userId: "user-a", role: "member" });
    assert.equal(member.ok, false);
    assert.equal(member.error, "forbidden");
    const anon = projectBridgeLog(entries, { userId: null, role: null });
    assert.equal(anon.error, "authentication_required");
    const admin = projectBridgeLog(entries, { userId: "admin-1", role: "owner" });
    assert.equal(admin.ok, true);
    assert.equal(admin.log.length, 1);
    assert.ok(!admin.log[0].query.includes(JWT));
  });

  it("perf telemetry hides other clients' recent samples from a member", () => {
    const samples = [{ avgFps: 60, avgFrameTime: 16, breaches: 0, samples: 10, ua: "Mozilla secret", t: 1 }];
    const member = summarizePerfSamples(samples, { userId: "user-a", role: "member" });
    assert.equal(member.ok, true);
    assert.equal(member.recent, undefined);
    assert.equal(member.p50Fps, 60);
    const admin = summarizePerfSamples(samples, { userId: "admin-1", role: "admin" });
    assert.equal(admin.recent.length, 1);
  });

  it("a member cannot read another user's rate-limit or cost bucket by query", () => {
    assert.equal(selectScopedUserId({ userId: "user-a", role: "member" }, "user-b"), "user-a");
    assert.equal(selectScopedUserId({ userId: "user-a", role: "member" }, { userId: "user-b" }), "user-a");
    assert.equal(selectScopedUserId({ userId: "admin-1", role: "admin" }, "user-b"), "user-b");
    assert.equal(selectScopedUserId({ userId: "admin-1", role: "admin" }, { userId: "user-b" }), "user-b");
    assert.equal(selectScopedUserId({ userId: "admin-1", role: "admin" }, undefined), "admin-1");
    assert.equal(selectScopedUserId({ userId: "admin-1", role: "admin" }, {}, null), null);
  });

  it("inference traces and spans follow caller id, not the query string", () => {
    const traces = [
      { inferenceId: "inf-a", spans: [{ data: { callerId: "chat:user-a" }, type: "finish" }] },
      { inferenceId: "inf-b", spans: [{ data: { callerId: "chat:user-b" }, type: "finish" }] },
      { inferenceId: "inf-anon", spans: [{ data: {}, type: "finish" }] },
    ];
    const member = filterInferenceTraces(traces, { userId: "user-a", role: "member" });
    assert.deepEqual(member.map((t) => t.inferenceId), ["inf-a"]);
    assert.equal(recordOwnedByCaller({ caller_id: "user-b" }, { userId: "user-a", role: "member" }, ["caller_id"]), false);
    assert.equal(recordOwnedByCaller({ caller_id: "user-b" }, { userId: "admin-1", role: "admin" }, ["caller_id"]), true);
  });

  it("console-stats stays an aggregate with no user, session, or token fields", () => {
    _resetForTests();
    recordConsolePing({ userAgent: "Mozilla/5.0 (PlayStation)", gamepadId: "" });
    const stats = getConsoleStats();
    const blob = JSON.stringify(stats);
    assert.ok(stats.totalActive24h >= 1);
    assert.equal(stats.userId, undefined);
    assert.equal(stats.sessionId, undefined);
    assert.ok(!/token|secret|authorization|sessionId|userId/i.test(blob), blob);
  });
});

describe("inference debug router", () => {
  it("anonymous trace list is 401, a member does not see another caller, SQL is 403", async () => {
    const spans = [];
    const db = {
      prepare() {
        return { all: () => [{ caller_id: "user-b", error: `boom ${JWT}`, model_used: "x", tokens_in: 1, tokens_out: 1, lens_id: null }] };
      },
    };
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const id = req.get("x-test-user-id");
      if (id) req.user = { id, role: req.get("x-test-role") || "member" };
      next();
    });
    // getSpans reads the process tracer, which is empty here. The SQL
    // and auth gates are what this mount is pinning.
    app.use("/api/inference", createInferenceDebugRouter({ db }));
    void spans;

    const anon = await req(app, "/api/inference/traces");
    assert.equal(anon.status, 401);
    assert.equal(anon.body.error, "authentication_required");

    const memberSql = await fetchJson(app, "/api/inference/spans/query", { id: "user-a", role: "member" }, { method: "POST", body: JSON.stringify({ sql: "SELECT * FROM inference_spans" }) });
    assert.equal(memberSql.status, 403);

    const adminSql = await fetchJson(app, "/api/inference/spans/query", { id: "admin-1", role: "admin" }, { method: "POST", body: JSON.stringify({ sql: "SELECT inference_id FROM inference_spans" }) });
    assert.equal(adminSql.status, 200);
    assert.ok(!JSON.stringify(adminSql.body).includes(JWT));

    const memberSpans = await req(app, "/api/inference/spans", { id: "user-a", role: "member" });
    assert.equal(memberSpans.status, 200);
    assert.deepEqual(memberSpans.body.spans, []);
  });
});

async function fetchJson(app, path, user, opts = {}) {
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const headers = { "content-type": "application/json" };
    if (user) {
      headers["x-test-user-id"] = user.id;
      headers["x-test-role"] = user.role || "member";
    }
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { ...opts, headers });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe("operator logs, anon chat, reasoning traces, combat log", () => {
  const member = { userId: "user-a", role: "member" };
  const admin = { userId: "admin-1", role: "admin" };

  it("reasoning traces stay with the caller who asked the question", () => {
    const traces = [
      { traceId: "t1", userId: "user-a", question: "mine", token: "sk-live-secret" },
      { traceId: "t2", userId: "user-b", question: "theirs" },
      { traceId: "t3", question: "unstamped system" },
    ];
    const own = projectReasoningTraces(traces, member);
    assert.deepEqual(own.map((t) => t.traceId), ["t1"]);
    assert.equal(own[0].token, "[redacted]");
    assert.equal(projectReasoningTraces(traces, admin).length, 3);
    assert.equal(reasoningTraceAccess({ input: { userId: "user-b", question: "x" } }, member).status, 403);
    assert.equal(reasoningTraceAccess(null, member).status, 404);
    assert.equal(reasoningTraceAccess({ input: { userId: "user-b" } }, admin).status, 200);
    assert.equal(reasoningTraceAccess({ input: { userId: "user-a" } }, null).status, 401);
  });

  it("anon messages follow the cookie, not a query session id", () => {
    const foreign = { ownerId: "user-b", messages: [{ role: "user", content: "secret chat" }] };
    const stolen = resolveAnonMessageRead({
      session: foreign,
      actor: member,
      cookieSessionId: "cookie-a",
      querySessionId: "sess-b",
    });
    assert.equal(stolen.status, 403);
    assert.deepEqual(stolen.messages, []);

    const own = resolveAnonMessageRead({
      session: { ownerId: "user-a", messages: [{ content: "Bearer aaa.bbb.cccc" }] },
      actor: member,
      cookieSessionId: "sess-a",
      querySessionId: null,
    });
    assert.equal(own.status, 200);
    assert.equal(own.messages[0].content, "[redacted]");

    const anonCookie = resolveAnonMessageRead({
      session: { messages: [{ content: "hello" }] },
      actor: { userId: null, role: null },
      cookieSessionId: "cookie-a",
      querySessionId: null,
    });
    assert.equal(anonCookie.status, 200);
    assert.equal(anonCookie.messages[0].content, "hello");

    const noCookie = resolveAnonMessageRead({
      session: { messages: [{ content: "hello" }] },
      actor: { userId: null, role: null },
      cookieSessionId: null,
      querySessionId: "sess-b",
    });
    assert.equal(noCookie.status, 403);
  });

  it("a combat log is visible to a combatant and hidden from a stranger", () => {
    const combatants = [{ entity_id: "user-a", entity_kind: "player" }];
    assert.equal(combatLogAccess(combatants, member).status, 200);
    assert.equal(combatLogAccess(combatants, { userId: "user-b", role: "member" }).status, 403);
    assert.equal(combatLogAccess(combatants, admin).status, 200);
    assert.equal(combatLogAccess(combatants, { userId: null }).status, 401);
  });
});

describe("production handlers call the shared gate", () => {
  function sliceAround(src, needle, len = 900) {
    const at = src.indexOf(needle);
    assert.ok(at !== -1, `missing ${needle}`);
    return src.slice(at, at + len);
  }

  it("GET /api/logs and the log.list macro both refuse an unscoped ring", () => {
    const route = sliceAround(DOMAIN_JS, 'app.get("/api/logs"');
    assert.ok(route.includes("gateLogRead"));
    const macro = sliceAround(SERVER_JS, 'register("log", "list"');
    assert.ok(macro.includes("denyUnlessAuthenticated"));
    assert.ok(macro.includes("projectLogs"));
  });

  it("chat session dump, traces, bridge log, and costs no longer trust a query user id", () => {
    assert.ok(sliceAround(SERVER_JS, 'app.get("/api/events/log"').includes("buildChatConversations"));
    assert.ok(sliceAround(SERVER_JS, 'app.get("/api/events", (req, res)').includes("gateLogRead"));
    assert.ok(sliceAround(SERVER_JS, 'app.get("/api/traces"').includes("projectTraces"));
    assert.ok(sliceAround(SERVER_JS, 'app.get("/api/bridge/log"').includes("projectBridgeLog"));
    assert.ok(sliceAround(SERVER_JS, 'app.get("/api/costs"').includes("selectScopedUserId"));
    assert.ok(sliceAround(SERVER_JS, 'app.get("/api/rate-limits"').includes("selectScopedUserId"));
    assert.ok(sliceAround(SERVER_JS, 'app.get("/api/world/perf-telemetry"').includes("summarizePerfSamples"));
    assert.ok(SERVER_JS.includes("log: (type, message, meta) => log(type, message, meta, resolvedActor?.userId)"));
  });

  it("the STATE.logs writer redacts before the ring stores a row", () => {
    const writer = sliceAround(SERVER_JS, "function log(type, message, meta={}, actorUserId=null)");
    assert.ok(writer.includes("redactLogValue"));
    assert.ok(writer.includes("entry.userId = actorUserId"));
  });

  it("operator log dumps and sibling session logs call the shared gate", () => {
    assert.ok(sliceAround(SERVER_JS, 'app.get("/api/system/traces"').includes("gateLogAdmin"));
    assert.ok(sliceAround(SERVER_JS, 'app.get("/api/system/operations-log"').includes("gateLogAdmin"));
    assert.ok(sliceAround(SERVER_JS, 'app.get("/api/compliance/log"').includes("gateLogAdmin"));
    assert.ok(sliceAround(SERVER_JS, 'app.get("/api/rbac/audit-export/:orgId"').includes("gateLogAdmin"));
    const tracesRoute = sliceAround(SERVER_JS, 'app.get("/api/reasoning/traces"', 2800);
    assert.ok(tracesRoute.includes("perEndpointRateLimit(\"read.default\")"));
    assert.ok(tracesRoute.includes("expressRateLimit("));
    assert.ok(tracesRoute.includes("projectReasoningTraces"));
    assert.ok(sliceAround(SERVER_JS, 'app.get("/api/reasoning/trace/:traceId"').includes("reasoningTraceAccess"));
    assert.ok(sliceAround(SERVER_JS, 'app.get("/api/anon/messages"').includes("resolveAnonMessageRead"));
    assert.ok(sliceAround(SERVER_JS, 'app.get("/api/party-combat/:sessionId/log"').includes("combatLogAccess"));
  });
});
