// Domain-wiring pin for chat.reverify-receipts: the macro registers
// through the real chat domain registrar (incl. the anon-write guard),
// resolves the caller + db the way prod does, and returns the lib's
// verdict. The lib's own legs are pinned in chat-reverify-receipts.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import registerChatActions from "../domains/chat.js";
import { routeComputeQuestion, composeRoutedReply } from "../lib/chat/compute-router.js";

function captureRegistry() {
  const actions = new Map();
  registerChatActions((domain, name, fn) => actions.set(`${domain}.${name}`, fn));
  return actions;
}

function seedDb() {
  const d = new DatabaseSync(":memory:");
  d.exec(`CREATE TABLE chat_sessions (session_id TEXT PRIMARY KEY, owner_id TEXT, title TEXT, msg_count INTEGER DEFAULT 0, updated_at INTEGER)`);
  d.exec(`CREATE TABLE chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, role TEXT, content TEXT, ts INTEGER, meta_json TEXT)`);
  d.exec(`CREATE TABLE dtu_store (id TEXT PRIMARY KEY, data TEXT)`);
  d.exec(`CREATE TABLE dtu_store_archive (id TEXT PRIMARY KEY, data TEXT)`);
  const q = "What is 17 × 24?";
  const routed = routeComputeQuestion(q);
  d.prepare(`INSERT INTO chat_sessions (session_id, owner_id) VALUES ('s1', 'u1')`).run();
  d.prepare(`INSERT INTO chat_messages (session_id, role, content, ts, meta_json) VALUES ('s1', 'user', ?, 1000, NULL)`).run(q);
  const meta = { toolCalls: [{ tool: "compute_router", ok: true, route: routed.route, engine: routed.engine, result: routed.value }] };
  d.prepare(`INSERT INTO chat_messages (session_id, role, content, ts, meta_json) VALUES ('s1', 'assistant', ?, 2000, ?)`).run(composeRoutedReply(routed), JSON.stringify(meta));
  return d;
}

test("chat.reverify-receipts is registered and re-verifies for the owner", async () => {
  const actions = captureRegistry();
  const fn = actions.get("chat.reverify-receipts");
  assert.equal(typeof fn, "function");
  globalThis._concordSTATE = { db: seedDb() };
  try {
    const out = await fn({ actor: { userId: "u1" } }, { data: {} }, { sessionId: "s1", messageTs: 2000 });
    assert.equal(out.ok, true);
    assert.equal(out.result.found, true);
    assert.equal(out.result.legs.find((l) => l.leg === "solver").status, "reproduced");
  } finally {
    delete globalThis._concordSTATE;
  }
});

test("chat.reverify-receipts refuses a non-owner through the macro", async () => {
  const actions = captureRegistry();
  const fn = actions.get("chat.reverify-receipts");
  globalThis._concordSTATE = { db: seedDb() };
  try {
    const out = await fn({ actor: { userId: "u2" } }, { data: {} }, { sessionId: "s1", messageTs: 2000 });
    assert.equal(out.ok, false);
    assert.equal(out.error, "session_forbidden");
  } finally {
    delete globalThis._concordSTATE;
  }
});
