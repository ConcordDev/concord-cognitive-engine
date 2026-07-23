// server/tests/godot-gateway.test.js
//
// Standalone contract tests for the Godot gateway. Uses a bare http.createServer()
// on port 0, stub injected deps, and the `ws` client from the same transitive
// package. No repo boot, no no-egress preload required — this module is fully
// self-contained.
//
//   cd server && node --test tests/godot-gateway.test.js
//
import { test } from "node:test";
import assert from "node:assert";
import http from "node:http";
import { WebSocket } from "ws";
import { mountGodotGateway } from "../lib/godot-gateway.js";

// ── Stub deps ────────────────────────────────────────────────────────────────
const STUB_SCENE = {
  ok: true,
  format: "concord-scene/v1",
  worldId: "hub",
  nodes: [{ id: "b1", type: "house", transform: { translation: [1, 0, 2], rotationY: 0, scale: [3, 4, 5] } }],
  bounds: { min: [-1, 0, -1], max: [1, 4, 3] },
  count: 1,
};

function makeDeps(overrides = {}) {
  return {
    verifyToken: (token) => (token === "good-token" ? { userId: "u1" } : null),
    getUser: (userId) => (userId === "u1" ? { id: "u1", username: "tester" } : (userId === "u2" ? { id: "u2", username: "other" } : null)),
    exportScene: () => STUB_SCENE,
    db: {},
    ...overrides,
  };
}

// ── Harness ──────────────────────────────────────────────────────────────────
async function startGateway(depOverrides = {}) {
  const server = http.createServer();
  const gateway = mountGodotGateway(server, makeDeps(depOverrides));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const url = `ws://127.0.0.1:${port}/godot-ws`;
  return {
    gateway,
    url,
    async stop() {
      try { gateway.close(); } catch { /* */ }
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function connect(url) {
  const ws = new WebSocket(url);
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

// Resolve with the next parsed frame; reject on timeout.
function nextFrame(ws, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error("nextFrame timeout")); }, timeoutMs);
    function onMsg(raw) { cleanup(); try { resolve(JSON.parse(raw.toString())); } catch (e) { reject(e); } }
    function cleanup() { clearTimeout(timer); ws.off("message", onMsg); }
    ws.on("message", onMsg);
  });
}

// Wait for a close event; resolves with {code, reason}.
function nextClose(ws, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("nextClose timeout")), timeoutMs);
    ws.once("close", (code, reason) => { clearTimeout(timer); resolve({ code, reason: reason.toString() }); });
  });
}

function sendMsg(ws, evt, data) { ws.send(JSON.stringify({ evt, data })); }

// Authenticate a fresh client, return it after consuming the hello frame.
async function authAs(url, token = "good-token") {
  const ws = await connect(url);
  sendMsg(ws, "auth", { token });
  const hello = await nextFrame(ws);
  return { ws, hello };
}

// Assert that NO frame arrives within window (negative check).
function expectNoFrame(ws, windowMs = 300) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.off("message", onMsg); resolve(); }, windowMs);
    function onMsg() { clearTimeout(timer); ws.off("message", onMsg); reject(new Error("unexpected frame received")); }
    ws.on("message", onMsg);
  });
}

// ── Cases ─────────────────────────────────────────────────────────────────────

test("1. unauthenticated non-auth message → error frame + close 4401", async () => {
  const h = await startGateway();
  try {
    const ws = await connect(h.url);
    sendMsg(ws, "ping", {});
    const frame = await nextFrame(ws);
    assert.equal(frame.evt, "error");
    assert.equal(frame.data.reason, "auth_required");
    const { code } = await nextClose(ws);
    assert.equal(code, 4401);
  } finally { await h.stop(); }
});

test("2. bad token → auth:error + close 4401", async () => {
  const h = await startGateway();
  try {
    const ws = await connect(h.url);
    sendMsg(ws, "auth", { token: "nope" });
    const frame = await nextFrame(ws);
    assert.equal(frame.evt, "auth:error");
    assert.equal(frame.data.reason, "invalid_token");
    const { code } = await nextClose(ws);
    assert.equal(code, 4401);
  } finally { await h.stop(); }
});

test("3. good token → hello with clientId, authenticated, envelope fields", async () => {
  const h = await startGateway();
  try {
    const { ws, hello } = await authAs(h.url);
    assert.equal(hello.evt, "hello");
    assert.equal(hello.data.authenticated, true);
    assert.equal(hello.data.userId, "u1");
    assert.ok(typeof hello.data.clientId === "string" && hello.data.clientId.length > 0);
    assert.ok(typeof hello.data.ts === "string");
    assert.ok(typeof hello.data._seq === "number");
    assert.equal(hello.data._evt, "hello");
    ws.close();
  } finally { await h.stop(); }
});

test("4. auth timeout closes with 4408", async () => {
  const h = await startGateway({ authTimeoutMs: 100 });
  try {
    const ws = await connect(h.url);
    // Never send auth — expect the reaper to close us.
    const frame = await nextFrame(ws);
    assert.equal(frame.evt, "auth:error");
    assert.equal(frame.data.reason, "auth_timeout");
    const { code } = await nextClose(ws);
    assert.equal(code, 4408);
  } finally { await h.stop(); }
});

