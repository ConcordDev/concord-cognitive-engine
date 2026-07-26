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
// Queued frame delivery, keyed per-socket. A naive "attach a 'message'
// listener, detach on first frame, repeat" pattern (this file's original
// shape) has a real race: if TWO frames arrive in the same synchronous
// flush (e.g. a broadcast landing back-to-back with a direct reply — exactly
// what dtu.create's global "dtu:created" broadcast does relative to a
// design_command:result reply, both below), the second message can fire
// before the NEXT await re-attaches a listener, and ws's EventEmitter drops
// an emit with zero listeners silently — no error, just a vanished frame,
// which reads as a mystery hang. Queuing every frame from ONE listener
// attached once per socket removes the window entirely: nothing is ever
// "in flight" waiting for a listener to exist.
const _frameQueues = new WeakMap();
function _queueFor(ws) {
  let q = _frameQueues.get(ws);
  if (!q) {
    q = { pending: [], waiters: [] };
    ws.on("message", (raw) => {
      let frame;
      try { frame = JSON.parse(raw.toString()); } catch { return; }
      const waiter = q.waiters.shift();
      if (waiter) waiter(frame);
      else q.pending.push(frame);
    });
    _frameQueues.set(ws, q);
  }
  return q;
}
function nextFrame(ws, timeoutMs = 5000) {
  const q = _queueFor(ws);
  if (q.pending.length > 0) return Promise.resolve(q.pending.shift());
  return new Promise((resolve, reject) => {
    let settled = false;
    const t = setTimeout(() => {
      if (settled) return;
      settled = true;
      const idx = q.waiters.indexOf(deliver);
      if (idx >= 0) q.waiters.splice(idx, 1);
      reject(new Error("nextFrame timeout"));
    }, timeoutMs);
    function deliver(frame) {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      resolve(frame);
    }
    q.waiters.push(deliver);
  });
}
function sendMsg(ws, evt, data) { ws.send(JSON.stringify({ evt, data })); }

// dtu.create broadcasts a global "dtu:created" event (realtimeEmit with no
// scope — every authenticated gateway client, including whichever one just
// triggered it, receives it). The D20 scene-save/scene-load tests below are
// the first ones in this file whose design_command dispatch calls through to
// a real dtu.create, so this is the first place that becomes visible: the
// broadcast can arrive interleaved with the direct design_command:result
// reply, in either order. Skips unrelated frames instead of assuming the
// very next queued frame is the one under test.
async function waitForEvt(ws, evtName, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`waitForEvt(${evtName}) timed out waiting`);
    const frame = await nextFrame(ws, remaining);
    if (frame.evt === evtName) return frame;
  }
}

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
    // waitForEvt (not a bare nextFrame) — the periodic ~100ms city:positions
    // presence broadcast (server/lib/city-presence.js) reaches every
    // authenticated client, this one included, and can legitimately land
    // between this send and its ack/nack reply.
    sendMsg(ws, "player:move", { cityId: "godot-it-move-world", x: 1, y: 0, z: 1, direction: 0 });
    const ack = await waitForEvt(ws, "player:move:ack");
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
    const nack = await waitForEvt(ws, "player:move:nack");
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

    // `combat:attack` USED to be the example cited here (before this unit
    // wired it — see the combat:attack test block below), which is exactly
    // why a genuinely-unhandled event name is used now instead of a stale
    // one: this test's job is proving the fallback branch still exists for
    // whatever the NEXT unwired event turns out to be, not pinning
    // combat:attack forever as "the unsupported one."
    sendMsg(ws, "totally:unhandled-evt-for-this-test", { targetId: "nope" });
    const frame = await nextFrame(ws);
    assert.equal(frame.evt, "error");
    assert.equal(frame.data.reason, "unsupported_evt");
    assert.equal(frame.data.evt, "totally:unhandled-evt-for-this-test");
  } finally { ws.close(); }
});

// ── combat:attack (this unit, 2026-07-25) ──────────────────────────────────
// Proves `combat:attack` frames sent BY the Godot client dispatch through the
// REAL server-authoritative combat resolution (cityPresence.applyAttack +
// the shared lib/combat-limits.js clamps) — not a fabricated hit, and not a
// parallel/laxer reimplementation of the anti-cheat math the socket.io PvP
// path and the HTTP NPC route both already enforce.

