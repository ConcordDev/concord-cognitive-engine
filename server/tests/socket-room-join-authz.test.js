// SB-04 (Mega Plan v2, Track B): socket room:join default-deny.
//
// The room:join handler used to check only session:/org:/astronomy:
// whiteboard: rooms and let every other room string through — including
// another user's per-user room (which carries that user's private
// realtime traffic) and any party room for a non-member. This suite
// boots the REAL server (the godot-gateway-integration harness shape:
// env-isolated import, /health poll, real registrations) and drives
// real socket.io clients against the real handler:
//   - a third party joining user:<victim> gets UNAUTHORIZED and does
//     NOT receive a test event emitted to the victim's room (on
//     pristine code the join succeeds and the event arrives);
//   - party:<id> requires current membership (getMyParty);
//   - session: requires owner or participant — an owner-less session
//     is no longer joinable, and participants named in participantIds
//     (the Set modern records carry) do join;
//   - world: keeps its standing rule; unknown prefixes are refused.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const TS = Date.now();
const PORT = 16400 + (process.pid % 400);
const API_BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = path.join(os.tmpdir(), `concord-sb04-data-${TS}`);
const STATE_PATH = path.join(os.tmpdir(), `concord-sb04-state-${TS}.json`);
const DB_PATH = path.join(os.tmpdir(), `concord-sb04-${TS}.db`);

let __TEST__ = null;
let ioClient = null;
try {
  ioClient = createRequire(new URL("../../concord-frontend/package.json", import.meta.url))("socket.io-client").io;
} catch { ioClient = null; }

const sockets = [];
let userA = null; // victim / owner / party leader
let userC = null; // third party
let partyId = null;

