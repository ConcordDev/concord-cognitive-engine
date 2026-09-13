// Phase 2 world-spine: world:snapshot + gateway mirror of clock/weather.
//
//   cd server && node --test tests/unity-world-spine.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { WebSocket } from "ws";
import { mountUnityGateway } from "../lib/unity-bridge.js";
import { getWeather } from "../lib/weather.js";
import { getWorldPhase, getDayPhase, WORLD_CLOCK_CONSTANTS } from "../lib/world-clock.js";
import { mirrorToGateways } from "../lib/gateway-fanout.js";

async function startGateway() {
  const server = http.createServer();
  const gateway = mountUnityGateway(server, {
    verifyToken: (token) => (token === "good-token" ? { userId: "u1" } : null),
    getUser: (userId) => (userId === "u1" ? { id: "u1", username: "tester" } : null),
    exportScene: () => ({ ok: true, worldId: "concordia-hub", nodes: [] }),
    exportKingdom: () => ({ ok: true, title: "Hub", staple: "lanterns", settlements: [] }),
    db: {},
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  return {
    url: `ws://127.0.0.1:${port}/unity-ws`,
    async stop() {
      try { gateway.close(); } catch { /* */ }
      await new Promise((r) => server.close(r));
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

function sendMsg(ws, evt, data) { ws.send(JSON.stringify({ evt, data })); }

async function authAs(url) {
  const ws = await connect(url);
  sendMsg(ws, "auth", { token: "good-token" });
  const hello = await nextFrame(ws);
  assert.equal(hello.evt, "hello");
  return ws;
}

describe("world:snapshot", () => {
  it("unauthenticated snapshot is rejected by existing auth", async () => {
    const h = await startGateway();
    try {
      const ws = await connect(h.url);
      sendMsg(ws, "world:snapshot", { worldId: "concordia-hub" });
      const frame = await nextFrame(ws);
      assert.equal(frame.evt, "error");
      assert.equal(frame.data.reason, "auth_required");
      ws.close();
    } finally { await h.stop(); }
  });

  it("missing worldId is an honest failure, not a fabricated climate", async () => {
    const h = await startGateway();
    try {
      const ws = await authAs(h.url);
      sendMsg(ws, "world:snapshot", {});
      const frame = await nextFrame(ws);
      assert.equal(frame.evt, "world:snapshot");
      assert.equal(frame.data.ok, false);
      assert.equal(frame.data.reason, "missing_world");
      ws.close();
    } finally { await h.stop(); }
  });

  it("returns the real clock + weather engines, not a stub climate", async () => {
    const h = await startGateway();
    try {
      const ws = await authAs(h.url);
      sendMsg(ws, "world:snapshot", { worldId: "concordia-hub" });
      const frame = await nextFrame(ws);
      assert.equal(frame.evt, "world:snapshot");
      assert.equal(frame.data.ok, true);
      assert.equal(frame.data.worldId, "concordia-hub");
      const phase = getWorldPhase();
      assert.equal(typeof frame.data.clock.phase, "number");
      assert.ok(Math.abs(frame.data.clock.phase - phase) < 0.05);
      assert.equal(frame.data.clock.segment, getDayPhase(frame.data.clock.phase));
      assert.equal(frame.data.clock.dayLengthMs, WORLD_CLOCK_CONSTANTS.dayLengthMs);
      const live = getWeather("concordia-hub");
      assert.equal(frame.data.weather.type, live.type);
      assert.equal(frame.data.weather.intensity, live.intensity);
      assert.ok(Array.isArray(frame.data.npcs));
      assert.equal(frame.data.npcs.length, 0);
      assert.ok(Array.isArray(frame.data.lore));
      assert.ok(frame.data.lore.some((b) => b.id === "hub_the_heart_claimed"));
      assert.ok(Array.isArray(frame.data.quests));
      assert.ok(frame.data.quests.some((q) => q.id === "founding_day_01_gather"));
      assert.equal(frame.data.refusal.id, "the_ninth");
      ws.close();
    } finally { await h.stop(); }
  });

  it("inspect:request fails honestly without an npc id", async () => {
    const h = await startGateway();
    try {
      const ws = await authAs(h.url);
      sendMsg(ws, "inspect:request", {});
      const frame = await nextFrame(ws);
      assert.equal(frame.evt, "inspect:data");
      assert.equal(frame.data.ok, false);
      assert.equal(frame.data.reason, "missing_npc");
      ws.close();
    } finally { await h.stop(); }
  });
});

describe("gateway-only mirror hook", () => {
  it("mirrorToGateways is a no-op when no hook is assigned", () => {
    const prev = globalThis._concordGatewayMirror;
    delete globalThis._concordGatewayMirror;
    assert.doesNotThrow(() => mirrorToGateways("world:weather", { worldId: "x" }, { worldId: "x" }));
    globalThis._concordGatewayMirror = prev;
  });

  it("mirrorToGateways forwards event + worldId to the assigned hook", () => {
    const prev = globalThis._concordGatewayMirror;
    const seen = [];
    globalThis._concordGatewayMirror = (event, payload, opts) => seen.push({ event, payload, opts });
    try {
      mirrorToGateways("world:weather", { type: "rain" }, { worldId: "concordia-hub" });
      assert.equal(seen.length, 1);
      assert.equal(seen[0].event, "world:weather");
      assert.equal(seen[0].payload.type, "rain");
      assert.equal(seen[0].opts.worldId, "concordia-hub");
    } finally {
      globalThis._concordGatewayMirror = prev;
    }
  });
});
