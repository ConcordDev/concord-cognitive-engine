// Phase F — world-shard protocol + ownership rules.
//
// Pins: (1) shardingEnabled defaults false and flips with the env var,
// (2) per-world write tables vs user-global write tables are disjoint
// and well-known, (3) the manager is a safe no-op when sharding disabled.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

import {
  PER_WORLD_WRITE_TABLES,
  USER_GLOBAL_WRITE_TABLES,
  shardingEnabled,
} from "../lib/world-shard-protocol.js";
import { initWorldShards, getShardHealth } from "../lib/world-shard-manager.js";

describe("Phase F — world shard protocol", () => {
  it("shardingEnabled defaults false", () => {
    delete process.env.CONCORD_SHARD_WORLDS;
    assert.equal(shardingEnabled(), false);
  });

  it("CONCORD_SHARD_WORLDS=true flips the flag", () => {
    process.env.CONCORD_SHARD_WORLDS = "true";
    assert.equal(shardingEnabled(), true);
    delete process.env.CONCORD_SHARD_WORLDS;
  });

  it("per-world and user-global write sets are disjoint", () => {
    for (const t of PER_WORLD_WRITE_TABLES) {
      assert.equal(USER_GLOBAL_WRITE_TABLES.has(t), false, `table ${t} cannot be in both sets`);
    }
  });

  it("per-world set contains the major world-scoped tables", () => {
    for (const t of ["world_npcs", "city_presence", "world_events", "embodied_signal_log", "dreams"]) {
      assert.ok(PER_WORLD_WRITE_TABLES.has(t), `expected per-world table: ${t}`);
    }
  });

  it("user-global set contains the major user-scoped tables", () => {
    for (const t of ["users", "user_wallets", "dtus", "economy_ledger", "player_inventory"]) {
      assert.ok(USER_GLOBAL_WRITE_TABLES.has(t), `expected user-global table: ${t}`);
    }
  });

  it("initWorldShards is a safe no-op when sharding disabled", async () => {
    delete process.env.CONCORD_SHARD_WORLDS;
    const r = await initWorldShards({
      dbPath: "/tmp/never-touched.db",
      realtimeEmit: () => {},
    });
    assert.equal(r.enabled, false);
    assert.deepEqual(getShardHealth(), []);
  });
});
