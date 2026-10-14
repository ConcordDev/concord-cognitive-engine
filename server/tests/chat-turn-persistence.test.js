/**
 * INC-SWEEP chat F1 — one plain send persists exactly one user turn and
 * one assistant reply, even when chat.respond is invoked twice (stream +
 * buffered fallback / raced retry).
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  chatTurnKey,
  coalesceChatTurn,
  findCompletedChatTurn,
  rememberCompletedChatTurn,
  recentDuplicateUserInDb,
  _resetChatTurnPipelineForTests,
  TURN_DEDUP_WINDOW_MS,
} from "../lib/chat/turn-pipeline.js";
import { persistChatTurn } from "../lib/chat-session-store.js";
import { readChatMessages } from "../lib/chat-messages-read.js";
import Database from "better-sqlite3";

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

describe("chat turn-pipeline helpers", () => {
  after(() => _resetChatTurnPipelineForTests());

  it("coalesceChatTurn joins concurrent callers on the same key", async () => {
    _resetChatTurnPipelineForTests();
    let runs = 0;
    const key = "t:sess:turn-1";
    const a = coalesceChatTurn(key, async () => {
      runs += 1;
      await new Promise((r) => setTimeout(r, 30));
      return { reply: "once" };
    });
    const b = coalesceChatTurn(key, async () => {
      runs += 1;
      return { reply: "twice" };
    });
    const [ra, rb] = await Promise.all([a, b]);
    assert.equal(runs, 1);
    assert.equal(ra.reply, "once");
    assert.equal(rb.reply, "once");
  });

  it("findCompletedChatTurn returns the prior assistant for the same prompt", () => {
    const sess = {
      messages: [
        { role: "user", content: "What is Concord?", ts: new Date(Date.now() - 1000).toISOString() },
        { role: "assistant", content: "A cognitive OS.", ts: new Date().toISOString() },
      ],
    };
    const hit = findCompletedChatTurn(sess, "What is Concord?");
    assert.equal(hit.reply, "A cognitive OS.");
    assert.equal(findCompletedChatTurn(sess, "something else"), null);
  });

  it("rememberCompletedChatTurn + clientTurnId short-circuits", () => {
    const sess = { messages: [] };
    rememberCompletedChatTurn(sess, "user-123", "cached reply");
    const hit = findCompletedChatTurn(sess, "ignored", { clientTurnId: "user-123" });
    assert.equal(hit.reply, "cached reply");
  });

  it("persistChatTurn does not double-insert the same user content", () => {
    const db = freshDb();
    const sessionId = "sess-dedupe";
    const prompt = "In one sentence, what is Concord?";
    persistChatTurn(db, sessionId, {
      ownerId: "u1",
      userMsg: { role: "user", content: prompt },
      assistantMsg: { role: "assistant", content: "Concord is a cognitive OS." },
    });
    persistChatTurn(db, sessionId, {
      ownerId: "u1",
      userMsg: { role: "user", content: prompt },
      assistantMsg: { role: "assistant", content: "Kitchen pipeline phantom." },
    });
    const rows = db.prepare(`SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY id`).all(sessionId);
    assert.equal(rows.filter((r) => r.role === "user").length, 1);
    assert.equal(rows.filter((r) => r.role === "assistant").length, 1);
    assert.equal(rows[1].content, "Concord is a cognitive OS.");
    assert.equal(recentDuplicateUserInDb(db, sessionId, prompt), true);
    assert.ok(TURN_DEDUP_WINDOW_MS > 0);
    assert.ok(chatTurnKey("s", { clientTurnId: "x", prompt: "p" }).startsWith("t:"));
  });
});

describe("chat.respond plain question: one user + one reply after double invoke", () => {
  let runMacro, ctx, STATE;

  before(async () => {
    const { macroRuntime } = await import("./depth/_harness.js");
    ({ runMacro, ctx, STATE } = await macroRuntime("chat-turn-persist-f1"));
  });

  it("send → reply → persist, then a retry with the same clientTurnId stays at 1+1", async () => {
    const sessionId = `sess-plain-${Date.now()}`;
    const prompt = "In one sentence, what is Concord? Reply only with that sentence.";
    const clientTurnId = `user-${Date.now()}`;

    const first = await runMacro("chat", "respond", {
      sessionId,
      prompt,
      clientTurnId,
      llm: false,
    }, ctx);
    assert.equal(first.ok, true, first?.error || first?.reply);
    assert.ok(String(first.reply || "").length > 0, "first reply must be non-empty");

    const second = await runMacro("chat", "respond", {
      sessionId,
      prompt,
      clientTurnId,
      llm: false,
    }, ctx);
    assert.equal(second.ok, true);
    assert.equal(second.deduped, true);
    assert.equal(String(second.reply || ""), String(first.reply || ""));

    const db = ctx.db || STATE.db || globalThis._concordSTATE?.db;
    assert.ok(db, "test harness must expose a db");
    const read = readChatMessages(db, { userId: ctx.actor.userId, sessionId });
    assert.equal(read.status, 200, read.body?.error);
    const msgs = read.body.messages || [];
    const users = msgs.filter((m) => m.role === "user");
    const assistants = msgs.filter((m) => m.role === "assistant");
    assert.equal(users.length, 1, `expected 1 user turn, got ${users.length}: ${JSON.stringify(msgs)}`);
    assert.equal(assistants.length, 1, `expected 1 assistant reply, got ${assistants.length}`);
    assert.equal(users[0].content, prompt);
  });
});
