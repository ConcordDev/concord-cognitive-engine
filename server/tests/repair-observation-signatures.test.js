// Durable repair-cortex error signatures.
//
// observe() must warn once the first time a signature appears, stay quiet on
// repeats, coalesce database writes, and treat a signature loaded from a
// reopened database as already seen.
//
// Run: node --test tests/repair-observation-signatures.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { query } from "../logger.js";
import { up as migrateSignatures } from "../migrations/474_repair_observation_signatures.js";
import { getObservationFlushStats } from "../lib/repair-observation-store.js";
import {
  observe,
  configureRepairPersistence,
  flushRepairObservations,
  stopRepairLoop,
  getFullRepairStatus,
  getErrorAccumulator,
  getRepairObservationStatus,
  _resetRepairObservationsForTest,
} from "../emergent/repair-cortex.js";

const SERVER_JS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "server.js");

function warnsFor(signature) {
  return query({ source: "repair-cortex", search: signature, limit: 1000 })
    .filter((entry) => entry.level === "warn" && entry.message.includes("error_signature_first_seen") && entry.message.includes(signature));
}

function openDb() {
  const db = new Database(":memory:");
  migrateSignatures(db);
  return db;
}

beforeEach(() => {
  process.env.CONCORD_REPAIR_OBS_FLUSH_MS = "0";
  delete process.env.CONCORD_REPAIR_OBS_MAX_ROWS;
  _resetRepairObservationsForTest();
});

afterEach(() => {
  _resetRepairObservationsForTest();
  delete process.env.CONCORD_REPAIR_OBS_FLUSH_MS;
  delete process.env.CONCORD_REPAIR_OBS_MAX_ROWS;
});

describe("first-seen warning", () => {
  it("logs one warn line on the first occurrence and stays quiet on repeats", () => {
    const db = openDb();
    configureRepairPersistence(db);
    const err = new Error("socket hang up on the feed writer");
    const ctx = "feed_flush";

    observe(err, ctx);
    observe(err, ctx);
    observe(err, ctx);

    const status = getRepairObservationStatus();
    assert.equal(status.size, 1);
    assert.equal(status.entries[0].count, 3);
    const signature = status.entries[0].signature;
    const hits = warnsFor(signature);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].level, "warn");
    assert.match(hits[0].message, new RegExp(`signature=${signature}`));
    assert.match(hits[0].message, new RegExp(`firstSeen=${status.entries[0].firstSeen}`));
    assert.equal(hits[0].meta.signature, signature);
    assert.equal(hits[0].meta.firstSeen, status.entries[0].firstSeen);
    assert.equal(hits[0].meta.event, "error_signature_first_seen");
    db.close();
  });

  it("collapses numbers and still warns only once", () => {
    configureRepairPersistence(openDb());
    observe(new Error("claim 17 missing tile"), "factory");
    observe(new Error("claim 88 missing tile"), "factory");
    const status = getRepairObservationStatus();
    assert.equal(status.size, 1);
    assert.equal(status.entries[0].count, 2);
    assert.equal(warnsFor(status.entries[0].signature).length, 1);
    assert.match(status.entries[0].message, /claim :n missing tile/);
  });

  it("treats a different error class or route as a different signature", () => {
    configureRepairPersistence(openDb());
    observe(new Error("same text"), { source: "macro", route: "/api/farm/:id" });
    observe(new TypeError("same text"), { source: "macro", route: "/api/farm/:id" });
    observe(new Error("same text"), { source: "macro", macro: "farm.harvest" });
    const status = getRepairObservationStatus();
    assert.equal(status.size, 3);
    assert.equal(status.entries.reduce((n, e) => n + warnsFor(e.signature).length, 0), 3);
  });
});

