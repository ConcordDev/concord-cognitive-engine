// npc:residents on /unity-ws: the world's living, named NPCs for the game
// client's population. Public fields only; never narrative_context.secret.
//
//   cd server && node --test tests/unity-npc-residents.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import Database from "better-sqlite3";
import { WebSocket } from "ws";
import { mountUnityGateway } from "../lib/unity-bridge.js";

function residentsDb() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE world_npcs (
    id TEXT PRIMARY KEY, world_id TEXT, faction TEXT, job_type TEXT,
    current_activity TEXT, state TEXT, narrative_context TEXT, is_dead INTEGER DEFAULT 0)`);
  db.prepare(`INSERT INTO world_npcs VALUES (?, ?, ?, ?, ?, ?, ?, 0)`).run(
    "pn_1", "concordia-hub", "iron_wardens", "guard", "patrolling",
    JSON.stringify({ name: "Vesta Harrow" }),
    JSON.stringify({ backstory: "Sworn to the gates.", secret: "Sold the gate code" }));
  return db;
}

async function startGateway(db) {
  const server = http.createServer();
  const gateway = mountUnityGateway(server, {
    verifyToken: (token) => (token === "good-token" ? { userId: "u1" } : null),
    getUser: (userId) => (userId === "u1" ? { id: "u1", username: "tester" } : null),
    exportScene: () => ({ ok: true, worldId: "concordia-hub", nodes: [] }),
    exportKingdom: () => ({ ok: true, title: "Hub", settlements: [] }),
    db,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `ws://127.0.0.1:${server.address().port}/unity-ws`,
    async stop() { try { gateway.close(); } catch { /* */ } await new Promise((r) => server.close(r)); },
  };
}

function nextFrame(ws, evt, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.off("message", onMsg); reject(new Error("timeout waiting for " + evt)); }, timeoutMs);
    function onMsg(raw) {
      const f = JSON.parse(raw.toString());
      if (evt && f.evt !== evt) return;
      clearTimeout(timer); ws.off("message", onMsg); resolve(f);
    }
    ws.on("message", onMsg);
  });
}

async function authed(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
  ws.send(JSON.stringify({ evt: "auth", data: { token: "good-token" } }));
  await nextFrame(ws, "hello");
  return ws;
}

describe("npc:residents", () => {
  it("returns the world's named residents without their secrets", async () => {
    const h = await startGateway(residentsDb());
    try {
      const ws = await authed(h.url);
      ws.send(JSON.stringify({ evt: "npc:residents", data: { worldId: "concordia-hub" } }));
      const f = await nextFrame(ws, "npc:residents");
      assert.equal(f.data.ok, true);
      assert.equal(f.data.count, 1);
      assert.deepEqual(f.data.residents[0], {
        id: "pn_1", name: "Vesta Harrow", job: "guard", activity: "patrolling",
        faction: "iron_wardens", backstory: "Sworn to the gates.",
      });
      assert.doesNotMatch(JSON.stringify(f), /gate code/);
      ws.close();
    } finally { await h.stop(); }
  });

  it("missing worldId is an honest failure", async () => {
    const h = await startGateway(residentsDb());
    try {
      const ws = await authed(h.url);
      ws.send(JSON.stringify({ evt: "npc:residents", data: {} }));
      const f = await nextFrame(ws, "npc:residents");
      assert.deepEqual({ ok: f.data.ok, reason: f.data.reason }, { ok: false, reason: "missing_world" });
      ws.close();
    } finally { await h.stop(); }
  });
});
