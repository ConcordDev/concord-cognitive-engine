// server/tests/unity-gateway.test.js
//
// /unity-ws is the Unity Editor client's socket. Same gateway primitive as
// /godot-ws (auth, rooms, scene, {evt,data} envelope) so combat:attack hits
// the identical onClientMessage → applyAttack path. This file does not boot
// server.js; it mounts mountUnityGateway on a bare http.Server.
//
//   cd server && node --test tests/unity-gateway.test.js

import { test } from "node:test";
import assert from "node:assert";
import http from "node:http";
import { WebSocket } from "ws";
import { mountUnityGateway } from "../lib/unity-bridge.js";

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
    getUser: (userId) => (userId === "u1" ? { id: "u1", username: "tester" } : null),
    exportScene: () => STUB_SCENE,
    db: {},
    ...overrides,
  };
}

async function startGateway(depOverrides = {}) {
  const server = http.createServer();
  const gateway = mountUnityGateway(server, makeDeps(depOverrides));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const url = `ws://127.0.0.1:${port}/unity-ws`;
  return {
    gateway,
    url,
    port,
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

function nextFrame(ws, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error("nextFrame timeout")); }, timeoutMs);
    function onMsg(raw) { cleanup(); try { resolve(JSON.parse(raw.toString())); } catch (e) { reject(e); } }
    function cleanup() { clearTimeout(timer); ws.off("message", onMsg); }
    ws.on("message", onMsg);
  });
}

function nextClose(ws, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("nextClose timeout")), timeoutMs);
    ws.once("close", (code, reason) => { clearTimeout(timer); resolve({ code, reason: reason.toString() }); });
  });
}

function sendMsg(ws, evt, data) { ws.send(JSON.stringify({ evt, data })); }

async function authAs(url, token = "good-token") {
  const ws = await connect(url);
  sendMsg(ws, "auth", { token });
  const hello = await nextFrame(ws);
  return { ws, hello };
}

test("1. /unity-ws unauthenticated non-auth message → error + close 4401", async () => {
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

test("2. /unity-ws good token → hello (same envelope as /godot-ws)", async () => {
  const h = await startGateway();
  try {
    const { ws, hello } = await authAs(h.url);
    assert.equal(hello.evt, "hello");
    assert.equal(hello.data.authenticated, true);
    assert.equal(hello.data.userId, "u1");
    assert.ok(typeof hello.data.clientId === "string" && hello.data.clientId.length > 0);
    ws.close();
  } finally { await h.stop(); }
});

test("3. combat:attack on /unity-ws reaches onClientMessage (kernel path)", async () => {
  let resolveHit;
  const hit = new Promise((r) => { resolveHit = r; });
  const h = await startGateway({
    onClientMessage: (client, evt, data) => {
      resolveHit({ userId: client.userId, evt, data });
    },
  });
  try {
    const { ws } = await authAs(h.url);
    sendMsg(ws, "combat:attack", { targetId: "ArenaDummy", baseDamage: 14, range: 2.8, weapon: "sword" });
    const got = await Promise.race([
      hit,
      new Promise((_, rej) => setTimeout(() => rej(new Error("onClientMessage not called")), 2000)),
    ]);
    assert.equal(got.evt, "combat:attack");
    assert.equal(got.data.targetId, "ArenaDummy");
    assert.equal(got.data.baseDamage, 14);
    assert.equal(got.userId, "u1");
    ws.close();
  } finally { await h.stop(); }
});

test("4. scene:request on /unity-ws → scene:data (presentation, not a second sim)", async () => {
  const h = await startGateway();
  try {
    const { ws } = await authAs(h.url);
    sendMsg(ws, "scene:request", { worldId: "hub" });
    const f = await nextFrame(ws);
    assert.equal(f.evt, "scene:data");
    assert.equal(f.data.ok, true);
    assert.equal(f.data.format, "concord-scene/v1");
    ws.close();
  } finally { await h.stop(); }
});
