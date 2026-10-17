// Chat "delete conversation" removes the persisted session (owner-scoped), and
// Chat artifacts survive a reload (chat-par 2026-10-17).
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up } from "../migrations/193_chat_sessions.js";
import { persistChatTurn, deleteChatSession, listRecentSessions } from "../lib/chat-session-store.js";

function db() { const d = new Database(":memory:"); up(d); return d; }

test("owner deletes a session and its messages; others cannot", () => {
  const d = db();
  persistChatTurn(d, "s1", { ownerId: "u1", userMsg: { role: "user", content: "hi", ts: 1 }, assistantMsg: { role: "assistant", content: "yo", ts: 2 } });
  assert.deepEqual(deleteChatSession(d, "s1", "u2"), { ok: false, error: "forbidden" });
  const r = deleteChatSession(d, "s1", "u1");
  assert.equal(r.ok, true);
  assert.equal(r.deleted, 2);
  assert.equal(listRecentSessions(d, "u1").length, 0);
  assert.deepEqual(deleteChatSession(d, "s1", "u1"), { ok: false, error: "not_found" });
});

test("artifacts and agentRoute persist with the assistant message", () => {
  const d = db();
  const song = { kind: "song", projectId: "p1", title: "T", song: { notes: [1, 2, 3] } };
  const huge = { kind: "image", url: "data:image/png;base64," + "A".repeat(70000) };
  persistChatTurn(d, "s2", { ownerId: "u1", userMsg: { role: "user", content: "song", ts: 1 }, assistantMsg: { role: "assistant", content: "ready", ts: 2, meta: { agentRoute: "music", artifacts: [song, huge] } } });
  const row = d.prepare("SELECT meta_json FROM chat_messages WHERE role='assistant'").get();
  const meta = JSON.parse(row.meta_json);
  assert.equal(meta.agentRoute, "music");
  assert.deepEqual(meta.artifacts, [song]);
});
