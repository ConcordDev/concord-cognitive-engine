process.env.EMBEDDINGS_ENABLED = "false";
import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { recordToolOutcomeEvent, failureCounts } from "../../lib/cockpit/telemetry.js";

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE agent_action_log (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, session_id TEXT, action TEXT NOT NULL,
    input_json TEXT, output_summary TEXT, tool TEXT, outcome TEXT, embedding BLOB,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()))`);
  return db;
}
const wait = () => new Promise((r) => setTimeout(r, 80));

test("a failed call writes error:<class>|<surface>", async () => {
  delete process.env.CONCORD_COCKPIT_TELEMETRY;
  const db = makeDb();
  recordToolOutcomeEvent(db, { userId: "u1", surface: "chat", call: { tool: "run_compute", params: {} }, result: { ok: false, error: "missing required param key" } });
  await wait();
  const row = db.prepare("SELECT outcome, tool FROM agent_action_log").get();
  assert.equal(row.outcome, "error:bad_args|chat");
  assert.equal(row.tool, "run_compute");
});

test("with the flag off nothing is written", async () => {
  process.env.CONCORD_COCKPIT_TELEMETRY = "0";
  try {
    const db = makeDb();
    recordToolOutcomeEvent(db, { userId: "u1", surface: "chat", call: { tool: "web_search" }, result: { ok: true } });
    await wait();
    assert.equal(db.prepare("SELECT COUNT(*) c FROM agent_action_log").get().c, 0);
  } finally { delete process.env.CONCORD_COCKPIT_TELEMETRY; }
});

test("failureCounts tallies by class and tool", () => {
  const db = makeDb();
  const ins = db.prepare("INSERT INTO agent_action_log (id,user_id,action,tool,outcome) VALUES (?,?,?,?,?)");
  ins.run("1", "u1", "tool:a", "a", "ok|chat");
  ins.run("2", "u1", "tool:a", "a", "error:bad_args|chat");
  ins.run("3", "u1", "tool:b", "b", "error");
  const r = failureCounts(db, { userId: "u1", sinceSec: 0 });
  assert.equal(r.ok, true);
  assert.equal(r.total, 3);
  assert.equal(r.failed, 2);
  assert.deepEqual(r.byClass, { bad_args: 1, unclassified: 1 });
  assert.deepEqual(r.byTool.a, { calls: 2, failed: 1 });
});

test("a db with no table returns no_table", () => {
  const r = failureCounts(new Database(":memory:"), { userId: null, sinceSec: 0 });
  assert.deepEqual(r, { ok: false, reason: "no_table" });
});
