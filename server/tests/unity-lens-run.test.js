// Unity / Godot `lens:run` gateway verb — Phase 1 of
// docs/CONCORDIA_UNITY_WIRING_PLAN.md.
//
// The load-bearing claim: this verb is NOT a parallel permission path.
// It forwards to deps.runMacro with an HTTP-shaped ctx (POST /api/lens/run,
// authenticated actor) so Gate 2 (publicReadDomains) and Gate 3 (Chicken2)
// inside runMacro fire identically. The gateway never reimplements those
// gates. A missing actor would make runMacro default to system/internal —
// this file pins that that default is unreachable from this verb.
//
//   cd server && node --test tests/unity-lens-run.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import http from "node:http";
import { WebSocket } from "ws";
import { mountUnityGateway } from "../lib/unity-bridge.js";

const GATEWAY_SRC = readFileSync(join(import.meta.dirname, "..", "lib", "godot-gateway.js"), "utf8");
const SERVER_SRC = readFileSync(join(import.meta.dirname, "..", "server.js"), "utf8");

function startGateway(depOverrides = {}) {
  const server = http.createServer();
  const calls = [];
  const gateway = mountUnityGateway(server, {
    verifyToken: (token) => (token === "good-token" ? { userId: "u1" } : null),
    getUser: (userId) => (userId === "u1" ? { id: "u1", username: "tester" } : null),
    exportScene: () => ({ ok: true, worldId: "concordia-hub", nodes: [] }),
    exportKingdom: () => ({ ok: true, title: "Hub", staple: "lanterns", settlements: [] }),
    db: {},
    runMacro: async (domain, name, input, ctx) => {
      calls.push({ domain, name, input, ctx });
      return { ok: true, domain, name, input, echoedUser: ctx?.actor?.userId };
    },
    ...depOverrides,
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({
        url: `ws://127.0.0.1:${port}/unity-ws`,
        calls,
        async stop() {
          try { gateway.close(); } catch { /* */ }
          await new Promise((r) => server.close(r));
        },
      });
    });
  });
}

function connect(url) {
  const ws = new WebSocket(url);
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function nextFrame(ws, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error("nextFrame timeout")); }, timeoutMs);
    function onMsg(raw) { cleanup(); try { resolve(JSON.parse(raw.toString())); } catch (e) { reject(e); } }
    function cleanup() { clearTimeout(timer); ws.off("message", onMsg); }
    ws.on("message", onMsg);
  });
}

function sendMsg(ws, evt, data) { ws.send(JSON.stringify({ evt, data })); }

async function authAs(url) {
  const ws = await connect(url);
  sendMsg(ws, "auth", { token: "good-token" });
  const hello = await nextFrame(ws);
  assert.equal(hello.evt, "hello");
  return ws;
}

describe("lens:run gateway verb — same three gates as HTTP", () => {
  it("unauthenticated lens:run is rejected by existing auth (Gate 1)", async () => {
    const h = await startGateway();
    try {
      const ws = await connect(h.url);
      sendMsg(ws, "lens:run", { domain: "lore", name: "list", input: {} });
      const frame = await nextFrame(ws);
      assert.equal(frame.evt, "error");
      assert.equal(frame.data.reason, "auth_required");
      assert.equal(h.calls.length, 0, "runMacro must not run before auth");
      ws.close();
    } finally { await h.stop(); }
  });

  it("forwards to runMacro with HTTP-shaped ctx (path POST /api/lens/run, authenticated actor)", async () => {
    const h = await startGateway();
    try {
      const ws = await authAs(h.url);
      sendMsg(ws, "lens:run", { domain: "lore", name: "list", input: { q: "hub" } });
      const frame = await nextFrame(ws);
      assert.equal(frame.evt, "lens:result");
      assert.equal(frame.data.ok, true);
      assert.equal(h.calls.length, 1);
      const call = h.calls[0];
      assert.equal(call.domain, "lore");
      assert.equal(call.name, "list");
      assert.deepEqual(call.input, { q: "hub" });
      assert.equal(call.ctx.reqMeta.path, "/api/lens/run");
      assert.equal(call.ctx.reqMeta.method, "POST");
      assert.equal(call.ctx.actor.userId, "u1");
      assert.equal(call.ctx.userId, "u1");
      assert.notEqual(call.ctx.actor.role, "system");
      assert.notEqual(call.ctx.actor.internal, true);
      assert.ok(!call.ctx.actor.scopes?.includes("*"), "must not mint a root actor");
      ws.close();
    } finally { await h.stop(); }
  });

  it("accepts HTTP's action alias for name", async () => {
    const h = await startGateway();
    try {
      const ws = await authAs(h.url);
      sendMsg(ws, "lens:run", { domain: "lore", action: "facets", input: {} });
      const frame = await nextFrame(ws);
      assert.equal(frame.evt, "lens:result");
      assert.equal(h.calls[0].name, "facets");
      ws.close();
    } finally { await h.stop(); }
  });

  it("missing domain/name is an honest failure, not a runMacro call", async () => {
    const h = await startGateway();
    try {
      const ws = await authAs(h.url);
      sendMsg(ws, "lens:run", { input: { anything: true } });
      const frame = await nextFrame(ws);
      assert.equal(frame.evt, "lens:result");
      assert.equal(frame.data.ok, false);
      assert.equal(frame.data.reason, "domain_and_name_required");
      assert.equal(h.calls.length, 0);
      ws.close();
    } finally { await h.stop(); }
  });

  it("forwards an injected {ok:false} verbatim — never rewrites to success", async () => {
    const h = await startGateway({
      runMacro: async () => ({ ok: false, reason: "forbidden", error: "forbidden: sovereign.tick" }),
    });
    try {
      const ws = await authAs(h.url);
      sendMsg(ws, "lens:run", { domain: "sovereign", name: "tick", input: {} });
      const frame = await nextFrame(ws);
      assert.equal(frame.evt, "lens:result");
      assert.equal(frame.data.ok, false);
      assert.equal(frame.data.reason, "forbidden");
      ws.close();
    } finally { await h.stop(); }
  });

  it("a thrown forbidden from runMacro becomes honest {ok:false}, not a fabricated success", async () => {
    const h = await startGateway({
      runMacro: async () => { throw new Error("forbidden: council.convene"); },
    });
    try {
      const ws = await authAs(h.url);
      sendMsg(ws, "lens:run", { domain: "council", name: "convene", input: {} });
      const frame = await nextFrame(ws);
      assert.equal(frame.evt, "lens:result");
      assert.equal(frame.data.ok, false);
      assert.equal(frame.data.reason, "forbidden");
      ws.close();
    } finally { await h.stop(); }
  });

  it("missing runMacro dep → honest lens_run_unavailable", async () => {
    const h = await startGateway({ runMacro: null });
    try {
      const ws = await authAs(h.url);
      sendMsg(ws, "lens:run", { domain: "lore", name: "list", input: {} });
      const frame = await nextFrame(ws);
      assert.equal(frame.evt, "lens:result");
      assert.equal(frame.data.ok, false);
      assert.equal(frame.data.reason, "lens_run_unavailable");
      ws.close();
    } finally { await h.stop(); }
  });
});

