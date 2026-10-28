// One-click re-verify (Product Chat F2/A6 + §9 rule-2b closure note).
// Pins reverifyReceipts against a real SQLite store: the solver leg
// re-runs the deterministic router on the stored question, the sources
// leg re-resolves stored URLs (fetch injected — no network), the DTU
// leg re-checks the live store. Ownership mirrors chat-messages-read.
//
// Uses node:sqlite (built into Node ≥22) instead of better-sqlite3 so
// the suite runs in any checkout; reverifyReceipts only relies on the
// prepare/get surface both drivers share.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { reverifyReceipts } from "../lib/chat/reverify-receipts.js";
import { routeComputeQuestion, composeRoutedReply } from "../lib/chat/compute-router.js";

function db() {
  const d = new DatabaseSync(":memory:");
  d.exec(`CREATE TABLE chat_sessions (session_id TEXT PRIMARY KEY, owner_id TEXT, title TEXT, msg_count INTEGER DEFAULT 0, updated_at INTEGER)`);
  d.exec(`CREATE TABLE chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, role TEXT, content TEXT, ts INTEGER, meta_json TEXT)`);
  d.exec(`CREATE TABLE dtu_store (id TEXT PRIMARY KEY, data TEXT)`);
  d.exec(`CREATE TABLE dtu_store_archive (id TEXT PRIMARY KEY, data TEXT)`);
  return d;
}

const okFetch = async () => ({ status: 200 });

function seedComputed(d, { tamperResult = null } = {}) {
  const q = "What is 17 × 24?";
  const routed = routeComputeQuestion(q);
  assert.ok(routed, "fixture question must route deterministically");
  const storedResult = tamperResult ?? routed.value;
  d.prepare(`INSERT INTO chat_sessions (session_id, owner_id) VALUES ('s1', 'u1')`).run();
  d.prepare(`INSERT INTO chat_messages (session_id, role, content, ts, meta_json) VALUES ('s1', 'user', ?, 1000, NULL)`).run(q);
  const meta = {
    toolCalls: [{ tool: "compute_router", ok: true, route: routed.route, engine: routed.engine, result: storedResult }],
    sources: [{ url: "https://example.com/a", title: "A" }],
    dtuRefs: [{ id: "dtu_1", title: "Kept" }, { id: "dtu_2", title: "Gone" }],
  };
  d.prepare(`INSERT INTO chat_messages (session_id, role, content, ts, meta_json) VALUES ('s1', 'assistant', ?, 2000, ?)`).run(composeRoutedReply(routed), JSON.stringify(meta));
  d.prepare(`INSERT INTO dtu_store (id, data) VALUES ('dtu_1', '{}')`).run();
  return routed;
}

test("reproduces the solver check, resolves sources, and reports the missing DTU", async () => {
  const d = db();
  seedComputed(d);
  const { status, body } = await reverifyReceipts(d, { userId: "u1", sessionId: "s1", messageTs: 2000, fetchImpl: okFetch });
  assert.equal(status, 200);
  assert.equal(body.found, true);
  const solver = body.legs.find((l) => l.leg === "solver");
  assert.equal(solver.status, "reproduced");
  const sources = body.legs.find((l) => l.leg === "sources");
  assert.equal(sources.status, "all-resolve");
  const dtus = body.legs.find((l) => l.leg === "dtus");
  assert.equal(dtus.status, "some-missing");
  assert.match(dtus.detail, /1\/2 cited DTUs/);
});

test("a tampered stored result reads as diverged, with both values named", async () => {
  const d = db();
  seedComputed(d, { tamperResult: 999 });
  const { body } = await reverifyReceipts(d, { userId: "u1", sessionId: "s1", messageTs: new Date(2000).toISOString(), fetchImpl: okFetch });
  const solver = body.legs.find((l) => l.leg === "solver");
  assert.equal(solver.status, "diverged");
  assert.match(solver.detail, /stored 999/);
});

test("a failed source fetch is reported per-source, not hidden", async () => {
  const d = db();
  seedComputed(d);
  const deadFetch = async () => { throw new Error("ECONNREFUSED"); };
  const { body } = await reverifyReceipts(d, { userId: "u1", sessionId: "s1", messageTs: 2000, fetchImpl: deadFetch });
  const sources = body.legs.find((l) => l.leg === "sources");
  assert.equal(sources.status, "none-resolve");
  assert.equal(sources.sources[0].error, "unreachable");
});

test("someone else's session is forbidden; an unknown one is an honest not-found", async () => {
  const d = db();
  seedComputed(d);
  const foreign = await reverifyReceipts(d, { userId: "u2", sessionId: "s1", messageTs: 2000, fetchImpl: okFetch });
  assert.equal(foreign.status, 403);
  const unknown = await reverifyReceipts(d, { userId: "u1", sessionId: "nope", messageTs: 2000, fetchImpl: okFetch });
  assert.equal(unknown.status, 200);
  assert.equal(unknown.body.found, false);
  assert.equal(unknown.body.reason, "session_not_stored");
});

test("a reply outside the timestamp tolerance is message_not_stored", async () => {
  const d = db();
  seedComputed(d);
  const { body } = await reverifyReceipts(d, { userId: "u1", sessionId: "s1", messageTs: 999999, fetchImpl: okFetch });
  assert.equal(body.found, false);
  assert.equal(body.reason, "message_not_stored");
});

test("a plain model answer has nothing to re-verify — and says so", async () => {
  const d = db();
  d.prepare(`INSERT INTO chat_sessions (session_id, owner_id) VALUES ('s1', 'u1')`).run();
  d.prepare(`INSERT INTO chat_messages (session_id, role, content, ts, meta_json) VALUES ('s1', 'user', 'Tell me a story.', 1000, NULL)`).run();
  d.prepare(`INSERT INTO chat_messages (session_id, role, content, ts, meta_json) VALUES ('s1', 'assistant', 'Once upon a time…', 2000, NULL)`).run();
  const { body } = await reverifyReceipts(d, { userId: "u1", sessionId: "s1", messageTs: 2000, fetchImpl: okFetch });
  assert.equal(body.found, true);
  assert.deepEqual(body.legs, []);
  assert.match(body.summary, /Nothing to re-verify/);
});

test("no caller identity is a 401, mirroring the messages read API", async () => {
  const d = db();
  const { status } = await reverifyReceipts(d, { userId: null, sessionId: "s1", messageTs: 2000, fetchImpl: okFetch });
  assert.equal(status, 401);
});
