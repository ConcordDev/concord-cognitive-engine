// INC-100e: pruneOldTraceEvents used `DELETE ... WHERE created_at < ?` with no
// index on created_at — a full scan of trace_correlation (463k rows, ~1.4 s on
// the main thread) every hour even when nothing was old. It now deletes through
// the observed_at index in small batches.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "inc100e-trace-"));
process.env.HOME = home;
const { pruneOldTraceEvents } = await import("../lib/auth-gate/dispatch.js");
const Database = (await import("better-sqlite3")).default;

test("prunes only rows older than the window, via the observed_at index, in batches", async () => {
  // first call creates the schema
  assert.deepEqual(await pruneOldTraceEvents(), { ok: true, deleted: 0 });
  const db = new Database(path.join(home, ".local/share/concord/trace-fabric.db"));
  const ins = db.prepare("INSERT INTO trace_correlation (trace_id, source, source_event, observed_at, payload_json) VALUES (?, 's', 'e', ?, '{}')");
  const old = new Date(Date.now() - 40 * 86400_000).toISOString();
  const fresh = new Date().toISOString();
  db.transaction(() => { for (let i = 0; i < 2500; i++) ins.run(`o${i}`, old); for (let i = 0; i < 7; i++) ins.run(`f${i}`, fresh); })();
  const plan = db.prepare("EXPLAIN QUERY PLAN SELECT id FROM trace_correlation WHERE observed_at < ? LIMIT ?").all(fresh, 1).map((r) => r.detail).join(" ");
  assert.match(plan, /idx_trace_correlation_observed_at_event/);
  const r = await pruneOldTraceEvents(undefined, { batchSize: 1000 });
  assert.deepEqual(r, { ok: true, deleted: 2500 });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM trace_correlation").get().n, 7);
  assert.deepEqual(await pruneOldTraceEvents(), { ok: true, deleted: 0 });
  db.close();
});
