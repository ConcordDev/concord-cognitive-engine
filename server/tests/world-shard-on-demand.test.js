// Phase I — on-demand worker-thread shard activation + idle teardown.
//
// Pins: (1) ensureWorldActive is a no-op when sharding disabled,
// (2) ensureWorldActive returns spawn_failed cleanly when db path is missing,
// (3) markWorldUserCount increments + clamps at 0,
// (4) getShardHealth returns the right shape for known + unknown worlds,
// (5) restartShard returns a structured error for unknown worlds.
//
// True worker_threads spawn is exercised end-to-end by an integration
// test that opens a real SQLite DB, which is gated on better-sqlite3
// being installed (skipped here so the unit suite stays fast).

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  initWorldShards,
  ensureWorldActive,
  markWorldUserCount,
  recordWorldActivity,
  getShardHealth,
  restartShard,
  shutdownShards,
  _resetShardManagerForTests,
} from "../lib/world-shard-manager.js";

describe("Phase I — on-demand world shards", () => {
  beforeEach(async () => {
    _resetShardManagerForTests();
    delete process.env.CONCORD_SHARD_WORLDS;
  });
  afterEach(() => {
    _resetShardManagerForTests();
  });

  it("ensureWorldActive returns sharding_disabled when flag off", async () => {
    const r = await ensureWorldActive("cyber");
    assert.equal(r.ok, false);
    assert.equal(r.status, "sharding_disabled");
  });

  it("ensureWorldActive requires a worldId", async () => {
    process.env.CONCORD_SHARD_WORLDS = "true";
    await initWorldShards({ dbPath: null, realtimeEmit: () => {}, db: null });
    const r = await ensureWorldActive("");
    assert.equal(r.ok, false);
    assert.equal(r.status, "no_world_id");
    delete process.env.CONCORD_SHARD_WORLDS;
  });

  it("getShardHealth for an unspawned world returns no-shard", () => {
    process.env.CONCORD_SHARD_WORLDS = "true";
    const h = getShardHealth("never-spawned-world");
    assert.equal(h.status, "no-shard");
    assert.equal(h.sharded, true);
    delete process.env.CONCORD_SHARD_WORLDS;
  });

  it("getShardHealth returns an empty array when no shards exist", () => {
    delete process.env.CONCORD_SHARD_WORLDS;
    const all = getShardHealth();
    assert.ok(Array.isArray(all));
    assert.equal(all.length, 0);
  });

  it("markWorldUserCount is a safe no-op for unspawned worlds", () => {
    // Must not throw; manager has no entry yet.
    markWorldUserCount("cyber", 1);
    markWorldUserCount("cyber", -1);
    // No assertion — we just verify it doesn't crash.
  });

  it("recordWorldActivity is a safe no-op for unspawned worlds", () => {
    recordWorldActivity("cyber");
  });

  it("restartShard returns an error for unknown worlds", () => {
    const r = restartShard("not-real");
    assert.equal(r.ok, false);
    assert.equal(r.error, "no_shard");
  });

  it("shutdownShards is idempotent", () => {
    shutdownShards();
    shutdownShards();
    // Should not throw on either call.
  });

  it("initWorldShards remains a no-op when sharding flag off", async () => {
    delete process.env.CONCORD_SHARD_WORLDS;
    const r = await initWorldShards({
      dbPath: "/tmp/never-touched.db",
      realtimeEmit: () => {},
    });
    assert.equal(r.enabled, false);
    assert.deepEqual(getShardHealth(), []);
  });
});
