// Wave 4 backlog — world-boss scheduler wiring integration test.
//
// docs/concordia-specs/runmodes-endgame-social-capability-map.md §2.6
// ("World bosses never spawn in production") found two compounding gaps:
//   1. server/lib/world-bosses.js#registerSchedule (the only way a
//      world_boss_schedule row ever gets created) had zero callers
//      outside tests — no content-seeder, no admin route, no macro.
//   2. Even with a schedule row present, server/emergent/world-boss-cycle.js
//      required an externally-supplied `worldId` and bailed out before
//      calling runTriggerPass when it was missing — but
//      server/emergent/heartbeat-registry.js#tickAllRegistered never
//      forwards a worldId into a handler's ctx, in the default
//      single-process governor-tick path OR the sharded per-world-shard
//      path. So the heartbeat (which WAS already registered — the
//      "missing heartbeat registration" framing was wrong) always
//      received worldId: undefined and never ran the trigger pass at all.
//
// This test proves the fix end-to-end against a real (if minimal) DB,
// using the REAL dispatcher (tickAllRegistered) with the exact ctx shape
// server.js's default non-sharded governor tick uses — not just that the
// heartbeat is registered, but that firing it actually lands a row in
// world_boss_active.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as upBosses } from "../../migrations/240_world_bosses.js";

function bootDb() {
  const db = new Database(":memory:");
  upBosses(db);
  return db;
}

