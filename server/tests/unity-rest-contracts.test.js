/**
 * The REST routes Aura's Unity roadmap builds on (G-06 inventory/equip,
 * G-10 crafting, G-15 market, A-25 reputation, A-05 quests, C-35 loot bags),
 * hit over real HTTP on a real server with real auth. A probe of these on
 * 2026-10-26 found: equip 404'd for an item you own and succeeded for one you
 * don't; /sim/crafting/craft invented items; quest accept hid the quest from
 * every other player; quest event answered ok and recorded nothing. These pin
 * the fixed behaviour so the client tasks build on routes that work.
 *
 * Run: node --test tests/unity-rest-contracts.test.js
 */
import { test, before, after } from "node:test";
import assert from "node:assert";
import { WebSocket } from "ws";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const TS = Date.now();
const PORT = 16500 + (process.pid % 400);
const API_BASE = `http://127.0.0.1:${PORT}`;
const WS_URL = `ws://127.0.0.1:${PORT}/godot-ws`;

const DATA_DIR = path.join(os.tmpdir(), `concord-unity-rest-data-${TS}`);
const STATE_PATH = path.join(os.tmpdir(), `concord-unity-rest-state-${TS}.json`);
const DB_PATH = path.join(os.tmpdir(), `concord-unity-rest-${TS}.db`);

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
  // Under full-suite contention the event-loop-lag shedder can 503 a
  // registration call that has nothing to do with what this file tests (same
  // fix already applied to edge-cases-critical-paths.test.js, error-paths.test.js,
  // and the 7 e2e spawnServer() files).
  process.env.CONCORD_LOAD_SHED_ENABLED = "0";

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
// 5000ms was the original default. CI's own logs (both the real GH Actions
// runs failing this file and a local repro under the identical env vars)
// record real event_loop_lag_spike WARNs up to ~4.6s under full-suite
// contention — leaving as little as ~0.4s of actual round-trip budget
// before a real WebSocket auth+dispatch+reply cycle trips this timeout and
// surfaces as a plain assertion-shaped failure (the reject message never
// makes it into ci-tolerant's captured "not ok" summary line, which is why
// this read as a mysterious flake rather than an obvious timeout at first).
// Bumped to give real margin above the measured ceiling — same
// measured-floor-plus-margin discipline as this repo's other timeout/
// tolerance constants (see CANCEL_TOLERANCE / FLAKE_RERUN_MAX in
// scripts/ci-test-tolerant.mjs) — while staying well under the 180s
// isolated-rerun / 300s main-suite outer timeouts so a genuinely hung
// server still fails in reasonable time.
function nextFrame(ws, timeoutMs = 15000) {
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
// Same measured-lag-margin reasoning as nextFrame's default above.
async function waitForEvt(ws, evtName, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`waitForEvt(${evtName}) timed out waiting`);
    const frame = await nextFrame(ws, remaining);
    if (frame.evt === evtName) return frame;
  }
}

async function getDtuHttp(token, id) {
  const res = await fetch(`${API_BASE}/api/dtus/${encodeURIComponent(id)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.json();
  return { status: res.status, body };
}

async function lensRunHttp(token, domain, action, input) {
  const res = await fetch(`${API_BASE}/api/lens/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ domain, action, input }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.json();
  return { status: res.status, body };
}

