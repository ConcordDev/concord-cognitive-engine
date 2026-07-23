// server/tests/godot-gateway-integration.test.js
//
// End-to-end integration test for the Godot gateway MOUNT — the actual
// integration point, not just the standalone contract tests in
// tests/godot-gateway.test.js (those boot a bare http.createServer() with
// stub deps and never touch server.js at all). This test boots the REAL
// server.js, with the REAL auth stack, on a REAL bound TCP port, and proves:
//
//   1. the server still boots clean with the gateway mounted (no TDZ crash —
//      the `if (server)` mount sits after both `app` (~27554) and
//      `LENS_ACTIONS` (~36537) are declared, AND after `server` itself is
//      created via app.listen());
//   2. socket.io and the Godot gateway coexist on the same http.Server's
//      'upgrade' event without stepping on each other (both are live —
//      REALTIME.io drives the "socketio" transport realtimeEmit reports,
//      and the SAME calls also reach our raw ws client via the mirror);
//   3. a real ws client can authenticate over /godot-ws with a bearer token
//      minted by the real /api/auth/register endpoint (not a stub verifier);
//   4. realtimeEmit's user-scoped + global-broadcast branches, and
//      emitToWorld's world-scoped branch, all mirror into the matching
//      gateway rooms (user:<id> / world:<id> / global broadcast).
//
// Run standalone: node --test tests/godot-gateway-integration.test.js
//
// Boots the real server in-process with CONCORD_FORCE_LISTEN=true so
// `server` (server.js's http.Server local) is a genuine bound socket — the
// gateway's mount is gated on `if (server)`, and the normal test default
// (CONCORD_NO_LISTEN=true / NODE_ENV=test with no force) makes `server ===
// null`, which would skip the mount entirely and make this test prove
// nothing. Same "spawn on a real port, isolated data dir, poll /health"
// shape as tests/storage-parity.test.js, but in-process (not a child_process
// spawn) so the test can reach into __TEST__ for realtimeEmit/emitToWorld
// directly instead of needing an HTTP route that happens to trigger one.
//
// Teardown mirrors tests/depth/_harness.js's hard-exit pattern (see its own
// long comment for why): terminate the pooled worker threads, clear tracked
// intervals, unref remaining handles, then a short unref'd watchdog
// process.exit() as a last resort — `node --test`'s file-completion
// tracking does not consider a file done on handle-quiescence alone.

import { test, before, after } from "node:test";
import assert from "node:assert";
import { WebSocket } from "ws";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const TS = Date.now();
const PORT = 15900 + (process.pid % 500);
const API_BASE = `http://127.0.0.1:${PORT}`;
const WS_URL = `ws://127.0.0.1:${PORT}/godot-ws`;

const DATA_DIR = path.join(os.tmpdir(), `concord-godot-it-data-${TS}`);
const STATE_PATH = path.join(os.tmpdir(), `concord-godot-it-state-${TS}.json`);
const DB_PATH = path.join(os.tmpdir(), `concord-godot-it-${TS}.db`);

let __TEST__ = null;

before(async () => {
  process.env.NODE_ENV = "test";
  // Overrides the test-mode default of not binding a port — see the file
  // header. Without this, `server` is null and the gateway never mounts.
  process.env.CONCORD_FORCE_LISTEN = "true";
  process.env.PORT = String(PORT);
  process.env.DATA_DIR = DATA_DIR;
  process.env.STATE_PATH = STATE_PATH;
  process.env.DB_PATH = DB_PATH;
  process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "godot_it_admin_pw_12345";
  // This test registers 5 users from the same loopback IP; the real
  // per-IP-per-day registration cap (routes/auth.js, MAX=3) would otherwise
  // reject the 4th/5th with a genuine 429 that has nothing to do with the
  // gateway under test. This bypass exists for exactly this kind of test.
  process.env.CONCORD_RATE_LIMIT_BYPASS = "1";

  const mod = await import("../server.js");
  __TEST__ = mod.__TEST__;

  // Poll /health the same way tests/storage-parity.test.js does.
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(2_000) });
      if (res.ok) break;
    } catch { /* still booting */ }
    if (Date.now() > deadline) throw new Error("real server did not become ready on /health");
    await new Promise((r) => { setTimeout(r, 300); });
  }
});

