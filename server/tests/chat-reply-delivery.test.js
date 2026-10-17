// Live finding (2026-10-17 ~09:04 ET): an event-loop stall on the host
// (10-48 s, both backend instances at once) made admission control shed
// polls with 503 (/api/system/health, /api/events/paginated, /api/lens/run).
// The chat turn itself completed and was saved at 13:04:10Z, but the chat
// lens never rendered it until a reload. The client now reads a lost reply
// back from GET /api/chat/messages; these pin the server half of that.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { readChatMessages } from "../lib/chat-messages-read.js";
import { classifyRequest, decideAdmission, PRIORITY } from "../lib/request-admission.js";

const here = path.dirname(fileURLToPath(import.meta.url));

function db() {
  const d = new Database(":memory:");
  d.exec(`
    CREATE TABLE chat_sessions (session_id TEXT PRIMARY KEY, owner_id TEXT, title TEXT, last_lens TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, msg_count INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, role TEXT NOT NULL,
      content TEXT NOT NULL, ts INTEGER NOT NULL, meta_json TEXT);
  `);
  return d;
}

describe("GET /api/chat/messages returns the newest turns", () => {
  it("a thread longer than the limit still includes the just-saved reply, oldest-first", () => {
    const d = db();
    d.prepare(`INSERT INTO chat_sessions (session_id, owner_id, created_at, updated_at) VALUES ('s1','ada',1,1)`).run();
    const ins = d.prepare(`INSERT INTO chat_messages (session_id, role, content, ts, meta_json) VALUES ('s1', ?, ?, ?, ?)`);
    for (let i = 0; i < 30; i++) ins.run(i % 2 ? "assistant" : "user", `m${i}`, 1000 + i, null);
    ins.run("user", "Remember this codeword: TANGERINE-42.", 5000, null);
    ins.run("assistant", "TANGERINE-42 recorded.", 5001, JSON.stringify({ clientTurnId: "user-1792242239895" }));
    const r = readChatMessages(d, { userId: "ada", sessionId: "s1", limit: 10 });
    assert.equal(r.status, 200);
    const msgs = r.body.messages;
    assert.equal(msgs.length, 10);
    assert.equal(msgs[msgs.length - 1].content, "TANGERINE-42 recorded.");
    assert.equal(msgs[msgs.length - 1].meta.clientTurnId, "user-1792242239895");
    const ts = msgs.map((m) => Date.parse(m.ts));
    assert.deepEqual(ts, [...ts].sort((a, b) => a - b));
  });
});

describe("chat.respond stamps clientTurnId on the saved assistant row", () => {
  it("both persist sites (LLM path and deterministic early returns) carry it", () => {
    const src = fs.readFileSync(path.join(here, "..", "server.js"), "utf8");
    assert.match(src, /clientTurnId: _clientTurnId \? String\(_clientTurnId\)\.slice\(0, 80\) : undefined/);
    assert.match(src, /meta: _clientTurnId \? \{ \.\.\.replyMeta, clientTurnId: String\(_clientTurnId\)\.slice\(0, 80\) \} : replyMeta/);
  });
});

describe("admission: the connection-banner health poll is never shed", () => {
  it("/api/system/health is CRITICAL; ordinary polls still shed under sustained lag", () => {
    assert.equal(classifyRequest({ path: "/api/system/health", user: { id: "u" } }), PRIORITY.CRITICAL);
    assert.equal(classifyRequest({ path: "/api/system/health" }), PRIORITY.CRITICAL);
    assert.equal(decideAdmission(PRIORITY.CRITICAL, 20000, { strikes: 9, strikesRequired: 3 }).admit, true);
    assert.equal(classifyRequest({ path: "/api/system/healthy-looking" }), PRIORITY.SHEDDABLE);
    assert.equal(classifyRequest({ path: "/api/events/paginated", user: { id: "u" } }), PRIORITY.PROTECTED);
    assert.equal(decideAdmission(PRIORITY.PROTECTED, 20000, { strikes: 9, strikesRequired: 3, shedLagMsProtected: 900 }).admit, false);
  });
});