describe("coalesced writes", () => {
  it("does not write per occurrence; one flush upserts the running count once", () => {
    const db = openDb();
    configureRepairPersistence(db);
    for (let i = 0; i < 25; i++) observe(new Error("guardian probe refused"), "endpoint_health");
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM repair_observation_signatures").get().c, 0);
    assert.deepEqual(getObservationFlushStats(), { batches: 0, statements: 0 });

    const flushed = flushRepairObservations();
    assert.equal(flushed.flushed, 1);
    assert.deepEqual(getObservationFlushStats(), { batches: 1, statements: 1 });
    const row = db.prepare("SELECT count FROM repair_observation_signatures").get();
    assert.equal(row.count, 25);

    flushRepairObservations();
    assert.deepEqual(getObservationFlushStats(), { batches: 1, statements: 1 });
    db.close();
  });

  it("flushes several signatures in one transaction", () => {
    const db = openDb();
    configureRepairPersistence(db);
    observe(new Error("alpha"), "a");
    observe(new Error("beta"), "b");
    observe(new Error("gamma"), "c");
    observe(new Error("alpha"), "a");
    flushRepairObservations();
    assert.deepEqual(getObservationFlushStats(), { batches: 1, statements: 3 });
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM repair_observation_signatures").get().c, 3);
    db.close();
  });

  it("flushes on the interval without a per-hit write", async () => {
    const db = openDb();
    process.env.CONCORD_REPAIR_OBS_FLUSH_MS = "80";
    configureRepairPersistence(db);
    for (let i = 0; i < 10; i++) observe(new Error("interval burst"), "interval_src");
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM repair_observation_signatures").get().c, 0);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const row = db.prepare("SELECT count FROM repair_observation_signatures").get();
    assert.equal(row.count, 10);
    assert.equal(getObservationFlushStats().batches, 1);
    assert.equal(getObservationFlushStats().statements, 1);
    db.close();
  });

  it("stopRepairLoop flushes while the handle is still open, matching graceful shutdown", () => {
    const db = openDb();
    configureRepairPersistence(db);
    observe(new Error("loop stop persists"), "repair_loop");
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM repair_observation_signatures").get().c, 0);
    stopRepairLoop();
    assert.equal(db.prepare("SELECT count AS c FROM repair_observation_signatures").get().c, 1);
    const src = fs.readFileSync(SERVER_JS, "utf8");
    const start = src.indexOf("async flushFeed()");
    const end = src.indexOf("callbacks: shutdownCallbacks", start);
    const window = src.slice(start, end);
    assert.ok(start > 0 && end > start);
    assert.match(window, /flushRepairObservations\(\)/);
    assert.match(window, /stopRepairObservationFlush\(\)/);
    db.close();
  });
});

describe("restart survival", () => {
  it("a signature loaded from a reopened database is not new and keeps its count", () => {
    const file = path.join(os.tmpdir(), `repair-obs-${process.pid}-${Date.now()}.db`);
    let db = new Database(file);
    try {
      migrateSignatures(db);
      configureRepairPersistence(db);
      const err = new Error("shard writer locked");
      const ctx = "world_shard";
      observe(err, ctx);
      flushRepairObservations();
      const signature = getRepairObservationStatus().entries[0].signature;
      const before = db.prepare(
        "SELECT count, first_seen FROM repair_observation_signatures WHERE signature = ?"
      ).get(signature);
      assert.equal(before.count, 1);
      assert.equal(warnsFor(signature).length, 1);
      db.close();

      _resetRepairObservationsForTest();
      db = new Database(file);
      configureRepairPersistence(db);
      const loaded = getRepairObservationStatus();
      assert.equal(loaded.size, 1);
      assert.equal(loaded.entries[0].signature, signature);
      assert.equal(loaded.entries[0].count, 1);
      assert.equal(loaded.entries[0].firstSeen, before.first_seen);

      observe(err, ctx);
      observe(err, ctx);
      assert.equal(warnsFor(signature).length, 1, "restart must not emit another first-seen warning");
      flushRepairObservations();
      const after = db.prepare(
        "SELECT count, first_seen FROM repair_observation_signatures WHERE signature = ?"
      ).get(signature);
      assert.equal(after.count, 3);
      assert.equal(after.first_seen, before.first_seen);
    } finally {
      try { db.close(); } catch { /* already closed */ }
      _resetRepairObservationsForTest();
      fs.rmSync(file, { force: true });
      fs.rmSync(`${file}-wal`, { force: true });
      fs.rmSync(`${file}-shm`, { force: true });
    }
  });
});

