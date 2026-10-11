import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { readChatMessages } from "../lib/chat-messages-read.js";

function freshDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE chat_sessions (
      session_id TEXT PRIMARY KEY,
      owner_id TEXT,
      title TEXT,
      last_lens TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      msg_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      ts INTEGER NOT NULL,
      meta_json TEXT
    );
  `);
  return db;
}

describe("readChatMessages", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("returns an empty list for an unknown session instead of 404", () => {
    const r = readChatMessages(db, { userId: "ada", sessionId: "code-ai-ada" });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.deepEqual(r.body.messages, []);
    assert.equal(r.body.sessionId, "code-ai-ada");
  });

  it("returns the owner's messages after a reload of the same session", () => {
    const now = Date.now();
    db.prepare(`INSERT INTO chat_sessions (session_id, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?)`).run("code-ai-ada", "ada", now, now);
    db.prepare(`INSERT INTO chat_messages (session_id, role, content, ts, meta_json) VALUES (?, ?, ?, ?, ?)`).run("code-ai-ada", "user", "keep this", now, null);
    const r = readChatMessages(db, { userId: "ada", sessionId: "code-ai-ada" });
    assert.equal(r.status, 200);
    assert.equal(r.body.messages.length, 1);
    assert.equal(r.body.messages[0].content, "keep this");
    assert.equal(r.body.messages[0].role, "user");
  });

  it("rejects another owner with 403 and still requires a session id", () => {
    const now = Date.now();
    db.prepare(`INSERT INTO chat_sessions (session_id, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?)`).run("code-ai-ada", "ada", now, now);
    const forbidden = readChatMessages(db, { userId: "grace", sessionId: "code-ai-ada" });
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.body.error, "session_forbidden");
    assert.equal(readChatMessages(db, { userId: "ada", sessionId: "" }).status, 400);
    assert.equal(readChatMessages(db, { userId: "", sessionId: "x" }).status, 401);
  });
});
