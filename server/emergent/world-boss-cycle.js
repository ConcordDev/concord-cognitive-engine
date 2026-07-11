// server/emergent/world-boss-cycle.js
//
// Phase BD1 — world boss scheduler heartbeat.
//
// Frequency 16 (~4 min). Sweeps expired actives + runs a trigger pass
// that opens every schedule (across every world) whose next_spawn_at
// <= now — server/lib/world-bosses.js#runTriggerPass already scans the
// whole world_boss_schedule table in one query, so this handler doesn't
// need a per-world worldId to do useful work. Kill-switch:
// CONCORD_WORLD_BOSSES_ENABLED=0.
//
// Wave 4 backlog fix (2026-07-11, docs/concordia-specs/
// runmodes-endgame-social-capability-map.md §2.6): this heartbeat WAS
// already registered (registerHeartbeat("world-boss-cycle", ...) in
// server.js) — the "missing heartbeat" framing in the backlog item was
// wrong on that specific point. Two real bugs combined to keep it dark:
//   1. Nothing ever called world-bosses.js#registerSchedule outside
//      tests, so world_boss_schedule was permanently empty. Fixed by a
//      boot-time seeder in content-seeder.js (one default schedule per
//      active world, idempotent).
//   2. This handler required an externally-supplied `worldId` and bailed
//      out before calling runTriggerPass when it was missing — but
//      server/emergent/heartbeat-registry.js#tickAllRegistered NEVER
//      forwards a worldId into a handler's ctx, in the default
//      single-process path OR the sharded per-world-shard path (verified
//      at runtime: its `moduleCtx` literal is `{ state, db, tickCount,
//      reason }` — no worldId key, ever). So even with schedule rows
//      present, this handler always received `worldId: undefined` and
//      early-returned `no_db_or_world` before running the trigger pass —
//      the real, deeper reason nothing ever spawned, one layer under the
//      "empty table" framing the backlog doc used.
// Fix: `worldId` is now optional. When absent (the real production
// case), run one GLOBAL pass and emit world:boss-spawn for every
// newly-opened boss in every world — this is the shape farm-growth-cycle
// and announcement-broadcaster already use for scope:'global' heartbeats,
// and matches what runTriggerPass already does internally. When a
// worldId IS explicitly supplied (kept for the existing per-world-scoped
// test/manual-invocation contract), filter to that world only —
// unchanged prior behavior.

import logger from "../logger.js";
import { runTriggerPass, sweepExpiredActive } from "../lib/world-bosses.js";

export function runWorldBossCycle({ db, worldId, io } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  if (process.env.CONCORD_WORLD_BOSSES_ENABLED === "0") {
    return { ok: true, skipped: "disabled_by_env" };
  }

  try {
    sweepExpiredActive(db);
    const r = runTriggerPass(db);
    if (!r.ok) return r;
    // worldId given: scoped to that world (back-compat). worldId absent
    // (the real dispatcher case): every newly-opened boss, every world.
    const opened = worldId ? r.opened.filter(o => o.worldId === worldId) : r.opened;
    for (const o of opened) {
      try {
        io?.emit?.("world:boss-spawn", {
          activeId: o.activeId, scheduleId: o.scheduleId,
          worldId: o.worldId, bossTemplate: o.bossTemplate,
          ts: Math.floor(Date.now() / 1000),
        });
      } catch (err) {
        logger.debug?.("world-boss-cycle", "emit_failed", { error: err?.message });
      }
    }
    if (opened.length > 0) {
      logger.info?.("world-boss-cycle", "tick", { worldId: worldId || "*", opened: opened.length });
    }
    return { ok: true, world: worldId || "*", openedInWorld: opened.length, openedTotal: r.opened.length };
  } catch (err) {
    return { ok: false, reason: err?.message };
  }
}
