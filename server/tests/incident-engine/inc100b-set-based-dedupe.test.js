// INC-100b — regression: incident_watch dedupe must be set-based, not N+1.
//
// Before the fix, processSignalBacklog called findRecentIncident once per
// signal, each doing a synchronous better-sqlite3 Statement.get() that scanned
// incident_state (no covering index on the class/source/detected_at predicate).
// This test fails on that code because it counts N .get() calls and a slow
// sync slice; it passes on the fixed code, which does one batch .all() per slice.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  ensureIncidentSchema,
  processSignalBacklog,
  runIncidentWatchTick,
  DEDUPE_WINDOW_MINUTES,
} from "../../lib/incident-engine/watch-tick.js";

const NOOP_HOOKS = {
  sendTelegram: async () => false,
  executeRecovery: async () => ({
    ok: false,
    detail: "test_noop",
    duration_ms: 0,
    verified: false,
    verify_detail: "skipped",
  }),
};

function memDb() {
  const db = new Database(":memory:");
  ensureIncidentSchema(db);
  return db;
}

/** Wrap db.prepare to count get/all/run calls and capture SQL. */
function instrumentDb(db) {
  const stats = { get: 0, all: 0, run: 0, statements: [] };
  const origPrepare = db.prepare.bind(db);
  db.prepare = function (sql) {
    stats.statements.push(sql.trim());
    const stmt = origPrepare(sql);
    return new Proxy(stmt, {
      get(target, prop) {
        if (prop === "get") {
          return (...args) => {
            stats.get++;
            return target.get(...args);
          };
        }
        if (prop === "all") {
          return (...args) => {
            stats.all++;
            return target.all(...args);
          };
        }
        if (prop === "run") {
          return (...args) => {
            stats.run++;
            return target.run(...args);
          };
        }
        return target[prop];
      },
    });
  };
  return stats;
}

function seedIncidents(db, n) {
  const insert = db.prepare(`INSERT INTO incident_state
    (detected_at, trace_id, incident_class, source, severity, status, outcome, signal_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const nowMs = Date.now();
  db.transaction(() => {
    for (let i = 0; i < n; i++) {
      const t = new Date(nowMs - (i % 10000) * 1000).toISOString();
      insert.run(
        t,
        "trace",
        `class_${i % 200}`,
        `source_${i % 500}`,
        "warn",
        "observed",
        "observe",
        "{}",
      );
    }
  })();
}

function makeSignals(n, prefix = "sig") {
  const out = [];
  for (let i = 0; i < n; i++) {
    // Unique source per signal so each signal gets a distinct (class, source)
    // dedupe key and none dedupe within the slice.
    out.push({
      source: `${prefix}_src_${i}`,
      kind: `${prefix}_novel_${i}`,
      severity: "warn",
      message: `${prefix} message ${i}`,
    });
  }
  return out;
}

describe("INC-100b — set-based incident dedupe", () => {
  it("uses one batch query per slice, not one .get() per signal", async () => {
    const db = memDb();
    seedIncidents(db, 100_000);
    const stats = instrumentDb(db);

    const signals = makeSignals(30, "bulk");
    const result = await processSignalBacklog(db, signals, {
      signalsPerSlice: 30,
      tickWallMs: Number.POSITIVE_INFINITY,
      chunked: false,
      hooks: NOOP_HOOKS,
    });

    // Old code: 30 findRecentIncident .get() calls, each scanning incident_state.
    // New code: one batch .all() for the slice, zero per-row .get() for dedupe.
    assert.equal(stats.get, 0, "dedupe must not use per-row .get()");
    assert.equal(stats.all, 1, "dedupe must use exactly one batch .all() per slice");
    assert.equal(result.processed, 30, "all signals processed");
    assert.equal(result.remaining, 0, "no signals left behind");
    assert.equal(result.truncated, false, "single slice should not truncate");

    // Sanity: all unique class/source pairs persisted (none deduped because
    // none existed before this slice).
    const persisted = db
      .prepare("SELECT COUNT(*) AS c FROM incident_state")
      .get().c;
    assert.equal(persisted, 100_030, "seed + 30 new incidents persisted");

    db.close();
  });

  it("preserves pre-existing and within-slice dedupe semantics", async () => {
    const db = memDb();
    const nowIso = new Date().toISOString();
    const withinWindow = new Date(
      Date.now() - (DEDUPE_WINDOW_MINUTES - 1) * 60_000,
    ).toISOString();

    // Pre-existing incident for one class/source pair (inside the dedupe window).
    // The signals below classify to "unknown_class" because their kind is not
    // in the known-class list, so the pre-existing row must use the same class
    // for the dedupe window to match.
    db.prepare(
      `INSERT INTO incident_state
       (detected_at, trace_id, incident_class, source, severity, status, outcome, signal_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      withinWindow,
      "trace-pre",
      "unknown_class",
      "pre_existing_src",
      "warn",
      "observed",
      "observe",
      "{}",
    );

    const signals = [
      // Should dedupe against the pre-existing row.
      {
        source: "pre_existing_src",
        kind: "pre_existing_kind",
        severity: "warn",
        message: "pre-existing",
      },
      // Entirely new pair; first signal inserts.
      {
        source: "new_src",
        kind: "new_kind",
        severity: "warn",
        message: "new first",
      },
      // Same class/source as the previous signal; should dedupe against the
      // first signal's insert in this same slice.
      {
        source: "new_src",
        kind: "new_kind",
        severity: "warn",
        message: "within-slice dup",
      },
    ];

    const result = await processSignalBacklog(db, signals, {
      signalsPerSlice: 10,
      tickWallMs: Number.POSITIVE_INFINITY,
      chunked: false,
      hooks: NOOP_HOOKS,
      nowIso,
    });

    assert.equal(result.processed, 3);

    const statuses = result.results.map((r) => r.status);
    assert.equal(
      statuses[0],
      "deduped",
      "first signal dedupes against pre-existing incident",
    );
    assert.ok(
      result.results[0].recent_incident_id != null,
      "deduped result points at pre-existing id",
    );

    // Unknown kinds classify to "unknown_class" with escalateTo "operator",
    // so the first new signal becomes "escalated", not "observed".
    assert.equal(statuses[1], "escalated", "new class/source pair inserts");

    assert.equal(
      statuses[2],
      "deduped",
      "within-slice duplicate dedupes against first insert in slice",
    );
    assert.equal(
      result.results[2].recent_incident_id,
      result.results[1].incident_id,
      "within-slice duplicate points at the new insert made in the same slice",
    );

    // Two rows total: the pre-existing row plus one new insert (the duplicate
    // did not create a second row).
    const persisted = db
      .prepare("SELECT COUNT(*) AS c FROM incident_state")
      .get().c;
    assert.equal(persisted, 2, "pre-existing + one new incident");

    db.close();
  });

  it("runIncidentWatchTick drains backlog with set-based dedupe", async () => {
    const db = memDb();
    seedIncidents(db, 50_000);
    const stats = instrumentDb(db);

    const signals = makeSignals(25, "tick");
    const result = await runIncidentWatchTick({
      db,
      signals,
      signalsPerSlice: 10,
      tickWallMs: Number.POSITIVE_INFINITY,
      hooks: NOOP_HOOKS,
    });

    // Three slices, each one batch .all(), no per-row .get().
    assert.equal(stats.get, 0, "tick must not use per-row .get() for dedupe");
    assert.equal(stats.all, 3, "three slices each do one batch .all()");
    assert.equal(result.observation.incidents_processed, 25);
    assert.equal(result.observation.signals_remaining, 0);

    db.close();
  });
});
