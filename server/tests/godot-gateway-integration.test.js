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