async function registerUser(username) {
  const res = await fetch(`${API_BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username,
      email: `${username}@unity-rest.test`,
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


async function api(method, path, token, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, data };
}

test("inventory: equip an owned weapon and armour into the canonical loadout", async () => {
  const a = await registerUser(`urest_${TS}_eq`);
  const inv = `/api/world/sim/inventory/${a.userId}`;
  assert.equal((await api("POST", `${inv}/add`, a.token, { itemId: "it-sword", name: "Iron Sword", type: "weapon" })).status, 200);
  assert.equal((await api("POST", `${inv}/add`, a.token, { itemId: "it-coat", name: "Leather Coat", type: "armor" })).status, 200);

  const sword = await api("POST", `${inv}/equip`, a.token, { slot: "main_hand", itemId: "it-sword" });
  assert.equal(sword.status, 200, JSON.stringify(sword.data));
  assert.equal(sword.data.equipped.main_hand, "it-sword");
  const coat = await api("POST", `${inv}/equip`, a.token, { slot: "chest", itemId: "it-coat" });
  assert.equal(coat.status, 200, JSON.stringify(coat.data));
  assert.equal(coat.data.equipped.chest, "it-coat");

  // The canonical store combat and durability read.
  const eq = __TEST__.db.prepare("SELECT right_hand_id, body_id FROM player_equipment WHERE user_id = ?").get(a.userId);
  const ids = Object.fromEntries(__TEST__.db.prepare("SELECT item_id, id FROM player_inventory WHERE user_id = ?").all(a.userId).map((r) => [r.item_id, r.id]));
  assert.equal(eq.right_hand_id, ids["it-sword"]);
  assert.equal(eq.body_id, ids["it-coat"]);

  const after = await api("GET", inv, a.token);
  assert.deepEqual(after.data.inventory.items.map((i) => i.id).sort(), ["it-coat", "it-sword"], "equipping keeps the items in the bag");
  assert.equal(after.data.inventory.equipped.main_hand, "it-sword");
});

test("inventory: equipping an item you do not hold, or an unknown slot, is refused", async () => {
  const a = await registerUser(`urest_${TS}_no`);
  const inv = `/api/world/sim/inventory/${a.userId}`;
  const r = await api("POST", `${inv}/equip`, a.token, { slot: "off_hand", itemId: "never-owned" });
  assert.equal(r.status, 404);
  assert.equal(r.data.error, "item_not_owned");
  await api("POST", `${inv}/add`, a.token, { itemId: "it-boots", name: "Boots" });
  const feet = await api("POST", `${inv}/equip`, a.token, { slot: "feet", itemId: "it-boots" });
  assert.equal(feet.status, 400, "a slot the loadout has no column for is refused, not stored where nothing reads it");
  const after = await api("GET", inv, a.token);
  assert.deepEqual(after.data.inventory.equipped, {});
});

test("crafting: the sim craft route no longer invents an item", async () => {
  const a = await registerUser(`urest_${TS}_cr`);
  const r = await api("POST", "/api/world/sim/crafting/craft", a.token, { recipeId: "recipe-steel-column" });
  assert.equal(r.status, 410);
  assert.equal(r.data.error, "use_crafting_execute");
  const real = await api("POST", "/api/crafting/execute", a.token, { recipeId: "no-such-recipe", worldId: "concordia-hub" });
  assert.equal(real.data.ok, false, "the real path refuses a recipe the player does not have");
});

test("quests: accepting keeps the quest available to other players", async () => {
  const a = await registerUser(`urest_${TS}_qa`);
  const b = await registerUser(`urest_${TS}_qb`);
  const q = __TEST__.db.prepare("SELECT id, world_id FROM world_quests WHERE status = 'available' LIMIT 1").get();
  assert.ok(q, "seeded quests exist");
  const before = (await api("GET", `/api/worlds/${q.world_id}/quests`, b.token)).data.quests.map((x) => x.id);
  assert.ok(before.includes(q.id));

  const acc = await api("POST", `/api/worlds/${q.world_id}/quests/${q.id}/accept`, a.token);
  assert.equal(acc.status, 200, JSON.stringify(acc.data));
  assert.equal(acc.data.status, "active");
  assert.equal(acc.data.quest.id, q.id);
  assert.equal(__TEST__.db.prepare("SELECT status FROM world_quests WHERE id = ?").get(q.id).status, "available");
  const forB = (await api("GET", `/api/worlds/${q.world_id}/quests`, b.token)).data.quests.map((x) => x.id);
  assert.ok(forB.includes(q.id), "player B still sees the quest A accepted");

  const active = await api("GET", `/api/worlds/${q.world_id}/quests/active`, a.token);
  assert.deepEqual(active.data.quests.map((x) => x.id), [q.id]);
  const again = await api("POST", `/api/worlds/${q.world_id}/quests/${q.id}/accept`, a.token);
  assert.equal(again.data.already, true);

  const missing = await api("POST", `/api/worlds/${q.world_id}/quests/no_such_quest/accept`, a.token);
  assert.equal(missing.status, 404);
});

test("quests: the event route says it records nothing; complete/claim refuse unfinished work", async () => {
  const a = await registerUser(`urest_${TS}_qe`);
  const q = __TEST__.db.prepare("SELECT id, world_id FROM world_quests LIMIT 1").get();
  await api("POST", `/api/worlds/${q.world_id}/quests/${q.id}/accept`, a.token);
  const ev = await api("POST", `/api/worlds/${q.world_id}/quests/${q.id}/event`, a.token, { type: "kill", target: "x" });
  assert.equal(ev.status, 409);
  assert.equal(ev.data.error, "progress_recorded_by_server");
  assert.equal((await api("POST", `/api/worlds/${q.world_id}/quests/${q.id}/complete`, a.token)).status, 422);
  assert.equal((await api("POST", `/api/worlds/${q.world_id}/quests/${q.id}/claim-reward`, a.token)).status, 422);
});

test("market: a world's market is seeded from its universe and only lists what it sells", async () => {
  const a = await registerUser(`urest_${TS}_mk`);
  const world = __TEST__.db.prepare("SELECT id FROM worlds LIMIT 1").get()?.id;
  assert.ok(world, "a seeded world exists");
  const market = await api("GET", `/api/worlds/${world}/market`, a.token);
  assert.equal(market.status, 200);
  assert.ok(market.data.market.length > 0, "the first read seeds the world's market");
  const wood = market.data.market.find((m) => m.resource_id === "wood");
  assert.ok(wood, "common resources are listed");

  const fake = await api("POST", `/api/worlds/${world}/market/trade`, a.token, { type: "buy", resource_id: "legendary_sword", quantity: 1 });
  assert.equal(fake.status, 404, JSON.stringify(fake.data));
  assert.equal(fake.data.error, "not_sold_here");
  const held = __TEST__.db.prepare("SELECT COUNT(*) n FROM player_inventory WHERE user_id = ? AND item_id = 'legendary_sword'").get(a.userId);
  assert.equal(held.n, 0, "no item appears for a resource the market does not sell");

  const buy = await api("POST", `/api/worlds/${world}/market/trade`, a.token, { type: "buy", resource_id: "wood", quantity: 1 });
  if (buy.data.ok) assert.equal(buy.data.price, wood.computed_price, "the price is the market's own");
  else assert.equal(buy.data.error, "insufficient_credits");
});

test("reputation and loot bags answer with real (empty) state, not invented values", async () => {
  const a = await registerUser(`urest_${TS}_rp`);
  const rep = await api("GET", "/api/worlds/concordia-hub/reputation", a.token);
  assert.equal(rep.status, 200);
  assert.equal(rep.data.sample_size, 0);
  assert.equal(rep.data.tier, "neutral");
  const loot = await api("GET", "/api/worlds/concordia-hub/loot-bags", a.token);
  assert.equal(loot.status, 200);
  assert.deepEqual(loot.data.bags, []);
});
