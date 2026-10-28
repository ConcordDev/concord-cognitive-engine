// F4 (Product Chat review 2026-10-28): a fresh conversation with exactly
// one user message + one assistant reply listed as "3 messages".
// The sessions list must report the number of user-visible messages —
// derived from chat_messages rows, never from the drift-prone stored
// msg_count counter (bumped by several persist paths).
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up } from "../migrations/193_chat_sessions.js";
import { persistChatTurn, persistChatMessage, listRecentSessions } from "../lib/chat-session-store.js";

function db() { const d = new Database(":memory:"); up(d); return d; }

test("one exchange lists as exactly 2 messages", () => {
  const d = db();
  persistChatTurn(d, "s1", {
    ownerId: "u1",
    userMsg: { role: "user", content: "Explain what a DTU is in two sentences.", ts: 1 },
    assistantMsg: { role: "assistant", content: "A DTU is ...", ts: 2 },
  });
  const rows = listRecentSessions(d, "u1");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].msg_count, 2);
});

test("a drifted stored counter does not leak into the listed count", () => {
  const d = db();
  persistChatTurn(d, "s1", {
    ownerId: "u1",
    userMsg: { role: "user", content: "hi", ts: 1 },
    assistantMsg: { role: "assistant", content: "yo", ts: 2 },
  });
  // Simulate the multi-writer drift the counter suffers in prod.
  d.prepare("UPDATE chat_sessions SET msg_count = 99 WHERE session_id = 's1'").run();
  assert.equal(listRecentSessions(d, "u1")[0].msg_count, 2);
});

test("non-visible rows do not count; later visible turns do", () => {
  const d = db();
  persistChatTurn(d, "s1", {
    ownerId: "u1",
    userMsg: { role: "user", content: "hi", ts: 1 },
    assistantMsg: { role: "assistant", content: "yo", ts: 2 },
  });
  d.prepare("INSERT INTO chat_messages (session_id, role, content, ts) VALUES ('s1', 'system', 'internal note', 3)").run();
  assert.equal(listRecentSessions(d, "u1")[0].msg_count, 2);
  // A long-task follow-up persists as an assistant row — user-visible.
  persistChatMessage(d, "s1", { role: "assistant", content: "background result", ts: 4 });
  assert.equal(listRecentSessions(d, "u1")[0].msg_count, 3);
});

test("counts are per-owner and per-session", () => {
  const d = db();
  persistChatTurn(d, "s1", {
    ownerId: "u1",
    userMsg: { role: "user", content: "a", ts: 1 },
    assistantMsg: { role: "assistant", content: "b", ts: 2 },
  });
  persistChatTurn(d, "s2", {
    ownerId: "u1",
    userMsg: { role: "user", content: "c", ts: 3 },
    assistantMsg: { role: "assistant", content: "d", ts: 4 },
  });
  persistChatMessage(d, "s2", { role: "user", content: "e", ts: 5 });
  const rows = listRecentSessions(d, "u1");
  const byId = Object.fromEntries(rows.map((r) => [r.id, r.msg_count]));
  assert.equal(byId.s1, 2);
  assert.equal(byId.s2, 3);
  assert.equal(listRecentSessions(d, "u2").length, 0);
});