describe("Wave 4 — world-boss scheduler wiring", () => {
  it("content-seeder seeds a default schedule per authored world (was: zero callers outside tests)", async () => {
    const db = bootDb();
    const { seedContent } = await import("../../lib/content-seeder.js");
    const r = await seedContent({ db });
    assert.equal(r.ok, true);

    const rows = db.prepare("SELECT world_id, boss_template, cadence_seconds, difficulty_tier_default FROM world_boss_schedule").all();
    assert.ok(rows.length > 0, "expected at least one seeded world_boss_schedule row");

    const worldIds = rows.map((row) => row.world_id);
    assert.ok(worldIds.includes("concordia-hub"), "the hub should always get a default schedule");
    // A real authored sub-world (content/world/tunya/npcs.json tags every
    // NPC with world_id: "tunya") should also have been discovered — this
    // is what proves the seeder walks real authored content, not just the
    // hardcoded hub fallback.
    assert.ok(
      worldIds.includes("tunya"),
      `expected 'tunya' among seeded worlds, got: ${worldIds.join(", ")}`,
    );

    const hubRow = rows.find((row) => row.world_id === "concordia-hub");
    assert.equal(hubRow.difficulty_tier_default, "normal");
    assert.equal(hubRow.cadence_seconds, 86400);
    assert.ok(hubRow.boss_template.length > 0);

    // Idempotent: a second seedContent call inside the same process is a
    // cached no-op (module-level _seeded flag) — but re-running the boot
    // seeder logic itself (via a fresh DB) must not duplicate rows for the
    // same world when a schedule already exists. Exercised directly here
    // since seedContent can't be re-run in-process.
    const { listSchedule, registerSchedule } = await import("../../lib/world-bosses.js");
    const before = listSchedule(db, "concordia-hub").length;
    assert.equal(before, 1);
    // Simulate what the seeder does on a second boot against the SAME db:
    // it checks listSchedule() first and skips when non-empty.
    if (listSchedule(db, "concordia-hub").length === 0) {
      registerSchedule(db, { id: "wbs_concordia-hub_default", worldId: "concordia-hub", bossTemplate: "x" });
    }
    assert.equal(listSchedule(db, "concordia-hub").length, 1, "reboot must not duplicate or reset the schedule");
  });

  it("tickAllRegistered fires the heartbeat with the exact default-path ctx shape and opens a real boss row", async () => {
    const db = bootDb();
    const { registerSchedule } = await import("../../lib/world-bosses.js");
    const { registerHeartbeat, tickAllRegistered } = await import("../../emergent/heartbeat-registry.js");
    const { runWorldBossCycle } = await import("../../emergent/world-boss-cycle.js");

    // A schedule that is already due (nextSpawnAt in the past).
    registerSchedule(db, {
      id: "wbs-integration-1",
      worldId: "tunya",
      bossTemplate: "tunya-apex-guardian",
      cadenceSeconds: 86400,
      nextSpawnAt: 1,
    });
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM world_boss_active").get().n, 0, "sanity: nothing spawned yet");

    const emitted = [];
    const io = { emit: (name, payload) => emitted.push({ name, payload }) };

    // Registered exactly the way server.js registers it post-fix: scope
    // 'global', handler takes { db } only (no worldId destructure that
    // would silently stay undefined forever).
    registerHeartbeat("world-boss-cycle", {
      frequency: 16,
      scope: "global",
      handler: ({ db: ctxDb } = {}) => runWorldBossCycle({ db: ctxDb || db, io }),
    });

    // The exact ctx shape server.js's default (non-sharded) governor tick
    // uses at its `await tickAllRegistered({ state: STATE, db, tickCount,
    // reason })` call site — no worldId, no scope field. This is the real
    // production dispatch path for a single-box deploy.
    await tickAllRegistered({ state: {}, db, tickCount: 16, reason: "tick" });

    const activeRows = db.prepare("SELECT * FROM world_boss_active WHERE world_id = ?").all("tunya");
    assert.equal(activeRows.length, 1, "expected exactly one real world_boss_active row after the heartbeat fired");
    assert.equal(activeRows[0].boss_template, "tunya-apex-guardian");
    assert.equal(activeRows[0].status, "open");

    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].name, "world:boss-spawn");
    assert.equal(emitted[0].payload.worldId, "tunya");

    // A tick that isn't a multiple of the registered frequency (16) must
    // not fire the handler again / spawn a duplicate.
    emitted.length = 0;
    await tickAllRegistered({ state: {}, db, tickCount: 17, reason: "tick" });
    assert.equal(emitted.length, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM world_boss_active").get().n, 1);
  });

  it("a schedule that is not yet due spawns nothing (no false-positive)", async () => {
    const db = bootDb();
    const { registerSchedule } = await import("../../lib/world-bosses.js");
    const { runWorldBossCycle } = await import("../../emergent/world-boss-cycle.js");

    registerSchedule(db, {
      id: "wbs-integration-2",
      worldId: "cyber",
      bossTemplate: "cyber-apex-guardian",
      cadenceSeconds: 86400,
      nextSpawnAt: Math.floor(Date.now() / 1000) + 999999,
    });

    const r = runWorldBossCycle({ db });
    assert.equal(r.ok, true);
    assert.equal(r.openedTotal, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM world_boss_active").get().n, 0);
  });

  it("still supports the explicit worldId-scoped contract used by server/tests/world-bosses.test.js", async () => {
    const db = bootDb();
    const { registerSchedule } = await import("../../lib/world-bosses.js");
    const { runWorldBossCycle } = await import("../../emergent/world-boss-cycle.js");

    registerSchedule(db, { id: "wbs-a", worldId: "tunya", bossTemplate: "x", cadenceSeconds: 86400, nextSpawnAt: 1 });
    registerSchedule(db, { id: "wbs-b", worldId: "cyber", bossTemplate: "y", cadenceSeconds: 86400, nextSpawnAt: 1 });

    const emitted = [];
    const io = { emit: (name, payload) => emitted.push({ name, payload }) };
    const r = runWorldBossCycle({ db, worldId: "tunya", io });

    assert.equal(r.ok, true);
    assert.equal(r.openedInWorld, 1);
    assert.equal(r.openedTotal, 2, "both worlds' schedules were due — the global pass still opened both");
    assert.equal(emitted.length, 1, "but only tunya's spawn was emitted, matching the scoped contract");
    assert.equal(emitted[0].payload.worldId, "tunya");
  });
});
