// Pins the 2026-10-22 event-loop fix in lib/incident-engine/gather.js:
// readSentinelAlerts must use the created_at index (it full-scanned the
// ~58 MB live table via ORDER BY id DESC LIMIT 30) and return exactly the
// rows the old query returned.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { readSentinelAlerts } from "../lib/incident-engine/gather.js";

function mkSentinelDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sentinel-q-"));
  const p = path.join(dir, "sentinel.db");
  const db = new Database(p);
  db.exec(`CREATE TABLE sentinel_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, state_id INTEGER NOT NULL, observed_at TEXT NOT NULL,
    source TEXT NOT NULL, severity TEXT NOT NULL, message TEXT NOT NULL, delivered_via TEXT,
    telegram_message_id INTEGER, sent_at TEXT, trace_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE INDEX idx_sentinel_alerts_created_at ON sentinel_alerts(created_at);`);
  const ins = db.prepare("INSERT INTO sentinel_alerts (state_id, observed_at, source, severity, message, trace_id, created_at) VALUES (1, ?, ?, 'warn', ?, ?, ?)");
  const fmt = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
  const now = Date.now();
  // 3000 old rows, then 45 recent ones (more than the LIMIT), interleaved
  // created_at ties to exercise ordering.
  for (let i = 0; i < 3000; i++) ins.run("o", "old", `old ${i}`, `t${i}`, fmt(now - 86_400_000 + i * 1000));
  for (let i = 0; i < 45; i++) ins.run("r", "recent", `recent ${i}`, `r${i}`, fmt(now - 120_000 + Math.floor(i / 3) * 1000));
  return { db, p, dir };
}

test("readSentinelAlerts returns the same rows as the old full-scan query", () => {
  const { db, p, dir } = mkSentinelDb();
  try {
    const cutoff = new Date(Date.now() - 10 * 60_000).toISOString().slice(0, 19).replace("T", " ");
    const oldRows = db.prepare(`SELECT id, observed_at, source, severity, message, delivered_via, trace_id
      FROM sentinel_alerts WHERE created_at > ? ORDER BY id DESC LIMIT 30`).all(cutoff);
    const got = readSentinelAlerts(10, p);
    assert.equal(got.length, 30);
    assert.deepEqual(got.map((r) => r.trace_id), oldRows.map((r) => r.trace_id));
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test("the query is served by the created_at index, not a table scan", () => {
  const { db, dir } = mkSentinelDb();
  try {
    const src = fs.readFileSync(new URL("../lib/incident-engine/gather.js", import.meta.url), "utf8");
    const sql = src.match(/SELECT id, observed_at, source, severity, message, delivered_via, trace_id\s+FROM sentinel_alerts[\s\S]*?LIMIT 30/)[0];
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all("2000-01-01 00:00:00").map((r) => r.detail).join(" | ");
    assert.match(plan, /USING (COVERING )?INDEX idx_sentinel_alerts_created_at/);
    assert.doesNotMatch(plan, /SCAN sentinel_alerts/);
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
