// Phase BD1 — world boss scheduler tests.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  registerSchedule, runTriggerPass, defeatBoss, isLockedOut,
  listActiveBosses, listSchedule, sweepExpiredActive,
  DEFAULT_LOCKOUT_HOURS,
} from "../lib/world-bosses.js";
import { runWorldBossCycle } from "../emergent/world-boss-cycle.js";
import { up as upBosses } from "../migrations/240_world_bosses.js";

function freshDb() { const db = new Database(":memory:"); upBosses(db); return db; }

describe("Phase BD1 — world boss scheduler", () => {
  let db;
  beforeEach(() => { db = freshDb(); delete process.env.CONCORD_WORLD_BOSSES_ENABLED; });

  it("registerSchedule + runTriggerPass opens an active row when due", () => {
    registerSchedule(db, {
      id: "wbs-1", worldId: "tunya", bossTemplate: "river-serpent",
      cadenceSeconds: 86400, nextSpawnAt: 100,
    });
    const r = runTriggerPass(db, { now: 200 });
    assert.equal(r.opened.length, 1);
    const active = listActiveBosses(db, "tunya");
    assert.equal(active.length, 1);
  });

  it("trigger pass advances next_spawn_at by cadence", () => {
    registerSchedule(db, {
      id: "wbs-1", worldId: "tunya", bossTemplate: "x",
      cadenceSeconds: 3600, nextSpawnAt: 100,
    });
    runTriggerPass(db, { now: 200 });
    const sched = listSchedule(db, "tunya")[0];
    assert.equal(sched.next_spawn_at, 200 + 3600);
  });

  it("defeatBoss applies lockout per difficulty tier", () => {
    registerSchedule(db, {
      id: "wbs-1", worldId: "tunya", bossTemplate: "x",
      cadenceSeconds: 86400, nextSpawnAt: 100, difficultyTierDefault: "heroic",
    });
    runTriggerPass(db, { now: 200 });
    const active = listActiveBosses(db, "tunya")[0];
    const r = defeatBoss(db, { activeId: active.id, participantUserIds: ["p1", "p2"] });
    assert.equal(r.ok, true);
    assert.equal(r.lockoutHours, DEFAULT_LOCKOUT_HOURS.heroic);
    assert.equal(isLockedOut(db, "p1", "wbs-1"), true);
    assert.equal(isLockedOut(db, "p2", "wbs-1"), true);
    assert.equal(isLockedOut(db, "p3", "wbs-1"), false);
  });

  it("re-defeat is rejected", () => {
    registerSchedule(db, { id: "wbs-1", worldId: "tunya", bossTemplate: "x", cadenceSeconds: 86400, nextSpawnAt: 100 });
    runTriggerPass(db, { now: 200 });
    const a = listActiveBosses(db, "tunya")[0];
    defeatBoss(db, { activeId: a.id, participantUserIds: ["p1"] });
    const r = defeatBoss(db, { activeId: a.id, participantUserIds: ["p1"] });
    assert.equal(r.ok, false);
    assert.equal(r.error, "already_defeated");
  });

  it("listActiveBosses filters by world + status + window", () => {
    registerSchedule(db, { id: "wbs-1", worldId: "tunya", bossTemplate: "x", cadenceSeconds: 86400, nextSpawnAt: 100 });
    registerSchedule(db, { id: "wbs-2", worldId: "cyber", bossTemplate: "y", cadenceSeconds: 86400, nextSpawnAt: 100 });
    runTriggerPass(db, { now: 200 });
    assert.equal(listActiveBosses(db, "tunya").length, 1);
    assert.equal(listActiveBosses(db, "cyber").length, 1);
  });

  it("sweepExpiredActive flips status when closes_at passed", () => {
    registerSchedule(db, { id: "wbs-1", worldId: "tunya", bossTemplate: "x", cadenceSeconds: 86400, nextSpawnAt: 100 });
    runTriggerPass(db, { now: 200 });
    db.prepare(`UPDATE world_boss_active SET closes_at = 1`).run();
    const s = sweepExpiredActive(db);
    assert.equal(s.expired, 1);
  });
});

describe("Phase BD1 — heartbeat handler", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("emits world:boss-spawn for opened bosses in this world only", () => {
    registerSchedule(db, { id: "wbs-1", worldId: "tunya", bossTemplate: "x", cadenceSeconds: 86400, nextSpawnAt: 1 });
    registerSchedule(db, { id: "wbs-2", worldId: "cyber", bossTemplate: "y", cadenceSeconds: 86400, nextSpawnAt: 1 });
    const emits = [];
    const io = { emit: (n, p) => emits.push({ name: n, payload: p }) };
    runWorldBossCycle({ db, worldId: "tunya", io });
    const tunya = emits.filter(e => e.payload.worldId === "tunya");
    assert.equal(tunya.length, 1);
    assert.equal(tunya[0].name, "world:boss-spawn");
  });

  it("env disable short-circuits", () => {
    process.env.CONCORD_WORLD_BOSSES_ENABLED = "0";
    const r = runWorldBossCycle({ db, worldId: "tunya" });
    assert.equal(r.skipped, "disabled_by_env");
    delete process.env.CONCORD_WORLD_BOSSES_ENABLED;
  });
});