test("5. room:join valid → room:joined; invalid shapes → room:error", async () => {
  const h = await startGateway();
  try {
    const { ws } = await authAs(h.url);
    sendMsg(ws, "room:join", { room: "world:hub" });
    let f = await nextFrame(ws);
    assert.equal(f.evt, "room:joined");
    assert.equal(f.data.room, "world:hub");

    for (const bad of ["admin:x", "", "world:has spaces", "nocolon", "world:" + "x".repeat(80)]) {
      sendMsg(ws, "room:join", { room: bad });
      f = await nextFrame(ws);
      assert.equal(f.evt, "room:error", `expected room:error for ${JSON.stringify(bad)}`);
      assert.equal(f.data.reason, "invalid_room");
    }
    ws.close();
  } finally { await h.stop(); }
});

test("6. emitToRoom delivered only to joined+authed clients (negative check)", async () => {
  const h = await startGateway();
  try {
    const a = await authAs(h.url);
    const b = await authAs(h.url);
    sendMsg(a.ws, "room:join", { room: "world:hub" });
    const joined = await nextFrame(a.ws);
    assert.equal(joined.evt, "room:joined");

    // b did NOT join world:hub.
    const noFrame = expectNoFrame(b.ws, 300);
    const gotFrame = nextFrame(a.ws, 1000);
    h.gateway.emitToRoom("world:hub", "world:tick", { n: 42 });
    const f = await gotFrame;
    assert.equal(f.evt, "world:tick");
    assert.equal(f.data.n, 42);
    await noFrame; // b received nothing
    a.ws.close(); b.ws.close();
  } finally { await h.stop(); }
});

test("7. scene:request → scene:data matching stub verbatim", async () => {
  const h = await startGateway();
  try {
    const { ws } = await authAs(h.url);
    sendMsg(ws, "scene:request", { worldId: "hub" });
    const f = await nextFrame(ws);
    assert.equal(f.evt, "scene:data");
    assert.equal(f.data.format, "concord-scene/v1");
    assert.equal(f.data.ok, true);
    assert.equal(f.data.count, 1);
    assert.deepEqual(f.data.nodes[0].transform.scale, [3, 4, 5]);
    ws.close();
  } finally { await h.stop(); }
});

test("7b. scene:request with no exportScene dep → honest unavailable", async () => {
  const h = await startGateway({ exportScene: undefined, db: undefined });
  try {
    const { ws } = await authAs(h.url);
    sendMsg(ws, "scene:request", { worldId: "hub" });
    const f = await nextFrame(ws);
    assert.equal(f.evt, "scene:data");
    assert.equal(f.data.ok, false);
    assert.equal(f.data.reason, "scene_export_unavailable");
    ws.close();
  } finally { await h.stop(); }
});

test("8. malformed JSON → error, then ping still gets pong (survives)", async () => {
  const h = await startGateway();
  try {
    const { ws } = await authAs(h.url);
    ws.send("{not valid json");
    let f = await nextFrame(ws);
    assert.equal(f.evt, "error");
    assert.equal(f.data.reason, "malformed_json");
    sendMsg(ws, "ping", {});
    f = await nextFrame(ws);
    assert.equal(f.evt, "pong");
    ws.close();
  } finally { await h.stop(); }
});

test("9. oversized frame (>64KB, <2× ws limit) → message_too_large, survives", async () => {
  const h = await startGateway();
  try {
    const { ws } = await authAs(h.url);
    // ~80KB payload: over our 64KB honest limit, under the 128KB ws maxPayload.
    const big = "x".repeat(80 * 1024);
    ws.send(JSON.stringify({ evt: "noop", data: { blob: big } }));
    const f = await nextFrame(ws);
    assert.equal(f.evt, "error");
    assert.equal(f.data.reason, "message_too_large");
    // Still alive:
    sendMsg(ws, "ping", {});
    const g = await nextFrame(ws);
    assert.equal(g.evt, "pong");
    ws.close();
  } finally { await h.stop(); }
});

test("10. _seq strictly monotonic across frames from one gateway", async () => {
  const h = await startGateway();
  try {
    const { ws, hello } = await authAs(h.url);
    const seqs = [hello.data._seq];
    for (let i = 0; i < 4; i++) {
      sendMsg(ws, "ping", {});
      const f = await nextFrame(ws);
      seqs.push(f.data._seq);
    }
    for (let i = 1; i < seqs.length; i++) {
      assert.ok(seqs[i] > seqs[i - 1], `seq not increasing: ${seqs.join(",")}`);
    }
    ws.close();
  } finally { await h.stop(); }
});

test("11. broadcast reaches all authed clients", async () => {
  const h = await startGateway();
  try {
    const a = await authAs(h.url);
    const b = await authAs(h.url);
    const fa = nextFrame(a.ws, 1000);
    const fb = nextFrame(b.ws, 1000);
    const n = h.gateway.broadcast("server:announce", { msg: "hi" });
    assert.equal(n, 2);
    const [ra, rb] = await Promise.all([fa, fb]);
    assert.equal(ra.evt, "server:announce");
    assert.equal(rb.evt, "server:announce");
    a.ws.close(); b.ws.close();
  } finally { await h.stop(); }
});

test("12. foreign user:<other> join rejected as forbidden_room", async () => {
  const h = await startGateway();
  try {
    const { ws } = await authAs(h.url); // userId u1
    sendMsg(ws, "room:join", { room: "user:u2" });
    const f = await nextFrame(ws);
    assert.equal(f.evt, "room:error");
    assert.equal(f.data.reason, "forbidden_room");
    // own user room is fine:
    sendMsg(ws, "room:join", { room: "user:u1" });
    const g = await nextFrame(ws);
    assert.equal(g.evt, "room:joined");
    ws.close();
  } finally { await h.stop(); }
});
