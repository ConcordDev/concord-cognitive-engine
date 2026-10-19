// INC-100b follow-up — readSentinelAlerts must still return recent alerts after
// the sargable created_at cutoff change. sentinel_alerts.created_at is SQLite
// CURRENT_TIMESTAMP text ("YYYY-MM-DD HH:MM:SS"); comparing it to an ISO
// "YYYY-MM-DDTHH:MM:SS.sssZ" cutoff drops every same-day row.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSentinelAlerts } from "../../lib/incident-engine/gather.js";

function sqlTs(msAgo) {
  return new Date(Date.now() - msAgo).toISOString().slice(0, 19).replace("T", " ");
}

describe("INC-100b readSentinelAlerts cutoff", () => {
  it("returns alerts created inside the window and excludes older ones", () => {
    const dir = mkdtempSync(join(tmpdir(), "inc100b-sentinel-"));
    const dbPath = join(dir, "sentinel.db");
    try {
      const db = new Database(dbPath);
      db.exec(`CREATE TABLE sentinel_alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        observed_at TEXT NOT NULL, source TEXT NOT NULL, severity TEXT NOT NULL,
        message TEXT NOT NULL, delivered_via TEXT, trace_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
      const ins = db.prepare(
        `INSERT INTO sentinel_alerts (observed_at, source, severity, message, trace_id, created_at)
         VALUES (?, ?, 'warn', ?, 't', ?)`,
      );
      ins.run(new Date().toISOString(), "recent_default", "default ts", sqlTs(0).replace(/.*/, (x) => x));
      db.prepare(
        `INSERT INTO sentinel_alerts (observed_at, source, severity, message, trace_id)
         VALUES (?, 'recent_current_ts', 'warn', 'current_timestamp default', 't')`,
      ).run(new Date().toISOString());
      ins.run(new Date().toISOString(), "two_min_ago", "2m", sqlTs(2 * 60_000));
      ins.run(new Date().toISOString(), "old", "30m", sqlTs(30 * 60_000));
      db.close();

      const rows = readSentinelAlerts(10, dbPath);
      const kinds = rows.map((r) => r.kind).sort();
      assert.deepEqual(kinds, ["recent_current_ts", "recent_default", "two_min_ago"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
