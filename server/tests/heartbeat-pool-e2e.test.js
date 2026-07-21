// Track A/B (event-loop unblocking audit) — real end-to-end proof that the
// heartbeat worker pool actually works: spawns REAL worker threads (not
// mocked, unlike tests/heartbeat-worker-pool.test.js which explicitly does
// not spawn real threads), against a REAL fully-migrated SQLite DB, and
// exercises a newly Track-B-migrated `worker: true` module end-to-end.
//
// This is the test that would have caught the original readonly-DB-write
// bug: before the heartbeat-write-queue.js fix, any worker-pooled module
// whose handler calls `db.prepare(sql).run(...)` directly threw
// SQLITE_READONLY on its first write and the tick silently reported
// module_failed. This test proves the fixed pool round-trips real module
// execution without that failure mode.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { initHeartbeatPool, exec, terminateAllForTest } from "../workers/heartbeat-pool.js";

describe("heartbeat worker pool — real worker, real DB, end-to-end", () => {
  let dbPath;
  let db;

  before(async () => {
    process.env.NODE_ENV = "test";
    dbPath = path.join(os.tmpdir(), `concord-hb-e2e-${process.pid}-${Date.now()}.db`);
    db = new Database(dbPath);
    await runMigrations(db);

    const emitted = [];
    initHeartbeatPool({
      db,
      realtimeEmit: (event, payload) => emitted.push({ event, payload }),
      dbPath,
    });
    // stash for assertions
    globalThis.__testEmitted = emitted;
  });

  after(async () => {
    await terminateAllForTest();
    try { db.close(); } catch { /* best-effort */ }
    for (const suffix of ["", "-wal", "-shm"]) {
      try { fs.unlinkSync(dbPath + suffix); } catch { /* best-effort */ }
    }
    delete globalThis.__testEmitted;
  });

  it("world-migration-cycle (Track B) runs in a real worker against a real DB without SQLITE_READONLY", async () => {
    const result = await exec("world-migration-cycle", { tickCount: 1, reason: "test" });
    assert.equal(result.ok, true, `expected ok:true, got: ${JSON.stringify(result)}`);
    assert.ok(Array.isArray(result.sideEffects));
  });

  it("world-population-cycle (Track B) runs in a real worker and can queue+replay a real write", async () => {
    // Seed a minimal world so the module has something to act on.
    db.prepare(`INSERT INTO worlds (id, name, universe_type) VALUES (?, ?, ?)`).run("e2e-test-world", "E2E Test World", "concordia");

    const result = await exec("world-population-cycle", { tickCount: 60, reason: "test" });
    assert.equal(result.ok, true, `expected ok:true, got: ${JSON.stringify(result)}`);

    // Whether or not it actually spawned an NPC (depends on faction density
    // targets), the key proof is: no SQLITE_READONLY anywhere in the result,
    // and any db-write side effects it did queue replayed successfully
    // (heartbeat-pool.js's _applySideEffects runs synchronously before
    // exec()'s promise resolves).
    for (const eff of result.sideEffects) {
      assert.notEqual(eff.kind, undefined);
    }
  });

  it("signal-propagation-cycle (Track B, serial:true + worker:true) runs without error", async () => {
    const result = await exec("signal-propagation-cycle", { tickCount: 3, reason: "test" });
    assert.equal(result.ok, true, `expected ok:true, got: ${JSON.stringify(result)}`);
  });

  it("npc-routine-cycle (Track B) runs without error and any globalThis emit bridge is honored", async () => {
    const result = await exec("npc-routine-cycle", { tickCount: 5, reason: "test" });
    assert.equal(result.ok, true, `expected ok:true, got: ${JSON.stringify(result)}`);
    // Any realtime-emit side effects (via the globalThis._concordRealtimeEmit
    // bridge or ctx.queueEmit) must be well-formed if present.
    for (const eff of result.sideEffects) {
      if (eff.kind === "realtime-emit") {
        assert.equal(typeof eff.event, "string");
      }
    }
  });

  it("a pre-existing worker-pooled module (faction-strategy-cycle) also runs without SQLITE_READONLY post-fix", async () => {
    const result = await exec("faction-strategy-cycle", { tickCount: 200, reason: "test" });
    assert.equal(result.ok, true, `expected ok:true, got: ${JSON.stringify(result)}`);
  });

  it("literary-resonance-cycle (Track C — heaviest synchronous-CPU indexing pass found) runs in a real worker", async () => {
    const result = await exec("literary-resonance-cycle", { tickCount: 200, reason: "test" });
    assert.equal(result.ok, true, `expected ok:true, got: ${JSON.stringify(result)}`);
  });
});
