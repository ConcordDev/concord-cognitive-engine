// Records one real district snapshot per world into the district snapshot
// store (domains/district.js). districtId = world id, matching the sim
// stress-test route. buildingCount = non-collapsed world_buildings rows;
// population = worlds.population. activeUsers is not measured here, so it
// is stored as null. Never throws: missing tables are a logged no-op.

import { recordDistrictSnapshot, listDistrictSnapshots } from "../domains/district.js";
import logger from "../logger.js";

export const MAX_WORLDS_PER_TICK = 200;
export const MIN_INTERVAL_MS = 55 * 60 * 1000;

function hasColumn(db, table, col) {
  try {
    return db.prepare("SELECT name FROM pragma_table_info(?)").all(table).some((c) => c.name === col);
  } catch {
    return false;
  }
}

export function runDistrictSnapshotHeartbeat({ db, now = Date.now() } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  try {
    if (!hasColumn(db, "worlds", "population")) {
      logger?.debug?.("district-snapshot", "skipped: worlds.population missing");
      return { ok: false, reason: "no_worlds_table" };
    }
    if (!hasColumn(db, "world_buildings", "world_id")) {
      logger?.debug?.("district-snapshot", "skipped: world_buildings missing");
      return { ok: false, reason: "no_world_buildings_table" };
    }
    const hasState = hasColumn(db, "world_buildings", "state");
    const worlds = db.prepare("SELECT id, population FROM worlds ORDER BY id LIMIT ?").all(MAX_WORLDS_PER_TICK);
    const countStmt = db.prepare(
      hasState
        ? "SELECT COUNT(*) AS n FROM world_buildings WHERE world_id = ? AND (state IS NULL OR state != 'collapsed')"
        : "SELECT COUNT(*) AS n FROM world_buildings WHERE world_id = ?",
    );
    let recorded = 0;
    let skippedRecent = 0;
    for (const w of worlds) {
      try {
        const id = String(w.id || "");
        if (!id) continue;
        const prior = listDistrictSnapshots(id, { limit: 1 });
        const last = prior.ok ? prior.result.snapshots[0] : null;
        if (last && now - last.ts < MIN_INTERVAL_MS) { skippedRecent++; continue; }
        const buildingCount = Number(countStmt.get(id)?.n) || 0;
        const r = recordDistrictSnapshot({
          districtId: id,
          buildingCount,
          population: Math.max(0, Number(w.population) || 0),
          activeUsers: null,
          at: new Date(now).toISOString(),
        });
        if (r.ok) recorded++;
      } catch (e) {
        logger?.debug?.("district-snapshot", `world skipped: ${e?.message || e}`);
      }
    }
    return { ok: true, worlds: worlds.length, recorded, skippedRecent };
  } catch (e) {
    logger?.debug?.("district-snapshot", `heartbeat failed: ${e?.message || e}`);
    return { ok: false, reason: "error", message: String(e?.message || e) };
  }
}
