/**
 * Socket streaming chat context persistence (fix/chat-context-persist).
 *
 * The socket "chat:message" path used to keep turns only in memory, so a
 * backend restart or cache trim reset the conversation. It now loads saved
 * history from the chat session store when a session isn't in memory and
 * persists each user/assistant turn to SQLite. Also pins the hydrate fix:
 * load the NEWEST N messages, in chronological order.
 *
 * Run: node --test tests/chat-socket-session-persist.test.js
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

// HYDRATE_LIMIT is read at module load — set it before importing the store.
process.env.CONCORD_CHAT_HYDRATE_LIMIT = "4";
const { hydrateSession, persistChatMessage, upsertSession } = await import("../lib/chat-session-store.js");
const { ensureSocketChatSession, persistSocketChatTurn } = await import("../lib/chat/socket-session.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function freshDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE chat_sessions (
      session_id TEXT PRIMARY KEY, owner_id TEXT, title TEXT, last_lens TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, msg_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, role TEXT NOT NULL,
      content TEXT NOT NULL, ts INTEGER NOT NULL, meta_json TEXT
    );
  `);
  return db;
}
const freshState = () => ({ sessions: new Map() });

describe("hydrateSession loads the newest N messages in chronological order", () => {
  it("keeps the most recent turns when a session exceeds the limit", () => {
    const db = freshDb();
    upsertSession(db, "s-long", { ownerId: "u1" });
    const base = 1_700_000_000_000;
    for (let i = 1; i <= 10; i++) {
      persistChatMessage(db, "s-long", { role: i % 2 ? "user" : "assistant", content: `m${i}`, ts: base + i });
    }
    const STATE = freshState();
    assert.equal(hydrateSession(db, STATE, "s-long"), true);
    const msgs = STATE.sessions.get("s-long").messages.map((m) => m.content);
    assert.deepEqual(msgs, ["m7", "m8", "m9", "m10"]);
  });
});

describe("ensureSocketChatSession", () => {
  it("loads saved history from the store when the session isn't in memory", () => {
    const db = freshDb();
    persistSocketChatTurn(db, "s-1", { ownerId: "u1", userText: "My codeword is BLUE-HERON-42.", assistantText: "Noted." });
    const STATE = freshState();
    const r = ensureSocketChatSession(db, STATE, "s-1", { ownerId: "u1" });
    assert.equal(r.ok, true);
    assert.equal(r.hydrated, true);
    assert.deepEqual(r.session.messages.map((m) => [m.role, m.content]), [
      ["user", "My codeword is BLUE-HERON-42."],
      ["assistant", "Noted."],
    ]);
  });

  it("creates an empty owned session when the store doesn't know it", () => {
    const db = freshDb();
    const STATE = freshState();
    const r = ensureSocketChatSession(db, STATE, "s-new", { ownerId: "u1", now: () => "2026-10-17T00:00:00.000Z" });
    assert.equal(r.ok, true);
    assert.equal(r.hydrated, false);
    assert.equal(r.session.ownerId, "u1");
    assert.deepEqual(r.session.messages, []);
  });

  it("keeps the in-memory session when it is already loaded", () => {
    const db = freshDb();
    const STATE = freshState();
    const sess = { ownerId: null, messages: [{ role: "user", content: "x" }] };
    STATE.sessions.set("s-mem", sess);
    const r = ensureSocketChatSession(db, STATE, "s-mem", { ownerId: null });
    assert.equal(r.session, sess);
    assert.equal(r.hydrated, false);
  });

  it("refuses a signed-in caller addressing another user's saved session", () => {
    const db = freshDb();
    persistSocketChatTurn(db, "s-owned", { ownerId: "alice", userText: "secret", assistantText: "ok" });
    const r = ensureSocketChatSession(db, freshState(), "s-owned", { ownerId: "mallory" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "session_forbidden");
  });

  it("works with no db (memory only, never throws)", () => {
    const r = ensureSocketChatSession(null, freshState(), "s-nodb", {});
    assert.equal(r.ok, true);
    assert.equal(persistSocketChatTurn(null, "s-nodb", { userText: "a", assistantText: "b" }), false);
  });
});

describe("socket turns survive a restart", () => {
  it("multi-turn history persists and reloads into a fresh STATE", () => {
    const db = freshDb();
    let STATE = freshState();
    const turns = [
      ["My test codeword is BLUE-HERON-42. Just say noted.", "Noted."],
      ["What's 2+2?", "4"],
    ];
    let t = Date.now() - 10_000;
    for (const [u, a] of turns) {
      const { session } = ensureSocketChatSession(db, STATE, "s-restart", { ownerId: "u1" });
      const uTs = new Date(t += 10).toISOString();
      session.messages.push({ role: "user", content: u, ts: uTs });
      session.messages.push({ role: "assistant", content: a, ts: new Date(t += 10).toISOString() });
      persistSocketChatTurn(db, "s-restart", { ownerId: "u1", userText: u, userTs: uTs, assistantText: a, assistantTs: t });
    }
    assert.equal(db.prepare("SELECT count(*) c FROM chat_messages WHERE session_id='s-restart'").get().c, 4);

    STATE = freshState(); // simulated backend restart
    const r = ensureSocketChatSession(db, STATE, "s-restart", { ownerId: "u1" });
    assert.equal(r.hydrated, true);
    assert.deepEqual(r.session.messages.map((m) => m.content), [turns[0][0], turns[0][1], turns[1][0], turns[1][1]]);
    assert.equal(r.session.ownerId, "u1");
  });

  it("assistant row is ordered after its user row even with equal timestamps", () => {
    const db = freshDb();
    persistSocketChatTurn(db, "s-ts", { userText: "q", userTs: 5000, assistantText: "a", assistantTs: 5000 });
    const rows = db.prepare("SELECT role, ts FROM chat_messages WHERE session_id='s-ts' ORDER BY ts").all();
    assert.deepEqual(rows.map((r) => r.role), ["user", "assistant"]);
    assert.ok(rows[1].ts > rows[0].ts);
  });
});

describe("server.js socket chat:message wiring", () => {
  let handler;
  before(() => {
    const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
    const start = src.indexOf('socket.on("chat:message"');
    assert.ok(start > 0, "chat:message handler present");
    handler = src.slice(start, src.indexOf("// ===== END STREAMING PATH =====", start));
  });
  it("loads the session through ensureSocketChatSession (hydrates from SQLite)", () => {
    assert.match(handler, /ensureSocketChatSession\(/);
    assert.doesNotMatch(handler, /STATE\.sessions\.set\(sessionId/);
  });
  it("persists the completed turn with persistSocketChatTurn", () => {
    assert.match(handler, /persistSocketChatTurn\(/);
  });
});