async function registerUser(username) {
  const res = await fetch(`${API_BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username,
      email: `${username}@sb04.test`,
      password: "SB04_Test_12345!",
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

// Emit room:join and settle on the handler's verdict for that room:
// 'joined' (room:joined ack), 'error' (an error frame), or 'timeout'.
function joinOutcome(socket, room, timeoutMs = 4_000) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      socket.off("room:joined", onJoined);
      socket.off("error", onError);
      resolve(v);
    };
    const onJoined = (p) => { if (p?.room === room) done("joined"); };
    const onError = (p) => done(p?.code === "UNAUTHORIZED" ? "unauthorized" : "error");
    socket.on("room:joined", onJoined);
    socket.on("error", onError);
    socket.emit("room:join", { room });
    setTimeout(() => done("timeout"), timeoutMs);
  });
}

function collectEvents(socket, name) {
  const got = [];
  socket.on(name, (p) => got.push(p));
  return got;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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

  userA = await registerUser(`sb04_${TS}_a`);
  userC = await registerUser(`sb04_${TS}_c`);

  // A's party, created through the platform's own lib on the server's db.
  const { createParty } = await import("../lib/parties.js");
  const created = createParty(__TEST__.db, userA.userId, { name: "SB04 Party" });
  assert.ok(created?.ok && created.partyId, `createParty: ${JSON.stringify(created)}`);
  partyId = created.partyId;

  // Sessions in the modern record shape.
  __TEST__.STATE.sessions.set("sb04-sess-a", {
    ownerId: userA.userId,
    participantIds: new Set([userA.userId]),
    createdAt: new Date().toISOString(),
    messages: [],
  });
  __TEST__.STATE.sessions.set("sb04-sess-shared", {
    ownerId: userA.userId,
    participantIds: new Set([userA.userId, userC.userId]),
    createdAt: new Date().toISOString(),
    messages: [],
  });
  __TEST__.STATE.sessions.set("sb04-sess-ownerless", {
    ownerId: null,
    participantIds: new Set(),
    createdAt: new Date().toISOString(),
    messages: [{ role: "user", content: "anonymous session content" }],
  });
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

test("user:<id> — a third party is refused and receives nothing; the owner is allowed", { skip }, async () => {
  const sockA = await connectSocket(userA.token);
  const sockC = await connectSocket(userC.token);
  const aEvents = collectEvents(sockA, "sb04:test-event");
  const cEvents = collectEvents(sockC, "sb04:test-event");

  assert.equal(await joinOutcome(sockA, `user:${userA.userId}`), "joined");
  assert.equal(await joinOutcome(sockC, `user:${userA.userId}`), "unauthorized");

  const io = globalThis._concordREALTIME?.io;
  assert.ok(io, "realtime io is live");
  io.to(`user:${userA.userId}`).emit("sb04:test-event", { n: 1 });
  await wait(600);
  assert.equal(aEvents.length, 1, "the owner receives their own room's event");
  assert.equal(cEvents.length, 0, "the refused third party receives nothing");
});

test("party:<id> — a non-member is refused; the member is allowed", { skip }, async () => {
  const sockA = await connectSocket(userA.token);
  const sockC = await connectSocket(userC.token);
  assert.equal(await joinOutcome(sockC, `party:${partyId}`), "unauthorized");
  assert.equal(await joinOutcome(sockA, `party:${partyId}`), "joined");
});

test("session: — owner or participant only; the owner-less allow is gone", { skip }, async () => {
  const sockA = await connectSocket(userA.token);
  const sockC = await connectSocket(userC.token);
  assert.equal(await joinOutcome(sockC, "session:sb04-sess-a"), "unauthorized");
  assert.equal(await joinOutcome(sockA, "session:sb04-sess-a"), "joined");
  assert.equal(await joinOutcome(sockC, "session:sb04-sess-shared"), "joined", "a participantIds participant joins");
  assert.equal(await joinOutcome(sockC, "session:sb04-sess-ownerless"), "unauthorized", "owner-less sessions are no longer joinable");
  assert.equal(await joinOutcome(sockA, "session:sb04-sess-ownerless"), "unauthorized");
});

test("default-deny — world: keeps its rule; unknown prefixes are refused", { skip }, async () => {
  const sockC = await connectSocket(userC.token);
  assert.equal(await joinOutcome(sockC, "world:sb04-test"), "joined");
  assert.equal(await joinOutcome(sockC, "bogus:sb04-test"), "unauthorized");
  assert.equal(await joinOutcome(sockC, "bare-room-name"), "unauthorized");
});

// ── SB-04 twin leg: the subscribe handler ──────────────────────────
// subscribe joins session:<id> by the side door; its session leg must
// carry the same rule as room:join (owner or participant, no
// owner-less allow, participantIds read). The verdict signal is the
// UNAUTHORIZED frame plus room membership proven by event delivery —
// the trailing 'subscribed' ack fires either way.

// Emit subscribe and settle on the handler's verdict:
// 'unauthorized' (error frame), 'acked' (subscribed ack, no error),
// or 'timeout'.
function subscribeOutcome(socket, sessionId, timeoutMs = 4_000) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      socket.off("subscribed", onAck);
      socket.off("error", onError);
      resolve(v);
    };
    const onAck = () => done("acked");
    const onError = (p) => done(p?.code === "UNAUTHORIZED" ? "unauthorized" : "error");
    socket.on("subscribed", onAck);
    socket.on("error", onError);
    socket.emit("subscribe", { sessionId });
    setTimeout(() => done("timeout"), timeoutMs);
  });
}

test("subscribe twin — a third party is refused and receives nothing; the owner is in", { skip }, async () => {
  const sockA = await connectSocket(userA.token);
  const sockC = await connectSocket(userC.token);
  const aEvents = collectEvents(sockA, "sb04:session-event");
  const cEvents = collectEvents(sockC, "sb04:session-event");

  assert.equal(await subscribeOutcome(sockC, "sb04-sess-a"), "unauthorized");
  assert.equal(await subscribeOutcome(sockA, "sb04-sess-a"), "acked");

  const io = globalThis._concordREALTIME?.io;
  assert.ok(io, "realtime io is live");
  io.to("session:sb04-sess-a").emit("sb04:session-event", { n: 1 });
  await wait(600);
  assert.equal(aEvents.length, 1, "the owner receives the session room's event");
  assert.equal(cEvents.length, 0, "the refused third party receives nothing");
});

test("subscribe twin — a participantIds participant subscribes; the owner-less allow is gone", { skip }, async () => {
  const sockA = await connectSocket(userA.token);
  const sockC = await connectSocket(userC.token);
  assert.equal(await subscribeOutcome(sockC, "sb04-sess-shared"), "acked", "a participantIds participant subscribes");
  assert.equal(await subscribeOutcome(sockC, "sb04-sess-ownerless"), "unauthorized", "owner-less sessions refuse the third party");
  assert.equal(await subscribeOutcome(sockA, "sb04-sess-ownerless"), "unauthorized", "owner-less sessions refuse everyone");
});