after(async () => {
  try { await __TEST__?.terminateAllWorkersForTest?.(); } catch { /* best-effort teardown */ }
  try { __TEST__?.clearActiveTimersForTest?.(); } catch { /* best-effort teardown */ }
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* best-effort teardown */ }
  try { fs.unlinkSync(STATE_PATH); } catch { /* best-effort teardown */ }
  // better-sqlite3 WAL mode leaves -wal/-shm siblings alongside the main file.
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    try { fs.unlinkSync(DB_PATH + suffix); } catch { /* best-effort teardown */ }
  }
  try {
    const handles = process._getActiveHandles ? process._getActiveHandles() : [];
    for (const h of handles) { if (h && typeof h.unref === "function") h.unref(); }
  } catch { /* best-effort teardown */ }
  const watchdog = setTimeout(() => { process.exit(process.exitCode ?? 0); }, 300);
  watchdog.unref();
});

// ── ws helpers (same shape as tests/godot-gateway.test.js) ────────────────
function connect(url) {
  const ws = new WebSocket(url);
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}
function nextFrame(ws, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { ws.off("message", onMsg); reject(new Error("nextFrame timeout")); }, timeoutMs);
    function onMsg(raw) { clearTimeout(t); ws.off("message", onMsg); try { resolve(JSON.parse(raw.toString())); } catch (e) { reject(e); } }
    ws.on("message", onMsg);
  });
}
function sendMsg(ws, evt, data) { ws.send(JSON.stringify({ evt, data })); }

