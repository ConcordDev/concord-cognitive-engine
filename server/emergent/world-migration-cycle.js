// server/emergent/world-migration-cycle.js
//
// WS3 — outward-migration engine, NPC re-anchor half (the discrete step that
// complements the continuous creature drift in creature-flock-cycle).
//
// As NPCs/hostiles gain levels and evolve skills, the ones that out-level the
// ring they're standing in are nudged outward toward the inner edge of their
// home band. Over many passes the strong drain toward the frontier, leaving the
// hub for fresh weak spawns — keeping the danger gradient self-maintaining and
// new-player-friendly. Conservation: this only MOVES NPCs (x/z + current_location),
// never creates or deletes. Per-world scope so it's shard-safe (it writes the
// per-world `world_npcs` table). Immortal/named anchors (the Sovereign + rivals)
// are skipped — they're the fixed ceiling, not migrants.
//
// Gated: no-op unless CONCORD_RADIAL_WORLDS is on; hard kill-switch
// CONCORD_WORLD_MIGRATION=0. Per the heartbeat invariant: never throws.

import logger from "../logger.js";
import { gradientConfigFor, hubAnchorFor, radialWorldsEnabled } from "../lib/world-gradient.js";
import { migrationStep, homeInnerRadius } from "../lib/world-migration.js";
import { getEntityCombatLevel } from "../lib/entity-power.js";

const MAX_WORLDS_PER_PASS = 8;
const MAX_NPCS_PER_WORLD = 60;
// Cap a single pass's outward step so migration reads as a journey, not a teleport.
const MAX_STEP_M = (() => {
  const v = Number(process.env.CONCORD_MIGRATION_STEP_M);
  return Number.isFinite(v) && v > 0 ? v : 40;
})();

function discoverWorlds(db) {
  let worlds = [];
  try {
    worlds = db.prepare(`
      SELECT DISTINCT world_id FROM world_visits WHERE departed_at IS NULL LIMIT ?
    `).all(MAX_WORLDS_PER_PASS).map((r) => r.world_id).filter(Boolean);
  } catch { /* world_visits optional */ }
  if (worlds.length === 0) {
    try {
      worlds = db.prepare(`
        SELECT DISTINCT world_id FROM world_npcs WHERE COALESCE(is_dead, 0) = 0 LIMIT ?
      `).all(MAX_WORLDS_PER_PASS).map((r) => r.world_id).filter(Boolean);
    } catch { /* no table */ }
  }
  return worlds;
}

function migrateWorld(db, worldId) {
  const world = (() => {
    try { return db.prepare(`SELECT * FROM worlds WHERE id = ?`).get(worldId); }
    catch { return null; }
  })();
  const cfg = gradientConfigFor(world || null);
  const anchor = hubAnchorFor(db, worldId, cfg);

  let rows;
  try {
    // Migrable NPCs: alive, non-creature (creatures drift via the flock cycle),
    // not immortal anchors. Bounded per pass.
    rows = db.prepare(`
      SELECT id, x, z, level FROM world_npcs
      WHERE world_id = ?
        AND COALESCE(is_dead, 0) = 0
        AND COALESCE(is_immortal, 0) = 0
        AND archetype NOT LIKE 'creature:%'
        AND x IS NOT NULL AND z IS NOT NULL
      LIMIT ?
    `).all(worldId, MAX_NPCS_PER_WORLD);
  } catch {
    return { moved: 0 };
  }
  if (!rows || rows.length === 0) return { moved: 0 };

  const updates = [];
  for (const npc of rows) {
    // Drive migration off GROWN combat strength (skill > nominal level).
    let level = npc.level || 1;
    try { level = Math.max(level, getEntityCombatLevel(db, npc.id)); } catch { /* keep nominal */ }
    // Cheap pre-check before the step math.
    if ((Math.hypot(npc.x - anchor.x, npc.z - anchor.z)) >= homeInnerRadius(cfg, level)) continue;
    const next = migrationStep(cfg, anchor, npc.x, npc.z, level, MAX_STEP_M);
    if (next) updates.push({ id: npc.id, x: next.x, z: next.z });
  }

  if (updates.length > 0) {
    try {
      const upd = db.prepare(
        `UPDATE world_npcs SET x = ?, z = ?, current_location = ? WHERE id = ?`
      );
      const tx = db.transaction((list) => {
        for (const u of list) upd.run(u.x, u.z, JSON.stringify({ x: u.x, z: u.z }), u.id);
      });
      tx(updates);
    } catch {
      // Stricter schema without current_location — fall back to x/z only.
      try {
        const upd = db.prepare(`UPDATE world_npcs SET x = ?, z = ? WHERE id = ?`);
        const tx = db.transaction((list) => { for (const u of list) upd.run(u.x, u.z, u.id); });
        tx(updates);
      } catch { /* best-effort */ }
    }
  }
  return { moved: updates.length };
}

export async function runWorldMigrationCycle({ db, tickCount: _t } = {}) {
  if (process.env.CONCORD_WORLD_MIGRATION === "0") return { ok: false, reason: "disabled" };
  if (!radialWorldsEnabled()) return { ok: true, reason: "radial_worlds_off", moved: 0 };
  if (!db) return { ok: false, reason: "no_db" };

  const stats = { ok: true, worldsTouched: 0, totalMoved: 0 };
  for (const worldId of discoverWorlds(db)) {
    try {
      const r = migrateWorld(db, worldId);
      stats.worldsTouched++;
      stats.totalMoved += r.moved ?? 0;
    } catch (err) {
      logger?.warn?.("world-migration-cycle: world failed", { worldId, err: err?.message });
    }
  }
  return stats;
}