describe("lens:run does not reimplement the three gates", () => {
  it("the gateway lens:run case only forwards to deps.runMacro", () => {
    // Isolate the lens:run case body so a comment elsewhere naming
    // publicReadDomains / inLatticeReality cannot trip this pin.
    const caseBody = GATEWAY_SRC.match(/case\s+"lens:run"\s*:[\s\S]*?case\s+"dialogue:request"/);
    assert.ok(caseBody, "could not locate the lens:run switch case in godot-gateway.js");
    // Strip comments so a documenting note that NAMES Gate 2/3 cannot trip
    // the pin it's describing (same comment-blindness class as
    // gateway-getuser-binding.test.js).
    const body = caseBody[0]
      .split("\n")
      .map((line) => line.replace(/\/\/.*$/, ""))
      .join("\n");
    assert.match(body, /runMacro\(/, "lens:run must call the injected runMacro");
    assert.doesNotMatch(
      body,
      /publicReadDomains/,
      "gateway must not reimplement Gate 2 — publicReadDomains lives inside runMacro",
    );
    assert.doesNotMatch(
      body,
      /inLatticeReality|safeReadBypass|_safeReadPaths/,
      "gateway must not reimplement Gate 3 — Chicken2 lives inside runMacro",
    );
    assert.match(
      body,
      /path:\s*"\/api\/lens\/run"/,
      "ctx.reqMeta.path must be the HTTP route so Chicken2 sees the same surface",
    );
    assert.match(
      body,
      /userId:\s*client\.userId/,
      "actor.userId must be the authenticated WS user, never the system default",
    );
  });

  it("both production mounts inject _runMacroFromGateway (HTTP-identical dispatch)", () => {
    const stripped = SERVER_SRC
      .split("\n")
      .map((line) => line.replace(/\/\/.*$/, ""))
      .join("\n");
    const hits = stripped.match(/runMacro\s*:\s*_runMacroFromGateway/g) || [];
    assert.equal(
      hits.length,
      2,
      `expected both /godot-ws and /unity-ws mounts to inject runMacro: _runMacroFromGateway, found ${hits.length}`,
    );
    assert.match(
      stripped,
      /async function _runMacroFromGateway/,
      "_runMacroFromGateway must exist — it is the HTTP-identical wrapper (makeCtx + H1 + LENS_ACTIONS-then-runMacro)",
    );
    // The wrapper itself must go through the shared HTTP lookup, not a
    // parallel dispatcher, and must pin reqMeta to the HTTP path.
    const wrapper = SERVER_SRC.match(/async function _runMacroFromGateway[\s\S]*?^function /m);
    assert.ok(wrapper, "could not isolate _runMacroFromGateway");
    assert.match(wrapper[0], /_dispatchDesignCommand\(/);
    assert.match(wrapper[0], /_lensActionForbiddenForAnon\(/);
    assert.match(wrapper[0], /path:\s*"\/api\/lens\/run"/);
    assert.doesNotMatch(wrapper[0], /role:\s*"system"/);
  });
});
