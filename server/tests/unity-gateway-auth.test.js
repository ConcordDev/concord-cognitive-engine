// /unity-ws auth behind a proxy. nginx connects from 127.0.0.1, so the
// editor's loopback guest must not be granted to forwarded visitors; the web
// build's login arrives as the httpOnly concord_auth cookie on the upgrade.
//
//   cd server && node --test tests/unity-gateway-auth.test.js

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { WebSocket } from "ws";
import { mountUnityGateway } from "../lib/unity-bridge.js";

let prevEnv;
before(() => { prevEnv = process.env.NODE_ENV; process.env.NODE_ENV = "production"; });
after(() => { process.env.NODE_ENV = prevEnv; });

async function startGateway() {
  const server = http.createServer();
  const gateway = mountUnityGateway(server, {
    verifyToken: (token) => (token === "jwt-for-u1" ? { userId: "u1" } : null),
    getUser: (userId) => (userId === "u1" ? { id: "u1", username: "tester" } : null),
    exportScene: () => ({ ok: true, nodes: [] }),
    exportKingdom: () => ({ ok: true, settlements: [] }),
    db: {},
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `ws://127.0.0.1:${server.address().port}/unity-ws`,
    async stop() { try { gateway.close(); } catch { /* */ } await new Promise((r) => server.close(r)); },
  };
}

async function authReply(url, headers, token = "unity-local-guest") {
  const ws = new WebSocket(url, { headers });
  await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
  ws.send(JSON.stringify({ evt: "auth", data: { token } }));
  const frame = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("no auth reply")), 2000);
    ws.on("message", (raw) => {
      const f = JSON.parse(raw.toString());
      if (f.evt === "hello" || f.evt === "auth:error" || f.evt === "error") { clearTimeout(t); resolve(f); }
    });
  });
  ws.close();
  return frame;
}

describe("/unity-ws auth", () => {
  it("a direct local editor still gets the loopback guest", async () => {
    const h = await startGateway();
    try {
      const f = await authReply(h.url, {});
      assert.equal(f.evt, "hello");
      assert.equal(f.data.userId, "unity-local-guest");
    } finally { await h.stop(); }
  });

  it("a proxied visitor is refused the guest even though the socket is 127.0.0.1", async () => {
    const h = await startGateway();
    try {
      const f = await authReply(h.url, { "X-Forwarded-For": "203.0.113.9" });
      assert.notEqual(f.evt, "hello", JSON.stringify(f));
    } finally { await h.stop(); }
  });

  it("a proxied visitor with the site's login cookie is that user", async () => {
    const h = await startGateway();
    try {
      const f = await authReply(h.url, { "X-Forwarded-For": "203.0.113.9", Cookie: "theme=dark; concord_auth=jwt-for-u1" });
      assert.equal(f.evt, "hello");
      assert.equal(f.data.userId, "u1");
    } finally { await h.stop(); }
  });

  it("a bad cookie earns nothing", async () => {
    const h = await startGateway();
    try {
      const f = await authReply(h.url, { "X-Forwarded-For": "203.0.113.9", Cookie: "concord_auth=forged" });
      assert.notEqual(f.evt, "hello");
    } finally { await h.stop(); }
  });
});
