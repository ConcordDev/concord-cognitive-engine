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

// 2026-10-23: event_timeline_log (retention sweep deletes the oldest rows)
// had max(rowid) 13M for 554k rows with accurate stats, so the max(rowid)
// estimate flagged it on every boot and its ANALYZE blocked the loop ~1 s.
test("rowid churn from deletes is not staleness; real growth still is", () => {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE churned (id INTEGER PRIMARY KEY AUTOINCREMENT, k TEXT); CREATE INDEX idx_churned_k ON churned(k);
           CREATE TABLE scattered (id INTEGER PRIMARY KEY, k TEXT); CREATE INDEX idx_scattered_k ON scattered(k);
           CREATE TABLE grown (id INTEGER PRIMARY KEY, k TEXT); CREATE INDEX idx_grown_k ON grown(k);`);
  const fill = (t, n, start = 1) => db.transaction(() => {
    const ins = db.prepare(`INSERT INTO ${t} (id, k) VALUES (?, ?)`);
    for (let i = start; i < start + n; i++) ins.run(i, `k${i % 97}`);
  })();
  // churned: 20k rows that survived a sweep of the oldest 400k (high min rowid).
  fill("churned", 20_000, 400_001);
  // scattered: 20k rows spread across rowids 1..400k (span overstates; count must decide).
  db.transaction(() => { const ins = db.prepare("INSERT INTO scattered (id, k) VALUES (?, ?)"); for (let i = 0; i < 20_000; i++) ins.run(1 + i * 20, "s"); })();
  fill("grown", 20);
  db.exec("ANALYZE");
  fill("grown", 30_000, 1000); // grows 1500x after its stats were written
  const stale = findStaleStatTables(db).map((s) => s.tbl);
  assert.deepEqual(stale, ["grown"]);
});

test("no sqlite_stat1 / no db: no-op, never throws", async () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
  assert.deepEqual(findStaleStatTables(db), []);
  assert.deepEqual(await refreshStaleStats(db, { pauseMs: 0 }), { ok: true, checked: 0, refreshed: [] });
  assert.equal((await refreshStaleStats(null)).ok, false);
});
