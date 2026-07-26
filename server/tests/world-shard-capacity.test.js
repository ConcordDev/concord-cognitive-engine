// GPU/CPU pinning audit (2026-07-20) — world-shard-manager had no ceiling
// on concurrent shards; every world with an active user got its own worker
// thread, unbounded. This proves the new SHARD_MAX_ACTIVE cap + LRU-idle
// eviction against REAL worker threads and a real migrated DB (not mocked),
// matching this session's heartbeat-pool-e2e.test.js precedent.
//
// SHARD_MAX_ACTIVE is a module-level const read once at import time (same
// pattern as this file's other SHARD_* tunables) — so this file sets
// CONCORD_MAX_ACTIVE_SHARDS itself, in before(), BEFORE dynamically
// importing world-shard-manager.js for the first time. A static top-level
// import would evaluate the module (and its SHARD_MAX_ACTIVE const) before
// before() ever runs, which is why this file is self-sufficient via
// dynamic import rather than relying on an external env var being set
// ahead of the node invocation.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";

describe("world-shard-manager — capacity cap + LRU-idle eviction (real workers)", () => {
  let dbPath;
  let db;
  let initWorldShards;
  let ensureWorldActive;
  let markWorldUserCount;
  let getShardHealth;
  let shutdownShards;
  let _resetShardManagerForTests;

  before(async () => {
    process.env.NODE_ENV = "test";
    process.env.CONCORD_SHARD_WORLDS = "true";
    process.env.CONCORD_MAX_ACTIVE_SHARDS = "2";

    ({
      initWorldShards,
      ensureWorldActive,
      markWorldUserCount,
      getShardHealth,
      shutdownShards,
      _resetShardManagerForTests,
    } = await import("../lib/world-shard-manager.js"));

    dbPath = path.join(os.tmpdir(), `concord-shard-cap-${process.pid}-${Date.now()}.db`);
    db = new Database(dbPath);
    await runMigrations(db);
    _resetShardManagerForTests();
    await initWorldShards({ dbPath, realtimeEmit: () => {}, db });
  });

  after(async () => {
    await shutdownShards();
    _resetShardManagerForTests();
    delete process.env.CONCORD_SHARD_WORLDS;
    delete process.env.CONCORD_MAX_ACTIVE_SHARDS;
    try { db.close(); } catch { /* best-effort */ }
    for (const suffix of ["", "-wal", "-shm"]) {
      try { fs.unlinkSync(dbPath + suffix); } catch { /* best-effort */ }
    }
  });

  it("spawns up to the cap normally", async () => {
    const a = await ensureWorldActive("cap-world-a");
    const b = await ensureWorldActive("cap-world-b");
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    assert.equal(getShardHealth().length, 2);
  });

  // Eviction sends SHUTDOWN and marks the victim 'draining' — the worker's
  // actual thread exit (and its removal from the shard map) happens
  // asynchronously afterward, a deliberate graceful-handoff design (the new
  // shard doesn't block on the old one's full teardown). Assertions here
  // filter to non-draining entries — "how many genuinely active shards
  // exist" — rather than raw map size, which can transiently include an
  // already-draining entry mid-handoff.
  const activeWorldIds = () => getShardHealth().filter((h) => h.status !== "draining").map((h) => h.worldId).sort();

  it("evicts the least-recently-active IDLE shard to admit a new one past the cap", async () => {
    // Both existing shards (a, b) are idle (userCount 0). A third world
    // request should evict the older-touched one, not reject outright.
    const c = await ensureWorldActive("cap-world-c");
    assert.equal(c.ok, true, `expected eviction to make room, got: ${JSON.stringify(c)}`);
    assert.deepEqual(activeWorldIds(), ["cap-world-b", "cap-world-c"], "cap-world-a (least recently touched) was evicted");
  });

  it("never evicts a shard with active users — reports at_capacity instead", async () => {
    // Both current shards (b, c) now get a user each.
    markWorldUserCount("cap-world-b", 1);
    markWorldUserCount("cap-world-c", 1);
    const d = await ensureWorldActive("cap-world-d");
    assert.equal(d.ok, false);
    assert.equal(d.status, "at_capacity");
    assert.deepEqual(activeWorldIds(), ["cap-world-b", "cap-world-c"], "no shard was torn down out from under its users");
  });

  it("clearing a user frees that shard up for eviction again", async () => {
    markWorldUserCount("cap-world-b", -1); // back to 0 users
    const e = await ensureWorldActive("cap-world-e");
    assert.equal(e.ok, true, `expected eviction of the now-idle shard, got: ${JSON.stringify(e)}`);
    const worldIds = activeWorldIds();
    assert.ok(worldIds.includes("cap-world-e"));
    assert.ok(!worldIds.includes("cap-world-b"), "the now-idle shard was evicted, not the one still holding a user");
  });
});
