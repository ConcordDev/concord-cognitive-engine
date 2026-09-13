// AgentBody P0: characterId lifecycle + affect_state bind on /unity-ws.
//
//   cd server && node --test tests/concordia-agent-body.test.js

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import Database from "better-sqlite3";
import { WebSocket } from "ws";
import { mountUnityGateway } from "../lib/unity-bridge.js";
import { up as up110 } from "../migrations/110_affect_state.js";
import { up as up449 } from "../migrations/449_concordia_agent_characters.js";
import { handleCharacterCreate, handleCharacterBind, handleCharacterUnbind } from "../lib/concordia-agent-body.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const scripts = join(root, "apps/concordia-living-world/unity-client/Assets/Concordia/Scripts");

function src(name) {
  return readFileSync(join(scripts, name), "utf8");
}

function freshDb() {
  const db = new Database(":memory:");
  up110(db);
  up449(db);
  return db;
}

async function startGateway(db) {
  const server = http.createServer();
  const gateway = mountUnityGateway(server, {
    verifyToken: (token) => (token === "good-token" ? { userId: "u1" } : null),
    getUser: (userId) => (userId === "u1" ? { id: "u1", username: "tester" } : null),
    exportScene: () => ({ ok: true, worldId: "concordia-hub", nodes: [] }),
    db,
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

describe("Concordia AgentBody P0", () => {
  it("create binds affect_state before a pawn can exist", () => {
    const db = freshDb();
    const soul = handleCharacterCreate(db, "u1", { assistantId: "grok-bot", appearance: { displayName: "Grok" } });
    assert.equal(soul.ok, true);
    assert.match(soul.characterId, /^chr_/);
    const row = db.prepare(`SELECT entity_id, f FROM affect_state WHERE entity_id = ?`).get(soul.characterId);
    assert.ok(row, "affect_state row missing");
    assert.equal(row.entity_id, soul.characterId);
    assert.ok(soul.affect);
    assert.equal(typeof soul.affect.v, "number");
    db.close();
  });

  it("unbind parks pose and keeps the soul", () => {
    const db = freshDb();
    const soul = handleCharacterCreate(db, "u1", { assistantId: "grok-bot" });
    handleCharacterBind(db, "u1", { characterId: soul.characterId, sessionId: "sess-1" });
    const parked = handleCharacterUnbind(db, "u1", {
      characterId: soul.characterId, x: 12, y: 0.12, z: -4, yaw: 90, worldId: "concordia-hub",
    });
    assert.equal(parked.ok, true);
    assert.equal(parked.pose.x, 12);
    assert.equal(parked.boundSession, null);
    const still = db.prepare(`SELECT id FROM concordia_agent_characters WHERE id = ?`).get(soul.characterId);
    assert.ok(still);
    db.close();
  });

  it("character:create over /unity-ws returns a bound soul", async () => {
    const db = freshDb();
    const gw = await startGateway(db);
    const ws = await authAs(gw.url);
    sendMsg(ws, "character:create", { assistantId: "grok-bot", appearance: { displayName: "Grok" } });
    const frame = await nextFrame(ws);
    assert.equal(frame.evt, "character:created");
    assert.equal(frame.data.ok, true);
    assert.ok(frame.data.affect);
    ws.close();
    await gw.stop();
    db.close();
  });

  it("Unity scripts exist and Flower Law is Hub+clock, not a leftover", () => {
    for (const name of ["AgentAvatar.cs", "AgentMotor.cs", "WorldPresence.cs"]) {
      assert.equal(existsSync(join(scripts, name)), true, name);
    }
    const avatar = src("AgentAvatar.cs");
    const motor = src("AgentMotor.cs");
    const canon = src("Canon.cs");
    const stream = src("ContinentStream.cs");
    const label = src("WorldGate.cs");
    const gait = src("ModularPerson.cs");
    const hud = src("ConcordiaHUD.cs");
    assert.match(avatar, /class AgentAvatar/);
    assert.match(avatar, /characterId/);
    assert.match(motor, /class AgentMotor/);
    assert.match(motor, /Hostile\.TelegraphKind/);
    assert.match(motor, /Canon\.SteelLive/);
    assert.match(canon, /WorldClock\.World != WorldId\.Hub/);
    assert.match(stream, /player\.world = id/);
    assert.match(label, /characterSize = 0\.016f/);
    assert.match(gait, /PlantAuthoredFeet/);
    assert.match(gait, /allowFallback/);
    assert.match(hud, /if \(DebugHud\)/);
    assert.match(hud, /AgentAvatar\.KitchenBind/);
    assert.doesNotMatch(avatar, /Coplay/);
    assert.doesNotMatch(motor, /Coplay/);
  });
});
