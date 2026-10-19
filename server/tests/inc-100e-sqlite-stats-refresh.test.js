// INC-100e: stale sqlite_stat1 made the planner full-SCAN emergent_communications
// (stat said 2 rows, real 844k) instead of using idx_comm_from; ~70 scans in one
// MinorAgentScheduler batch froze the event loop ~3.5 s. refreshStaleStats must
// find tables whose stats are far behind and re-ANALYZE them so the index is used.
import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { findStaleStatTables, refreshStaleStats } from "../lib/sqlite-stats-refresh.js";

const PLAN_SQL = "EXPLAIN QUERY PLAN SELECT COUNT(*) FROM emergent_communications WHERE from_emergent_id = ? AND initiated_at > ?";

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE emergent_communications (id TEXT PRIMARY KEY, from_emergent_id TEXT NOT NULL, to_emergent_id TEXT NOT NULL, initiated_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending');
           CREATE INDEX idx_comm_from ON emergent_communications(from_emergent_id);
           CREATE INDEX idx_comm_status ON emergent_communications(status);
           CREATE TABLE small_t (id INTEGER PRIMARY KEY, k TEXT); CREATE INDEX idx_small_k ON small_t(k);`);
  const ins = db.prepare("INSERT INTO emergent_communications (id, from_emergent_id, to_emergent_id, initiated_at) VALUES (?, ?, ?, ?)");
  ins.run("c0", "em_a", "em_b", 1); ins.run("c1", "em_b", "em_a", 2);
  db.prepare("INSERT INTO small_t (k) VALUES ('x')").run();
  db.exec("ANALYZE"); // stats written while the table holds 2 rows
  db.transaction(() => { for (let i = 2; i < 30_000; i++) ins.run(`c${i}`, `em_${i % 1500}`, "em_z", i); })();
  return db;
}

test("stale stats: planner scans before refresh, uses idx_comm_from after", async () => {
  const db = makeDb();
  assert.match(db.prepare(PLAN_SQL).all("em_1", 0)[0].detail, /^SCAN emergent_communications/);
  const stale = findStaleStatTables(db);
  assert.deepEqual(stale.map((s) => s.tbl), ["emergent_communications"], "only the grown table is stale");
  const r = await refreshStaleStats(db, { pauseMs: 0 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.refreshed.map((x) => x.tbl), ["emergent_communications"]);
  assert.match(db.prepare(PLAN_SQL).all("em_1", 0)[0].detail, /USING INDEX idx_comm_from/);
  assert.deepEqual(findStaleStatTables(db), [], "fresh stats are not stale");
  assert.equal(db.pragma("analysis_limit", { simple: true }), 0, "analysis_limit restored");
});

test("no sqlite_stat1 / no db: no-op, never throws", async () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
  assert.deepEqual(findStaleStatTables(db), []);
  assert.deepEqual(await refreshStaleStats(db, { pauseMs: 0 }), { ok: true, checked: 0, refreshed: [] });
  assert.equal((await refreshStaleStats(null)).ok, false);
});
