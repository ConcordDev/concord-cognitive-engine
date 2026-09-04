import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { WebSocket } from "ws";
import { mountUnityGateway } from "../lib/unity-bridge.js";
import { buildKingdomSnapshot } from "../lib/concordia-kingdom-snapshot.js";

async function start() {
  const server = http.createServer();
  const gateway = mountUnityGateway(server, {
    verifyToken: (token) => (token === "good-token" ? { userId: "u1" } : null),
    getUser: (userId) => (userId === "u1" ? { id: "u1", username: "tester" } : null),
    exportScene: () => ({ ok: true, format: "concord-scene/v1", nodes: [] }),
    exportKingdom: buildKingdomSnapshot,
    db: {},
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  return {
    url: `ws://127.0.0.1:${port}/unity-ws`,
    async stop() {
      try { gateway.close(); } catch { /* */ }
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function nextFrame(ws, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error("nextFrame timeout")); }, timeoutMs);
    function onMsg(raw) { cleanup(); try { resolve(JSON.parse(raw.toString())); } catch (e) { reject(e); } }
    function cleanup() { clearTimeout(timer); ws.off("message", onMsg); }
    ws.on("message", onMsg);
  });
}

test("Unity /unity-ws guest + kingdom:request returns authored Court graph", async () => {
  const h = await start();
  try {
    const ws = new WebSocket(h.url);
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    ws.send(JSON.stringify({ evt: "auth", data: { token: "unity-local-guest" } }));
    const hello = await nextFrame(ws);
    assert.equal(hello.evt, "hello");
    assert.equal(hello.data.userId, "unity-local-guest");
    ws.send(JSON.stringify({ evt: "kingdom:request", data: { worldId: "concordia-hub" } }));
    const f = await nextFrame(ws);
    assert.equal(f.evt, "kingdom:data");
    assert.equal(f.data.ok, true);
    assert.equal(f.data.format, "concord-kingdom/v1");
    assert.equal(f.data.title, "The Unburned Court");
    assert.equal(f.data.kingdom.staple, "lanterns");
    assert.equal(f.data.settlements.length, 0);
    assert.deepEqual(f.data.caravans, []);
    assert.doesNotMatch(JSON.stringify(f.data), /Aurelia/);
    ws.close();
  } finally {
    await h.stop();
  }
});
