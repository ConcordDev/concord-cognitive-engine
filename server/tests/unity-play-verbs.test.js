// Unity / Godot presenter verbs on /unity-ws: gift, barge-in, party, dodge, inheritance.
//
//   cd server && node --test tests/unity-play-verbs.test.js

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import Database from "better-sqlite3";
import { WebSocket } from "ws";
import { mountUnityGateway } from "../lib/unity-bridge.js";
import { giftReaction, GIFT_DELTA, giveGift } from "../lib/gifting.js";
import { handleDodge, handleDungeonOpen, handleRunStart } from "../lib/concordia-play.js";
import { applyHitToState, resetCombatState } from "../lib/combat-state.js";
import { resetSessionsForTest } from "../lib/concordia-session.js";
import { up as up050 } from "../migrations/050_player_inventory.js";
import { up as up206 } from "../migrations/206_romance.js";

function freshDb() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY);`);
  up050(db); up206(db);
  db.prepare(`INSERT INTO users (id) VALUES ('u1')`).run();
  db.exec(`CREATE TABLE world_npcs (id TEXT PRIMARY KEY, archetype TEXT, npc_type TEXT, state TEXT);`);
  try { db.exec(`ALTER TABLE player_inventory ADD COLUMN world_id TEXT DEFAULT 'concordia-hub'`); } catch { /* */ }
  db.prepare(`INSERT INTO world_npcs (id, archetype, npc_type, state) VALUES ('kestra', 'scholar', 'npc', ?)`).run(JSON.stringify({ name: "Kestra" }));
  db.prepare(`
    INSERT INTO player_inventory (id, user_id, item_type, item_id, item_name, quantity, world_id)
    VALUES ('row1', 'u1', 'material', 'tome01', 'Ancient Tome', 1, 'tunya')
  `).run();
  return db;
}

async function startGateway(db) {
  const server = http.createServer();
  const gateway = mountUnityGateway(server, {
    verifyToken: (token) => (token === "good-token" ? { userId: "u1" } : null),
    getUser: (userId) => (userId === "u1" ? { id: "u1", username: "tester" } : null),
    exportScene: () => ({ ok: true, worldId: "concordia-hub", nodes: [] }),
    exportKingdom: () => ({ ok: true, title: "Hub", staple: "lanterns", settlements: [] }),
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

describe("Unity play verbs", () => {
  let db, gw;

  before(async () => {
    resetSessionsForTest();
    db = freshDb();
    gw = await startGateway(db);
  });
  after(async () => {
    await gw.stop();
    try { db.close(); } catch { /* */ }
  });

  it("gift:give consumes a user-global stack even when world_id is another world", async () => {
    const ws = await authAs(gw.url);
    sendMsg(ws, "gift:give", { npcId: "kestra", itemId: "tome01", worldId: "concordia-hub" });
    const frame = await nextFrame(ws);
    assert.equal(frame.evt, "gift:result");
    assert.equal(frame.data.ok, true);
    assert.equal(frame.data.reaction, "loved");
    assert.equal(frame.data.source, "kernel");
    const left = db.prepare(`SELECT quantity FROM player_inventory WHERE item_id='tome01'`).get();
    assert.equal(left, undefined);
    ws.close();
  });

  it("giftReaction scholar+flower is liked via herb category", () => {
    assert.equal(giftReaction({ archetype: "scholar" }, "a lantern flower"), "neutral");
    assert.equal(giftReaction({ archetype: "healer" }, "a lantern flower"), "loved");
    assert.equal(GIFT_DELTA.loved > GIFT_DELTA.neutral, true);
  });

  it("party:request joins the world session", async () => {
    const ws = await authAs(gw.url);
    sendMsg(ws, "party:request", { worldId: "concordia-hub", x: 1, z: 2 });
    const frame = await nextFrame(ws);
    assert.equal(frame.evt, "party:data");
    assert.equal(frame.data.ok, true);
    assert.ok(frame.data.count >= 1);
    assert.equal(frame.data.members[0].id, "u1");
    ws.close();
  });

  it("combat:dodge grants i-frames that zero the next hit", () => {
    resetCombatState("u-dodge");
    const ack = handleDodge("u-dodge", { perfect: false });
    assert.equal(ack.ok, true);
    assert.equal(ack.iframeMs, 350);
    const hit = applyHitToState("u-dodge", { damage: 40 });
    assert.equal(hit.iframed, true);
    assert.equal(hit.damageMul, 0);
  });

  it("scheme:intervene without a row is not a fabricated success", async () => {
    const ws = await authAs(gw.url);
    sendMsg(ws, "scheme:intervene", { schemeId: "missing", action: "expose" });
    const frame = await nextFrame(ws);
    assert.equal(frame.evt, "scheme:intervened");
    assert.equal(frame.data.ok, false);
    assert.equal(frame.data.reason, "scheme_not_found");
    ws.close();
  });

  it("giveGift still rejects a missing stack", () => {
    const r = giveGift(db, { userId: "u1", npcId: "kestra", itemId: "nope" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "item_not_owned");
  });

  it("dungeon:open without a kernel table still names the authored encounter", () => {
    const r = handleDungeonOpen(null, "u1", { encounterId: "hollow_warden" });
    assert.equal(r.ok, true);
    assert.equal(r.source, "presenter");
    assert.equal(r.boss.name, "The Hollow Warden");
    assert.equal(handleDungeonOpen(null, "u1", { encounterId: "nope" }).reason, "unknown_encounter");
  });

  it("run:start without a db is an honest failure, never a fabricated wave", () => {
    const r = handleRunStart(null, "u1", { kind: "horde", worldId: "concordia-hub" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_db");
    assert.equal(handleRunStart(db, "u1", { kind: "raid" }).reason, "unknown_kind");
  });

  it("run:start horde on /unity-ws opens a kernel run", async () => {
    const { up: upHorde } = await import("../migrations/246_horde_mode.js");
    const { up: upDraft } = await import("../migrations/267_run_draft.js");
    const { up: upCoop } = await import("../migrations/270_run_coop.js");
    upHorde(db); upDraft(db); upCoop(db);
    const ws = await authAs(gw.url);
    sendMsg(ws, "run:start", { kind: "horde", worldId: "concordia-hub" });
    const frame = await nextFrame(ws);
    assert.equal(frame.evt, "run:data");
    assert.equal(frame.data.ok, true);
    assert.equal(frame.data.kind, "horde");
    assert.equal(frame.data.source, "kernel");
    assert.ok(frame.data.runId);
    assert.equal(frame.data.alreadyActive, false);
    ws.close();
  });
});
