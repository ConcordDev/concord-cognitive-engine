// server/emergent/world-boss-cycle.js
//
// Phase BD1 — world boss scheduler heartbeat.
//
// Frequency 16 (~4 min). Per active world: trigger pass for due
// schedules + sweep expired actives. Kill-switch:
// CONCORD_WORLD_BOSSES_ENABLED=0.

import logger from "../logger.js";
import { runTriggerPass, sweepExpiredActive } from "../lib/world-bosses.js";

export function runWorldBossCycle({ db, worldId, io } = {}) {
  if (!db || !worldId) return { ok: false, reason: "no_db_or_world" };
  if (process.env.CONCORD_WORLD_BOSSES_ENABLED === "0") {
    return { ok: true, skipped: "disabled_by_env" };
  }

  try {
    sweepExpiredActive(db);
    const r = runTriggerPass(db);
    if (!r.ok) return r;
    // Emit one event per newly-opened boss in this world.
    const inWorld = r.opened.filter(o => o.worldId === worldId);
    for (const o of inWorld) {
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
    if (inWorld.length > 0) {
      logger.info?.("world-boss-cycle", "tick", { worldId, opened: inWorld.length });
    }
    return { ok: true, world: worldId, openedInWorld: inWorld.length };
  } catch (err) {
    return { ok: false, reason: err?.message };
  }
}
