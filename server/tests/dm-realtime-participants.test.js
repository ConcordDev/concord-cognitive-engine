// SB-15 (Mega Plan v2, Track B / SB-G3): DM realtime delivery only
// to the two participants — VERIFICATION pin.
//
// Premise (premise-sb15.md, enumerated first-hand): a DM send
// (social-layer sendMessage) produces exactly one realtime
// delivery — a body-free 'social:notification' ("New message from
// <senderId>", the message body is never in it) emitted to the
// RECIPIENT's own user: room, plus a push to the recipient's own
// devices. No broadcast or room-wide emit carries DM content or
// metadata anywhere in the tree. This suite proves the shape on
// the real server (godot-gateway full-boot harness): A sends B a
// DM through the real route; B receives exactly one dm
// notification carrying no body; C — joined only to its own
// user:C room — receives nothing at all; A receives no socket
// notification (the sender's receipt is the HTTP response).
// It fails the day any DM event is broadcast or bodied.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const TS = Date.now();
const PORT = 16800 + (process.pid % 400);
const API_BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = path.join(os.tmpdir(), `concord-sb15-data-${TS}`);
const STATE_PATH = path.join(os.tmpdir(), `concord-sb15-state-${TS}.json`);
const DB_PATH = path.join(os.tmpdir(), `concord-sb15-${TS}.db`);
const BODY = `sb15-secret-body-${TS}`;

let __TEST__ = null;
let ioClient = null;
try {
  ioClient = createRequire(new URL("../../concord-frontend/package.json", import.meta.url))("socket.io-client").io;
} catch { ioClient = null; }

const sockets = [];
let userA = null;
let userB = null;
let userC = null;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function registerUser(username) {
  const res = await fetch(`${API_BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username,
      email: `${username}@sb15.test`,
      password: "SB15_Test_12345!",
      dateOfBirth: "1990-01-01",
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json();
  assert.ok(res.ok, `register failed: ${JSON.stringify(data)}`);
  assert.ok(data.token && data.user?.id, "register returns token + user id");
  return { token: data.token, userId: data.user.id };
}

function connectSocket(token) {
  return new Promise((resolve, reject) => {
    const s = ioClient(API_BASE, {
      auth: { token },
      transports: ["websocket"],
      reconnection: false,
    });
    s.on("connect", () => { sockets.push(s); resolve(s); });
    s.on("connect_error", (e) => reject(e));
    setTimeout(() => reject(new Error("socket connect timeout")), 10_000);
  });
}

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.CONCORD_FORCE_LISTEN = "true";
  process.env.PORT = String(PORT);
  process.env.DATA_DIR = DATA_DIR;
  process.env.STATE_PATH = STATE_PATH;
  process.env.DB_PATH = DB_PATH;
  process.env.CONCORD_RATE_LIMIT_BYPASS = "1";
  process.env.CONCORD_LOAD_SHED_ENABLED = "0";

  const mod = await import("../server.js");
  __TEST__ = mod.__TEST__;

  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(2_000) });
      if (res.ok) break;
    } catch { /* still booting */ }
    if (Date.now() > deadline) throw new Error("real server did not become ready on /health");
    await wait(300);
  }

  userA = await registerUser(`sb15_${TS}_a`);
  userB = await registerUser(`sb15_${TS}_b`);
  userC = await registerUser(`sb15_${TS}_c`);
});

after(async () => {
  for (const s of sockets) { try { s.close(); } catch { /* best-effort */ } }
  try { await __TEST__?.terminateAllWorkersForTest?.(); } catch { /* best-effort */ }
  try { __TEST__?.clearActiveTimersForTest?.(); } catch { /* best-effort */ }
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* best-effort */ }
  try { fs.unlinkSync(STATE_PATH); } catch { /* best-effort */ }
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    try { fs.unlinkSync(DB_PATH + suffix); } catch { /* best-effort */ }
  }
  try {
    const handles = process._getActiveHandles ? process._getActiveHandles() : [];
    for (const h of handles) { if (h && typeof h.unref === "function") h.unref(); }
  } catch { /* best-effort */ }
  const watchdog = setTimeout(() => { process.exit(process.exitCode ?? 0); }, 300);
  watchdog.unref();
});

const skip = ioClient ? false : "socket.io-client not installed";

test("an A→B DM notifies B exactly once, body-free; A and C receive nothing", { skip }, async () => {
  const sockA = await connectSocket(userA.token);
  const sockB = await connectSocket(userB.token);
  const sockC = await connectSocket(userC.token);
  const evA = []; const evB = []; const evC = [];
  sockA.onAny((name, payload) => evA.push({ name, payload }));
  sockB.onAny((name, payload) => evB.push({ name, payload }));
  sockC.onAny((name, payload) => evC.push({ name, payload }));
  // Let connect-time frames (hello etc.) land, then start clean.
  await wait(500);
  evA.length = 0; evB.length = 0; evC.length = 0;

  const res = await fetch(`${API_BASE}/api/social/dm`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${userA.token}` },
    body: JSON.stringify({ toUserId: userB.userId, content: BODY }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json();
  assert.ok(res.ok && data?.ok !== false, `DM send failed: ${JSON.stringify(data)}`);

  await wait(900);

  const bNotifs = evB.filter((e) => e.name === "social:notification");
  assert.equal(bNotifs.length, 1, "the recipient receives exactly one notification");
  const notif = bNotifs[0].payload?.notification;
  assert.ok(notif, "the event carries a notification");
  assert.equal(notif.type, "dm");
  assert.equal(notif.fromUserId, userA.userId);
  assert.ok(!JSON.stringify(bNotifs[0].payload).includes(BODY), "the notification carries no message body");

  assert.equal(evA.filter((e) => e.name === "social:notification").length, 0, "the sender receives no socket notification");
  assert.equal(evC.length, 0, "the third party receives no events at all");
  assert.ok(!JSON.stringify(evC).includes(BODY), "no DM content reaches the third party under any event name");
});