describe("bounds, privacy, and failure isolation", () => {
  it("prunes old low-count signatures and keeps the hot one", () => {
    process.env.CONCORD_REPAIR_OBS_MAX_ROWS = "2";
    const db = openDb();
    configureRepairPersistence(db);
    for (let i = 0; i < 5; i++) observe(new Error("hot path blew up"), "hot");
    observe(new Error("cold one"), "cold-a");
    observe(new Error("cold two"), "cold-b");
    observe(new Error("cold three"), "cold-c");
    flushRepairObservations();
    const rows = db.prepare(
      "SELECT source, count FROM repair_observation_signatures ORDER BY count DESC"
    ).all();
    assert.ok(rows.length <= 2);
    assert.equal(rows[0].source, "hot");
    assert.equal(rows[0].count, 5);
    assert.ok(rows.every((row) => row.source === "hot" || row.count === 1));
    db.close();
  });

  it("stores a scrubbed sample and never the raw secret, email, query, or stack", () => {
    const db = openDb();
    configureRepairPersistence(db);
    const err = new Error(
      "login failed for ada@example.com jwt eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U password=hunter2"
    );
    observe(err, { source: "auth", route: "/api/users/42?token=supersecret" });
    flushRepairObservations();
    const row = db.prepare(
      "SELECT source, route, error_class, message_norm, sample_json FROM repair_observation_signatures"
    ).get();
    const blob = `${row.message_norm}\n${row.route}\n${row.sample_json}`;
    assert.equal(blob.includes("ada@example.com"), false);
    assert.equal(blob.includes("eyJ"), false);
    assert.equal(blob.includes("hunter2"), false);
    assert.equal(blob.includes("supersecret"), false);
    assert.equal(blob.toLowerCase().includes("stack"), false);
    assert.equal(row.route, "/api/users/:n");
    const sample = JSON.parse(row.sample_json);
    assert.deepEqual(Object.keys(sample).sort(), ["errorClass", "message", "route", "source"]);
    assert.match(sample.message, /:email/);
    assert.match(sample.message, /:secret/);
    assert.match(sample.message, /password=:secret/);
    db.close();
  });

  it("a database error does not break observe() or drop the in-memory accumulator", () => {
    const real = openDb();
    const proxy = {
      prepare(sql) {
        if (String(sql).includes("INSERT INTO repair_observation_signatures")) {
          throw new Error("disk full");
        }
        return real.prepare(sql);
      },
      transaction() {
        throw new Error("disk full");
      },
    };
    configureRepairPersistence(proxy);
    const message = "observed while the signature table is failing";
    assert.doesNotThrow(() => observe(new Error(message), "db_down"));
    assert.doesNotThrow(() => observe(new Error(message), "db_down"));
    assert.doesNotThrow(() => flushRepairObservations());
    const acc = getErrorAccumulator();
    assert.ok(acc.entries.some((entry) => entry.message.includes(message) && entry.count === 2));
    const status = getFullRepairStatus();
    assert.equal(status.ok, true);
    assert.equal(status.observations.entries[0].count, 2);
    assert.equal(real.prepare("SELECT COUNT(*) AS c FROM repair_observation_signatures").get().c, 0);
    real.close();
  });

  it("a closed database does not throw from observe or flush", () => {
    const db = openDb();
    configureRepairPersistence(db);
    db.close();
    assert.doesNotThrow(() => observe(new Error("after close"), "closed_db"));
    assert.doesNotThrow(() => flushRepairObservations());
    assert.equal(getRepairObservationStatus().entries[0].count, 1);
  });
});
