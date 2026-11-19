// The server is the record for Chat (owner decision, 2026-11-19): a
// conversation is renamed on the server, and "Branch from here" copies the
// owner's own stored history up to one message into a new server session.
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up } from "../migrations/193_chat_sessions.js";
import { persistChatTurn, renameChatSession, forkChatSession, listRecentSessions, hydrateSession } from "../lib/chat-session-store.js";
import { readChatMessages } from "../lib/chat-messages-read.js";

function db() { const d = new Database(":memory:"); up(d); return d; }
function thread(d, sid = "s1", owner = "u1") {
  persistChatTurn(d, sid, { ownerId: owner, userMsg: { role: "user", content: "What is a shear wall?", ts: 1 }, assistantMsg: { role: "assistant", content: "A wall that resists lateral load.", ts: 2 } });
  persistChatTurn(d, sid, { ownerId: owner, userMsg: { role: "user", content: "And openings?", ts: 3 }, assistantMsg: { role: "assistant", content: "They reduce capacity.", ts: 4 } });
}

test("rename: owner only, trimmed and capped, empty refused", () => {
  const d = db(); thread(d);
  assert.deepEqual(renameChatSession(d, "s1", "u2", "Mine now"), { ok: false, error: "forbidden" });
  assert.deepEqual(renameChatSession(d, "s1", "u1", "   "), { ok: false, error: "invalid_title" });
  assert.deepEqual(renameChatSession(d, "nope", "u1", "x"), { ok: false, error: "not_found" });
  const r = renameChatSession(d, "s1", "u1", "  Shear   walls \n notes ");
  assert.deepEqual(r, { ok: true, title: "Shear walls notes" });
  assert.equal(renameChatSession(d, "s1", "u1", "x".repeat(300)).title.length, 80);
  assert.equal(listRecentSessions(d, "u1")[0].title.length, 80);
});

test("messages carry their row id, which is what a branch points at", () => {
  const d = db(); thread(d);
  const read = readChatMessages(d, { userId: "u1", sessionId: "s1" });
  assert.deepEqual(read.body.messages.map((m) => [m.role, typeof m.id]), [["user", "number"], ["assistant", "number"], ["user", "number"], ["assistant", "number"]]);
});

test("branch from here copies the owner's history up to that message into a new session", () => {
  const d = db(); thread(d);
  const msgs = readChatMessages(d, { userId: "u1", sessionId: "s1" }).body.messages;
  const at = msgs[1].id; // the first reply
  const f = forkChatSession(d, { sessionId: "s1", ownerId: "u1", uptoId: at, newSessionId: "s1-fork" });
  assert.equal(f.ok, true, JSON.stringify(f));
  assert.equal(f.copied, 2);
  assert.equal(f.title, "↳ What is a shear wall?");
  const copy = readChatMessages(d, { userId: "u1", sessionId: "s1-fork" }).body.messages;
  assert.deepEqual(copy.map((m) => m.content), ["What is a shear wall?", "A wall that resists lateral load."]);
  assert.equal(readChatMessages(d, { userId: "u1", sessionId: "s1" }).body.messages.length, 4, "the original thread is untouched");
  const STATE = { sessions: new Map() };
  assert.equal(hydrateSession(d, STATE, "s1-fork"), true);
  assert.equal(STATE.sessions.get("s1-fork").messages.length, 2, "the model sees the branch's history on its next turn");
  assert.equal(STATE.sessions.get("s1-fork").ownerId, "u1");
});

test("a branch is refused across accounts, from another thread's message, or over an existing session", () => {
  const d = db(); thread(d, "s1", "u1"); thread(d, "s2", "u2");
  const mine = readChatMessages(d, { userId: "u1", sessionId: "s1" }).body.messages;
  const theirs = readChatMessages(d, { userId: "u2", sessionId: "s2" }).body.messages;
  assert.equal(forkChatSession(d, { sessionId: "s2", ownerId: "u1", uptoId: theirs[0].id, newSessionId: "x1" }).error, "forbidden");
  assert.equal(forkChatSession(d, { sessionId: "s1", ownerId: "u1", uptoId: theirs[3].id, newSessionId: "x2" }).error, "message_not_in_session", "you cannot pull another thread's messages into yours");
  assert.equal(forkChatSession(d, { sessionId: "s1", ownerId: "u1", uptoId: "abc", newSessionId: "x3" }).error, "invalid_message");
  assert.equal(forkChatSession(d, { sessionId: "s1", ownerId: "u1", uptoId: mine[0].id, newSessionId: "s2" }).error, "session_exists");
  assert.equal(readChatMessages(d, { userId: "u2", sessionId: "s2" }).body.messages.length, 4, "the other account's thread is untouched");
});