test("combat:attack in melee range reaches the real cityPresence.applyAttack resolution", async () => {
  const { token: attackerToken, userId: attackerId } = await registerUser(`godotit_${TS}_atk1`);
  const { token: targetToken, userId: targetId } = await registerUser(`godotit_${TS}_tgt1`);
  const attackerWs = await connect(WS_URL);
  const targetWs = await connect(WS_URL);
  try {
    sendMsg(attackerWs, "auth", { token: attackerToken });
    await nextFrame(attackerWs); // hello
    sendMsg(targetWs, "auth", { token: targetToken });
    await nextFrame(targetWs); // hello

    const cityId = `godot-it-combat-world-${TS}`;

    // Establish real cityPresence positions for BOTH combatants — applyAttack
    // requires the target to be a live entry in cityPresence's own state
    // (either _userPositions or _npcState), so a real player:move round trip
    // is the honest way to set this up, not a test-only backdoor.
    sendMsg(attackerWs, "player:move", { cityId, x: 0, y: 0, z: 0, direction: 0 });
    await waitForEvt(attackerWs, "player:move:ack");
    sendMsg(targetWs, "player:move", { cityId, x: 2, y: 0, z: 0, direction: 0 }); // 2m away — inside melee range
    await waitForEvt(targetWs, "player:move:ack");

    sendMsg(attackerWs, "combat:attack", { targetId, baseDamage: 20, range: 5, weapon: "sword" });
    const ack = await waitForEvt(attackerWs, "combat:attack:ack");

    assert.equal(ack.data.ok, true, `expected a successful hit: ${JSON.stringify(ack.data)}`);
    assert.equal(typeof ack.data.damage, "number");
    assert.ok(ack.data.damage > 0, "a real applyAttack hit should deal non-zero damage");
    assert.equal(typeof ack.data.targetHealth, "number");
    assert.ok(ack.data.targetHealth < ack.data.targetMaxHealth, "target health should be reduced by the real hit");
    // Never a fabricated number: computed damage must respect the shared
    // hard cap (no skillId → COMBAT_DAMAGE_HARD_CAP = 500) even though this
    // request declared a modest baseDamage of 20.
    assert.ok(ack.data.damage <= 500, "damage must respect the shared hard cap");
  } finally { attackerWs.close(); targetWs.close(); }
});

test("combat:attack out of reach is rejected by the real server-side reach check, not silently allowed", async () => {
  const { token: attackerToken, userId: attackerId } = await registerUser(`godotit_${TS}_atk2`);
  const { token: targetToken, userId: targetId } = await registerUser(`godotit_${TS}_tgt2`);
  const attackerWs = await connect(WS_URL);
  const targetWs = await connect(WS_URL);
  try {
    sendMsg(attackerWs, "auth", { token: attackerToken });
    await nextFrame(attackerWs); // hello
    sendMsg(targetWs, "auth", { token: targetToken });
    await nextFrame(targetWs); // hello

    const cityId = `godot-it-combat-reach-world-${TS}`;

    sendMsg(attackerWs, "player:move", { cityId, x: 0, y: 0, z: 0, direction: 0 });
    await waitForEvt(attackerWs, "player:move:ack");
    // 500m away — the client declares a `range` of 5m (clamped range would
    // allow it if honored), but the REAL distance is what applyAttack checks
    // against, so a modified client can't just claim a bigger range to hit
    // from across the map.
    sendMsg(targetWs, "player:move", { cityId, x: 500, y: 0, z: 0, direction: 0 });
    await waitForEvt(targetWs, "player:move:ack");

    sendMsg(attackerWs, "combat:attack", { targetId, baseDamage: 20, range: 5 });
    const ack = await waitForEvt(attackerWs, "combat:attack:ack");

    assert.equal(ack.data.ok, false, `expected an out-of-range rejection: ${JSON.stringify(ack.data)}`);
    assert.equal(ack.data.error, "out_of_range");
    assert.equal(typeof ack.data.distance, "number");
    assert.ok(ack.data.distance > 100, "the rejected distance should reflect the real 500m gap, not a fabricated small one");
  } finally { attackerWs.close(); targetWs.close(); }
});