async function registerUser(username) {
  const res = await fetch(`${API_BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username,
      email: `${username}@godot-it.test`,
      password: "GodotIT_Test_12345!",
      dateOfBirth: "1990-01-01",
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json();
  assert.ok(res.ok, `register failed: ${JSON.stringify(data)}`);
  assert.ok(data.token, "register should return a bearer token for non-browser clients");
  assert.ok(data.user?.id, "register should return the new user's id");
  return { token: data.token, userId: data.user.id };
}

// ── Cases ──────────────────────────────────────────────────────────────────

test("real server boots with the gateway mounted (no TDZ crash)", async () => {
  assert.ok(__TEST__, "server module should have loaded via dynamic import");
  assert.equal(typeof __TEST__.realtimeEmit, "function");
  assert.equal(typeof __TEST__.emitToWorld, "function");
  // If the mount had thrown (bad DI, TDZ, upgrade-handler conflict), boot
  // itself would already have failed above in before() — /health responded,
  // so the whole boot sequence including the gateway mount attempt completed.
});

test("godot-ws auth handshake succeeds with a real /api/auth/register token", async () => {
  const { token, userId } = await registerUser(`godotit_${TS}_a`);
  const ws = await connect(WS_URL);
  try {
    sendMsg(ws, "auth", { token });
    const hello = await nextFrame(ws);
    assert.equal(hello.evt, "hello");
    assert.equal(hello.data.authenticated, true);
    assert.equal(hello.data.userId, userId);
    assert.ok(typeof hello.data.clientId === "string" && hello.data.clientId.length > 0);
  } finally { ws.close(); }
});

test("realtimeEmit({userId}) mirrors into the gateway's user:<id> room", async () => {
  const { token, userId } = await registerUser(`godotit_${TS}_b`);
  const ws = await connect(WS_URL);
  try {
    sendMsg(ws, "auth", { token });
    await nextFrame(ws); // hello

    const framePromise = nextFrame(ws);
    const r = __TEST__.realtimeEmit("godot-it:user-event", { hello: "world" }, { userId });
    assert.equal(r.ok, true);
    assert.equal(r.transport, "socketio"); // proves socket.io is ALSO live — coexistence, not a fallback
    const frame = await framePromise;
    assert.equal(frame.evt, "godot-it:user-event");
    assert.equal(frame.data.hello, "world");
  } finally { ws.close(); }
});

test("emitToWorld mirrors into a joined world:<id> room", async () => {
  const { token } = await registerUser(`godotit_${TS}_c`);
  const ws = await connect(WS_URL);
  try {
    sendMsg(ws, "auth", { token });
    await nextFrame(ws); // hello

    sendMsg(ws, "room:join", { room: "world:godot-it-testworld" });
    const joined = await nextFrame(ws);
    assert.equal(joined.evt, "room:joined");
    assert.equal(joined.data.room, "world:godot-it-testworld");

    const framePromise = nextFrame(ws);
    const r = __TEST__.emitToWorld("godot-it-testworld", "world:tick", { n: 42 });
    assert.equal(r.ok, true);
    const frame = await framePromise;
    assert.equal(frame.evt, "world:tick");
    assert.equal(frame.data.n, 42);
  } finally { ws.close(); }
});

test("realtimeEmit() with no scope broadcasts to every authenticated gateway client", async () => {
  const { token } = await registerUser(`godotit_${TS}_d`);
  const ws = await connect(WS_URL);
  try {
    sendMsg(ws, "auth", { token });
    await nextFrame(ws); // hello

    const framePromise = nextFrame(ws);
    const r = __TEST__.realtimeEmit("godot-it:broadcast", { n: 7 });
    assert.equal(r.ok, true);
    const frame = await framePromise;
    assert.equal(frame.evt, "godot-it:broadcast");
    assert.equal(frame.data.n, 7);
  } finally { ws.close(); }
});

test("scene:request round-trips through the real exportScene + real db", async () => {
  const { token } = await registerUser(`godotit_${TS}_e`);
  const ws = await connect(WS_URL);
  try {
    sendMsg(ws, "auth", { token });
    await nextFrame(ws); // hello

    sendMsg(ws, "scene:request", { worldId: "godot-it-scene-world" });
    const frame = await nextFrame(ws);
    assert.equal(frame.evt, "scene:data");
    // A world with no world_buildings rows is an honest empty scene, not a
    // fabricated one — exportScene(db, worldId) returns ok:true, count:0.
    assert.equal(frame.data.ok, true);
    assert.equal(frame.data.format, "concord-scene/v1");
    assert.equal(frame.data.count, 0);
    assert.deepEqual(frame.data.nodes, []);
  } finally { ws.close(); }
});

// ── Inbound dispatch (bidirectionality) ─────────────────────────────────────
// Proves player:move frames sent BY the Godot client are actually dispatched
// server-side through the shared core (applyPlayerMove in server.js) that
// also backs the socket.io handler — including cityPresence's real
// anti-cheat, not a gateway-side stub or a blanket unknown_evt.

test("player:move round-trips through real cityPresence anti-cheat over /godot-ws", async () => {
  const { token } = await registerUser(`godotit_${TS}_f`);
  const ws = await connect(WS_URL);
  try {
    sendMsg(ws, "auth", { token });
    await nextFrame(ws); // hello

    // room:join is handled natively inside godot-gateway.js itself (not the
    // onClientMessage fallback this unit adds) — exercised here anyway to
    // confirm the client can occupy a world room before moving in it, the
    // shape a real Godot client would follow.
    sendMsg(ws, "room:join", { room: "world:godot-it-move-world" });
    const joined = await nextFrame(ws);
    assert.equal(joined.evt, "room:joined");

    // First move establishes the baseline position (no `prev`, so
    // cityPresence.updateUserPosition can't run the speed/teleport checks
    // yet — this MUST ack, proving the frame reached the real handler and
    // not the gateway's old blanket `error {reason:"unknown_evt"}`).
    sendMsg(ws, "player:move", { cityId: "godot-it-move-world", x: 1, y: 0, z: 1, direction: 0 });
    const ack = await nextFrame(ws);
    assert.equal(ack.evt, "player:move:ack");
    assert.equal(ack.data.ok, true);
    assert.equal(ack.data.chunkCrossed, true); // first-ever position for this user

    // Wait out cityPresence's 500ms post-login grace period (city-presence.js
    // GRACE_PERIOD_MS) so the next move is actually speed/teleport-checked
    // instead of being waved through as "just logged in".
    await new Promise((r) => { setTimeout(r, 650); });

    // A ~1,271m jump in well under a second is an unmissable teleport by any
    // mode's speed cap (900,900 stays inside math-safety.js's ±1000 world
    // envelope — a bigger jump would get silently clamped back to the
    // {0,0,0} respawn position by clampToWorldBounds BEFORE the anti-cheat
    // distance check even runs, which would defeat this test by making the
    // "teleport" land implausibly close to the last good position). Proves
    // the SAME server-authoritative cityPresence.updateUserPosition
    // anti-cheat that guards the socket.io path also guards the Godot path,
    // not a laxer/duplicate copy.
    sendMsg(ws, "player:move", { cityId: "godot-it-move-world", x: 900, y: 0, z: 900, direction: 0 });
    const nack = await nextFrame(ws);
    assert.equal(nack.evt, "player:move:nack");
    assert.ok(["teleport_detected", "speed_hack_detected"].includes(nack.data.reason), `unexpected reason: ${nack.data.reason}`);
    // The rejected move must not have overwritten server state — prev is the
    // last GOOD (accepted) position, proving the update was actually
    // dropped server-side rather than silently applied.
    assert.equal(nack.data.prev.x, 1);
    assert.equal(nack.data.prev.z, 1);
  } finally { ws.close(); }
});

test("player:mode round-trips through the shared core over /godot-ws", async () => {
  const { token } = await registerUser(`godotit_${TS}_g`);
  const ws = await connect(WS_URL);
  try {
    sendMsg(ws, "auth", { token });
    await nextFrame(ws); // hello

    // "sprint" needs no external capability check (see applyPlayerMode) —
    // exercises the always-legitimate ack branch end-to-end.
    sendMsg(ws, "player:mode", { mode: "sprint" });
    const ack = await nextFrame(ws);
    assert.equal(ack.evt, "player:mode:ack");
    assert.equal(ack.data.ok, true);
    assert.equal(ack.data.mode, "sprint");

    // An unowned mount claim must be rejected server-side, not granted on
    // the client's say-so — same legitimacy gate as the socket.io path.
    sendMsg(ws, "player:mode", { mode: "mount:nonexistent-species" });
    const nack = await nextFrame(ws);
    assert.equal(nack.evt, "player:mode:nack");
    assert.equal(nack.data.reason, "not_mounted");
  } finally { ws.close(); }
});

test("an event with no inbound dispatch gets an honest unsupported_evt, not a fabricated success", async () => {
  const { token } = await registerUser(`godotit_${TS}_h`);
  const ws = await connect(WS_URL);
  try {
    sendMsg(ws, "auth", { token });
    await nextFrame(ws); // hello

    sendMsg(ws, "combat:attack", { targetId: "nope" });
    const frame = await nextFrame(ws);
    assert.equal(frame.evt, "error");
    assert.equal(frame.data.reason, "unsupported_evt");
    assert.equal(frame.data.evt, "combat:attack");
  } finally { ws.close(); }
});

// ── design_command (Phase 4 / D17 first slice) ────────────────────────────────
// Proves `design_command` frames sent BY the Godot client dispatch through the
// SAME LENS_ACTIONS/MACROS resolution `/api/lens/run` uses, reaching the real
// `server/domains/gamedesign.js` macros — not a parallel/invented data model —
// and that the effect is genuinely visible afterward: in-memory STATE for the
// Map-backed 2D game-project macros, and a real SQLite row for
// `building-publish` (the one action with a live-world DB effect).

test("design_command game-create/level-create/entity-add round-trip through the real gamedesign macros (STATE-visible)", async () => {
  const { token, userId } = await registerUser(`godotit_${TS}_j`);
  const ws = await connect(WS_URL);
  try {
    sendMsg(ws, "auth", { token });
    await nextFrame(ws); // hello

    sendMsg(ws, "design_command", { action: "game-create", params: { title: "Godot IT Test Game", genre: "arcade" } });
    const gameFrame = await nextFrame(ws);
    assert.equal(gameFrame.evt, "design_command:result");
    assert.equal(gameFrame.data.action, "game-create");
    assert.equal(gameFrame.data.ok, true, `game-create should succeed: ${JSON.stringify(gameFrame.data)}`);
    const gameId = gameFrame.data.result?.game?.id;
    assert.ok(gameId, "game-create result should carry the new game's id");

    // Real effect, visible from OUTSIDE the gateway dispatch path: the exact
    // in-memory Map gamedesign.js's own getGdState()/game-get macro reads.
    const gdState = __TEST__.STATE.gameDesignLens;
    assert.ok(gdState, "STATE.gameDesignLens should exist after a design_command dispatch");
    const storedGame = (gdState.games.get(userId) || []).find((g) => g.id === gameId);
    assert.ok(storedGame, "the created game should be a real row in STATE.gameDesignLens.games, not just an echoed response");
    assert.equal(storedGame.title, "Godot IT Test Game");

    sendMsg(ws, "design_command", { action: "level-create", params: { gameId, name: "Level One", cols: 12, rows: 8 } });
    const levelFrame = await nextFrame(ws);
    assert.equal(levelFrame.data.action, "level-create");
    assert.equal(levelFrame.data.ok, true, `level-create should succeed: ${JSON.stringify(levelFrame.data)}`);
    const levelId = levelFrame.data.result?.level?.id;
    assert.ok(levelId, "level-create result should carry the new level's id");
    const storedLevel = (gdState.levels.get(userId) || []).find((l) => l.id === levelId);
    assert.ok(storedLevel, "the created level should be a real row in STATE.gameDesignLens.levels");
    assert.equal(storedLevel.cols, 12);
    assert.equal(storedLevel.rows, 8);
    // level-create's own default layers prove this hit the real handler body
    // (a fabricated success could echo params but wouldn't derive this).
    assert.equal(storedLevel.layers.length, 2);

    sendMsg(ws, "design_command", { action: "entity-add", params: { gameId, name: "Slime", kind: "enemy", health: 10 } });
    const entityFrame = await nextFrame(ws);
    assert.equal(entityFrame.data.action, "entity-add");
    assert.equal(entityFrame.data.ok, true, `entity-add should succeed: ${JSON.stringify(entityFrame.data)}`);
    const entityId = entityFrame.data.result?.entity?.id;
    assert.ok(entityId, "entity-add result should carry the new entity's id");
    const storedEntity = (gdState.entities.get(userId) || []).find((e) => e.id === entityId);
    assert.ok(storedEntity, "the created entity should be a real row in STATE.gameDesignLens.entities");
    assert.equal(storedEntity.name, "Slime");
    assert.equal(storedEntity.kind, "enemy");
  } finally { ws.close(); }
});

test("design_command building-publish spawns a REAL world_buildings row (SQLite-visible, not just STATE)", async () => {
  const { token, userId } = await registerUser(`godotit_${TS}_k`);
  const ws = await connect(WS_URL);
  const worldId = `godot-it-design-world-${TS}`;
  try {
    sendMsg(ws, "auth", { token });
    await nextFrame(ws); // hello

    sendMsg(ws, "design_command", {
      action: "building-publish",
      params: {
        archetype: "tavern",
        name: "Godot IT Tavern",
        dimensions: { width: 8, height: 6, depth: 8 },
        worldId,
        position: { x: 111, y: 0, z: 222 },
      },
    });
    const frame = await nextFrame(ws);
    assert.equal(frame.evt, "design_command:result");
    assert.equal(frame.data.action, "building-publish");
    assert.equal(frame.data.ok, true, `building-publish should succeed: ${JSON.stringify(frame.data)}`);
    assert.equal(frame.data.spawned, true);
    const { buildingId, dtuId } = frame.data;
    assert.ok(buildingId, "building-publish result should carry the new world_buildings row id");
    assert.ok(dtuId, "building-publish result should carry the new blueprint DTU id");

    // The real, independently-queryable DB effect — this is NOT in-memory
    // STATE, it's a genuine SQLite row a live world's scene-export/exportScene
    // read path would also see.
    const db = __TEST__.STATE.db;
    const row = db.prepare(
      "SELECT id, world_id, archetype, name, x, y, z, blueprint_dtu_id, owner_id FROM world_buildings WHERE id = ?"
    ).get(buildingId);
    assert.ok(row, "building-publish must leave a real, queryable world_buildings row");
    assert.equal(row.world_id, worldId);
    assert.equal(row.archetype, "tavern");
    assert.equal(row.name, "Godot IT Tavern");
    assert.equal(row.x, 111);
    assert.equal(row.z, 222);
    assert.equal(row.blueprint_dtu_id, dtuId);
    assert.equal(row.owner_id, userId);

    const dtuRow = db.prepare("SELECT id, owner_user_id, title FROM dtus WHERE id = ?").get(dtuId);
    assert.ok(dtuRow, "building-publish must also mint a real dtus row for the blueprint");
    assert.equal(dtuRow.owner_user_id, userId);
    assert.equal(dtuRow.title, "Godot IT Tavern");
  } finally { ws.close(); }
});

test("design_command rejects an unsupported action honestly (no fabricated success)", async () => {
  const { token } = await registerUser(`godotit_${TS}_l`);
  const ws = await connect(WS_URL);
  try {
    sendMsg(ws, "auth", { token });
    await nextFrame(ws); // hello

    // "game-delete" is a real gamedesign.js macro, but NOT in the curated
    // design_command allow-list yet — proves the allow-list actually
    // constrains dispatch instead of forwarding any (domain, action) pair.
    sendMsg(ws, "design_command", { action: "game-delete", params: { id: "does-not-exist" } });
    const frame = await nextFrame(ws);
    assert.equal(frame.evt, "design_command:result");
    assert.equal(frame.data.ok, false);
    assert.equal(frame.data.error, "unsupported_action");
    assert.equal(frame.data.action, "game-delete");

    // A genuinely nonexistent macro name gets the same honest treatment.
    sendMsg(ws, "design_command", { action: "totally-made-up-macro", params: {} });
    const frame2 = await nextFrame(ws);
    assert.equal(frame2.data.ok, false);
    assert.equal(frame2.data.error, "unsupported_action");
  } finally { ws.close(); }
});

test("design_command surfaces a real handler-level rejection (level-create with an unknown gameId)", async () => {
  const { token } = await registerUser(`godotit_${TS}_m`);
  const ws = await connect(WS_URL);
  try {
    sendMsg(ws, "auth", { token });
    await nextFrame(ws); // hello

    sendMsg(ws, "design_command", { action: "level-create", params: { gameId: "no-such-game-id" } });
    const frame = await nextFrame(ws);
    assert.equal(frame.evt, "design_command:result");
    assert.equal(frame.data.action, "level-create");
    // This is the REAL gamedesign.js `level-create` handler's own honest
    // rejection ("game not found") — not the gateway's allow-list check —
    // proving the dispatch reaches genuine handler logic, not a stub.
    assert.equal(frame.data.ok, false);
    assert.equal(frame.data.error, "game not found");
  } finally { ws.close(); }
});

// ── API-key auth ─────────────────────────────────────────────────────────────

test("godot-ws auth handshake succeeds with a real apiKey (not just a bearer token)", async () => {
  const { userId } = await registerUser(`godotit_${TS}_i`);
  const rawApiKey = __TEST__.mintApiKeyForTest(userId);

  const ws = await connect(WS_URL);
  try {
    sendMsg(ws, "auth", { apiKey: rawApiKey });
    const hello = await nextFrame(ws);
    assert.equal(hello.evt, "hello");
    assert.equal(hello.data.authenticated, true);
    assert.equal(hello.data.userId, userId);
  } finally { ws.close(); }
});

test("apiKey auth rejects a bogus key honestly (invalid_api_key, no fabricated session)", async () => {
  const ws = await connect(WS_URL);
  try {
    sendMsg(ws, "auth", { apiKey: "not-a-real-key-at-all" });
    const err = await nextFrame(ws);
    assert.equal(err.evt, "auth:error");
    assert.equal(err.data.reason, "invalid_api_key");
  } finally { ws.close(); }
});
