// server/domains/ecology.js
//
// Phase 6 — surfaces creature homes, sleep patterns, and ecology
// imbalance signals to the world HUD.
//
// Macros (all read-only, safe for publicReadDomains):
//
//   ecology.homes_for_world         — list creature_homes rows
//   ecology.sleep_patterns           — list creature_sleep_patterns rows
//   ecology.imbalances               — list unresolved imbalance signals
//   ecology.is_at_home               — boolean check for a species at hour

import {
  listHomesForWorld,
  unresolvedImbalances,
  isAtHomeHour,
} from "../lib/ecosystem/creature-homes.js";

export default function registerEcologyMacros(register) {
  register("ecology", "homes_for_world", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const { worldId, limit } = input || {};
    if (!worldId) return { ok: false, reason: "missing_worldId" };
    const homes = listHomesForWorld(db, worldId, Math.min(500, Math.max(1, Number(limit) || 200)));
    return { ok: true, worldId, homes, count: homes.length };
  }, { note: "List of creature homes (caves / nests / burrows / dens / lairs / roosts / warrens) for the world." });

  register("ecology", "sleep_patterns", async (ctx) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    let patterns = [];
    try {
      patterns = db.prepare(`
        SELECT species_id, active_phase, active_start_hour, active_end_hour, is_hibernator, hibernate_months
        FROM creature_sleep_patterns
        ORDER BY species_id
      `).all();
    } catch { patterns = []; }
    return { ok: true, patterns, count: patterns.length };
  }, { note: "Per-species circadian pattern + hibernation flag." });

  register("ecology", "imbalances", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const { worldId } = input || {};
    const rows = unresolvedImbalances(db, worldId || null, 50);
    return { ok: true, worldId: worldId || null, imbalances: rows, count: rows.length };
  }, { note: "Unresolved predator-prey imbalance signals. Lattice-quest-cycle drains these into procedural quests." });

  register("ecology", "is_at_home", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const { speciesId, hour } = input || {};
    if (!speciesId || typeof hour !== "number") return { ok: false, reason: "missing_inputs" };
    return { ok: true, speciesId, hour, atHome: isAtHomeHour(db, speciesId, hour) };
  }, { note: "Returns true when the given species is in its rest window at the given world hour." });
}