test("combat:attack with an absurd client-declared baseDamage is still bounded by the shared hard cap", async () => {
  const { token: attackerToken, userId: attackerId } = await registerUser(`godotit_${TS}_atk3`);
  const { token: targetToken, userId: targetId } = await registerUser(`godotit_${TS}_tgt3`);
  const attackerWs = await connect(WS_URL);
  const targetWs = await connect(WS_URL);
  try {
    sendMsg(attackerWs, "auth", { token: attackerToken });
    await nextFrame(attackerWs); // hello
    sendMsg(targetWs, "auth", { token: targetToken });
    await nextFrame(targetWs); // hello

    const cityId = `godot-it-combat-cap-world-${TS}`;

    sendMsg(attackerWs, "player:move", { cityId, x: 0, y: 0, z: 0, direction: 0 });
    await waitForEvt(attackerWs, "player:move:ack");
    sendMsg(targetWs, "player:move", { cityId, x: 1, y: 0, z: 0, direction: 0 });
    await waitForEvt(targetWs, "player:move:ack");

    // A modified client declaring an absurd baseDamage (no skillId, so the
    // ceiling is the shared 500 hard cap) must still resolve at or below the
    // cap — proof clampBaseDamage/resolvedDamageCap actually gate this path,
    // not just the HTTP route and the socket.io path.
    sendMsg(attackerWs, "combat:attack", { targetId, baseDamage: 999999999, range: 5 });
    const ack = await waitForEvt(attackerWs, "combat:attack:ack");

    assert.equal(ack.data.ok, true, `expected a resolved (capped) hit: ${JSON.stringify(ack.data)}`);
    assert.ok(ack.data.damage <= 500, `damage should never exceed the shared hard cap: got ${ack.data.damage}`);
  } finally { attackerWs.close(); targetWs.close(); }
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

    // waitForEvt (not a bare nextFrame) — building-publish's own
    // "world:building-spawned" broadcast (and D19's auto-join means this
    // client is now IN that world's room) can legitimately land interleaved
    // with the direct design_command:result reply.
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
    const frame = await waitForEvt(ws, "design_command:result");
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

// ── D19/D20/D21 (Program B Phase 4 continuation, 2026-07-24) ────────────────
// D19: live system preview (a design_command action carrying a worldId
// auto-joins the client into that world's REAL room). D20: scene save/load
// via a real dtu.create/dtu.get DTU. D21: the design ⇄ playtest mode toggle,
// mirroring player:mode's ack/nack discipline.

test("D19 — a design_command action carrying a worldId auto-joins the client into that world's real room", async () => {
  const { token } = await registerUser(`godotit_${TS}_n`);
  const ws = await connect(WS_URL);
  const worldId = `godot-it-d19-world-${TS}`;
  try {
    sendMsg(ws, "auth", { token });
    await nextFrame(ws); // hello

    // Deliberately never sends room:join — the auto-join done by the
    // design_command dispatch (because building-publish's params carry a
    // worldId) is what's under test.
    sendMsg(ws, "design_command", {
      action: "building-publish",
      params: {
        archetype: "market",
        name: "D19 preview building",
        dimensions: { width: 6, height: 5, depth: 6 },
        worldId,
        position: { x: 5, y: 0, z: 5 },
      },
    });
    const publishFrame = await nextFrame(ws);
    assert.equal(publishFrame.data.ok, true, `building-publish should succeed: ${JSON.stringify(publishFrame.data)}`);

    // A REAL system event — the same combat:impact a live play-mode session
    // in this world would receive — fired via the real emitToWorld. This
    // reaches the client with NO explicit room:join frame ever sent, proving
    // the design_command dispatch itself performed the room join.
    const framePromise = nextFrame(ws);
    const r = __TEST__.emitToWorld(worldId, "combat:impact", {
      attackerId: "npc1", targetId: "npc2", severity: "rocked",
    });
    assert.equal(r.ok, true);
    const frame = await framePromise;
    assert.equal(frame.evt, "combat:impact");
    assert.equal(frame.data.severity, "rocked");
  } finally { ws.close(); }
});

test("D19 — a design_command action with NO worldId does not join any world room (no over-broad subscription)", async () => {
  const { token } = await registerUser(`godotit_${TS}_n2`);
  const ws = await connect(WS_URL);
  const worldId = `godot-it-d19-noleak-world-${TS}`;
  try {
    sendMsg(ws, "auth", { token });
    await nextFrame(ws); // hello

    sendMsg(ws, "design_command", { action: "game-create", params: { title: "D19 no-worldId game" } });
    const frame1 = await nextFrame(ws);
    assert.equal(frame1.data.ok, true);

    // No frame should arrive for this unrelated world within a short window —
    // the client was never joined to it.
    let sawIt = false;
    const onMsg = (raw) => {
      try { if (JSON.parse(raw.toString()).evt === "world:probe") sawIt = true; } catch { /* ignore */ }
    };
    ws.on("message", onMsg);
    __TEST__.emitToWorld(worldId, "world:probe", { n: 1 });
    await new Promise((r) => { setTimeout(r, 250); });
    ws.off("message", onMsg);
    assert.equal(sawIt, false, "a design_command with no worldId must not subscribe the client to any world room");
  } finally { ws.close(); }
});

test("D20 — scene-save/scene-load round-trips a level design (with a placed entity) through a real dtu.create/dtu.get DTU", async () => {
  const { token, userId } = await registerUser(`godotit_${TS}_o`);
  const ws = await connect(WS_URL);
  try {
    sendMsg(ws, "auth", { token });
    await nextFrame(ws); // hello

    sendMsg(ws, "design_command", { action: "game-create", params: { title: "D20 Test Game", genre: "puzzle" } });
    const gameFrame = await nextFrame(ws);
    assert.equal(gameFrame.data.ok, true, JSON.stringify(gameFrame.data));
    const gameId = gameFrame.data.result.game.id;

    sendMsg(ws, "design_command", {
      action: "entity-add",
      params: { gameId, name: "D20 Slime", kind: "enemy", health: 12, damage: 3, speed: 2 },
    });
    const entityFrame = await nextFrame(ws);
    assert.equal(entityFrame.data.ok, true, JSON.stringify(entityFrame.data));
    const entityId = entityFrame.data.result.entity.id;

    sendMsg(ws, "design_command", { action: "level-create", params: { gameId, name: "D20 Level", cols: 10, rows: 6 } });
    const levelFrame = await nextFrame(ws);
    assert.equal(levelFrame.data.ok, true, JSON.stringify(levelFrame.data));
    const levelId = levelFrame.data.result.level.id;

    // level-layer-add / level-object-add are real gamedesign.js macros but
    // are NOT in the curated design_command allow-list (D18 didn't extend
    // it that far) — dispatched directly the way an internal harness would,
    // purely to set up a level with a genuinely PLACED entity to snapshot.
    // scene-save/scene-load themselves (the thing under test) are still
    // exercised only via real design_command gateway frames below.
    const testReq = {
      user: { id: userId }, headers: {}, query: {}, method: "TEST",
      path: "/test", originalUrl: "/test", ip: "test", get: () => undefined,
    };
    const testCtx = __TEST__.makeCtx(testReq);
    const layerResult = await __TEST__.dispatchLensRun(
      "game-design", "level-layer-add", { levelId, kind: "object", name: "Actors" }, testCtx,
    );
    assert.equal(layerResult.ok, true, JSON.stringify(layerResult));
    const layerId = layerResult.result.layer.id;
    const objResult = await __TEST__.dispatchLensRun(
      "game-design", "level-object-add",
      { levelId, layerId, entityId, name: "Slime Spawn", x: 40, y: 60 }, testCtx,
    );
    assert.equal(objResult.ok, true, JSON.stringify(objResult));

    // ── Save ──
    // scene-save's dtu.create ALSO broadcasts a global "dtu:created" event
    // (realtimeEmit with no scope) that reaches this same client — waitForEvt
    // skips it instead of assuming the very next frame is the reply.
    sendMsg(ws, "design_command", { action: "scene-save", params: { levelId } });
    const saveFrame = await waitForEvt(ws, "design_command:result");
    assert.equal(saveFrame.evt, "design_command:result");
    assert.equal(saveFrame.data.ok, true, JSON.stringify(saveFrame.data));
    const dtuId = saveFrame.data.result.dtuId;
    assert.ok(dtuId, "scene-save should return a real dtu id");
    assert.equal(saveFrame.data.result.entityCount, 1);

    // Real effect OUTSIDE the dispatch path — a genuine STATE.dtus row from
    // the real dtu.create macro, not just an echoed response.
    const savedDtu = __TEST__.STATE.dtus.get(dtuId);
    assert.ok(savedDtu, "scene-save must leave a real STATE.dtus row (via the real dtu.create macro)");
    assert.equal(savedDtu.meta.type, "level_design");
    assert.equal(savedDtu.meta.level.cols, 10);
    assert.equal(savedDtu.meta.level.rows, 6);
    assert.equal(savedDtu.meta.entities.length, 1);
    assert.equal(savedDtu.meta.entities[0].name, "D20 Slime");

    // ── Load into a BRAND NEW game project (no gameId param passed) ──
    // scene-load itself only calls dtu.get (no broadcast), but a slightly
    // late-arriving "dtu:created" from the PRIOR scene-save could still be
    // in flight — waitForEvt stays safe either way.
    sendMsg(ws, "design_command", { action: "scene-load", params: { dtuId } });
    const loadFrame = await waitForEvt(ws, "design_command:result");
    assert.equal(loadFrame.data.ok, true, JSON.stringify(loadFrame.data));
    const restored = loadFrame.data.result;
    assert.equal(restored.entityCount, 1);
    assert.equal(restored.level.cols, 10);
    assert.equal(restored.level.rows, 6);
    assert.notEqual(restored.level.id, levelId, "scene-load creates a NEW level row, not a mutation of the original");
    assert.notEqual(restored.gameId, gameId, "no gameId param was passed, so scene-load creates a fresh game project");

    // The reconstructed object layer references a NEW (remapped) entity id —
    // never the original entityId, which only exists in the SOURCE game.
    const restoredObjLayer = restored.level.layers.find((l) => l.kind === "object");
    assert.ok(restoredObjLayer, "the reconstructed level should have its object layer back");
    assert.equal(restoredObjLayer.objects.length, 1);
    const restoredObj = restoredObjLayer.objects[0];
    assert.notEqual(restoredObj.entityId, entityId, "entityId must be remapped to a newly-created entity, not the stale original id");
    const restoredEntity = (__TEST__.STATE.gameDesignLens.entities.get(userId) || [])
      .find((e) => e.id === restoredObj.entityId);
    assert.ok(restoredEntity, "the remapped entityId should resolve to a real, newly-created entity row");
    assert.equal(restoredEntity.name, "D20 Slime");
    assert.equal(restoredEntity.health, 12);

    // The ORIGINAL level is untouched by the save/load round-trip.
    const originalStillThere = (__TEST__.STATE.gameDesignLens.levels.get(userId) || [])
      .find((l) => l.id === levelId);
    assert.ok(originalStillThere, "the original level must be unaffected by scene-save/scene-load");
  } finally { ws.close(); }
});

test("D20 — scene-load rejects a non-level-design DTU and an unauthorized private DTU honestly", async () => {
  const { token: tokenA, userId: userIdA } = await registerUser(`godotit_${TS}_q1`);
  const { token: tokenB } = await registerUser(`godotit_${TS}_q2`);
  const wsA = await connect(WS_URL);
  const wsB = await connect(WS_URL);
  try {
    sendMsg(wsA, "auth", { token: tokenA });
    await nextFrame(wsA); // hello
    sendMsg(wsB, "auth", { token: tokenB });
    await nextFrame(wsB); // hello

    // A real DTU that is NOT a level-design snapshot (created directly via
    // dtu.create, bypassing gamedesign.js entirely) must be rejected with a
    // specific, honest reason — never partially/incorrectly reconstructed.
    const testCtxA = __TEST__.makeCtx({
      user: { id: userIdA }, headers: {}, query: {}, method: "TEST",
      path: "/test", originalUrl: "/test", ip: "test", get: () => undefined,
    });
    const plainDtu = await __TEST__.dispatchLensRun("dtu", "create", {
      title: "Not a level",
      // Real structured content so this clears dtu.create's council gate
      // (its inner pipeline commit re-checks minScore=2 regardless of the
      // caller being user-initiated) — irrelevant to what's under test here
      // (scene-load's type check), just enough for an honest, real DTU.
      core: {
        definitions: ["A plain DTU with no level_design meta."],
        claims: ["This DTU intentionally carries no game-design meta.type."],
      },
    }, testCtxA);
    assert.equal(plainDtu.ok, true);
    // Real-DTU "dtu:created" broadcasts fan out to EVERY authenticated
    // gateway client (both wsA and wsB) — waitForEvt everywhere in this test
    // to stay robust to one of those landing between a send and its reply.
    sendMsg(wsA, "design_command", { action: "scene-load", params: { dtuId: plainDtu.dtu.id } });
    const wrongTypeFrame = await waitForEvt(wsA, "design_command:result");
    assert.equal(wrongTypeFrame.data.ok, false);
    assert.equal(wrongTypeFrame.data.error, "not_a_level_design_dtu");

    // User A saves a real (private-by-default) level design...
    sendMsg(wsA, "design_command", { action: "game-create", params: { title: "Private Game" } });
    const gameFrame = await waitForEvt(wsA, "design_command:result");
    const gameId = gameFrame.data.result.game.id;
    sendMsg(wsA, "design_command", { action: "level-create", params: { gameId, name: "Private Level" } });
    const levelFrame = await waitForEvt(wsA, "design_command:result");
    const levelId = levelFrame.data.result.level.id;
    sendMsg(wsA, "design_command", { action: "scene-save", params: { levelId } });
    const saveFrame = await waitForEvt(wsA, "design_command:result");
    assert.equal(saveFrame.data.ok, true, JSON.stringify(saveFrame.data));
    const dtuId = saveFrame.data.result.dtuId;
    assert.equal(__TEST__.STATE.dtus.get(dtuId).visibility, "private", "a level-design DTU defaults to private");

    // ...and User B (a different user) must be honestly rejected trying to
    // load it — never silently reconstructed for a non-owner.
    sendMsg(wsB, "design_command", { action: "scene-load", params: { dtuId } });
    const forbiddenFrame = await waitForEvt(wsB, "design_command:result");
    assert.equal(forbiddenFrame.data.ok, false);
    assert.equal(forbiddenFrame.data.error, "not_authorized");
  } finally { wsA.close(); wsB.close(); }
});

test("D21 — design:mode playtest toggle round-trips ack/nack over /godot-ws (mirrors player:mode's discipline)", async () => {
  const { token, userId } = await registerUser(`godotit_${TS}_p`);
  const ws = await connect(WS_URL);
  try {
    sendMsg(ws, "auth", { token });
    await nextFrame(ws); // hello

    // Exiting playtest before ever entering it is an honest nack, never a
    // silent no-op "success".
    sendMsg(ws, "design:mode", { mode: "design" });
    const earlyExitNack = await nextFrame(ws);
    assert.equal(earlyExitNack.evt, "design:mode:nack");
    assert.equal(earlyExitNack.data.reason, "not_in_playtest");

    // An unrecognized mode string nacks honestly too — never silently
    // coerced to one of the two real modes.
    sendMsg(ws, "design:mode", { mode: "spectator" });
    const badModeNack = await nextFrame(ws);
    assert.equal(badModeNack.evt, "design:mode:nack");
    assert.equal(badModeNack.data.reason, "unknown_mode");

    // Entering playtest for a level that doesn't exist is a real
    // handler-level rejection, not a fabricated ack.
    sendMsg(ws, "design:mode", { mode: "playtest", levelId: "no-such-level" });
    const badLevelNack = await nextFrame(ws);
    assert.equal(badLevelNack.evt, "design:mode:nack");
    assert.equal(badLevelNack.data.reason, "level not found");

    // Set up a real game + level to actually enter playtest for.
    sendMsg(ws, "design_command", { action: "game-create", params: { title: "D21 Test Game" } });
    const gameFrame = await nextFrame(ws);
    const gameId = gameFrame.data.result.game.id;
    sendMsg(ws, "design_command", { action: "level-create", params: { gameId, name: "D21 Level", cols: 8, rows: 8 } });
    const levelFrame = await nextFrame(ws);
    const levelId = levelFrame.data.result.level.id;

    sendMsg(ws, "design:mode", { mode: "playtest", levelId });
    const enterAck = await nextFrame(ws);
    assert.equal(enterAck.evt, "design:mode:ack");
    assert.equal(enterAck.data.mode, "playtest");
    assert.equal(enterAck.data.levelId, levelId);
    assert.equal(enterAck.data.gameId, gameId);
    assert.ok(enterAck.data.scene, "entering playtest should hand back the real compiled runtime scene");
    assert.equal(enterAck.data.scene.cols, 8);
    assert.equal(enterAck.data.scene.rows, 8);

    // Real, independently-queryable server-side effect — an active
    // playtest session for this user, not just an echoed ack.
    const session = __TEST__.STATE.gameDesignLens.playtestSessions.get(userId);
    assert.ok(session, "playtest-enter should open a real session in STATE.gameDesignLens.playtestSessions");
    assert.equal(session.levelId, levelId);

    // The level itself is untouched (still there, still editable) — the
    // playtest toggle never mutates the design.
    const stillEditable = (__TEST__.STATE.gameDesignLens.levels.get(userId) || [])
      .find((l) => l.id === levelId);
    assert.ok(stillEditable, "the level must remain fully present/editable in design mode after entering playtest");

    sendMsg(ws, "design:mode", { mode: "design" });
    const exitAck = await nextFrame(ws);
    assert.equal(exitAck.evt, "design:mode:ack");
    assert.equal(exitAck.data.mode, "design");
    assert.equal(exitAck.data.levelId, levelId);
    assert.equal(
      __TEST__.STATE.gameDesignLens.playtestSessions.get(userId), undefined,
      "exiting playtest must clear the session",
    );
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
