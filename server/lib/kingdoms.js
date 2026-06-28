// server/lib/kingdoms.js
//
// Sprint C / Track D1 — kingdom schema seeding, citizen loyalty,
// region-scoped decree queries.
//
// A kingdom is a layer above a faction: it has territory (regions),
// citizens (NPCs in those regions), a ruler (NPC or player), legitimacy,
// treasury, and tax rate. Decrees + rebellion live in
// kingdom-decrees.js + kingdom-rebellion.js.

import crypto from "node:crypto";
import logger from "../logger.js";
import { aggregateOpinionsToTarget, recordOpinionEvent } from "./npc-opinions.js";

const DEFAULT_LEGITIMACY = 60;
const DEFAULT_TAX = 0.10;
const DEFAULT_TREASURY = 1000;

/**
 * Seed kingdoms from a list of authored factions. Idempotent. Caller
 * supplies the factions array (typically from content-seeder).
 *
 * Each faction with a leader_npc_id and at least one assigned region
 * becomes a kingdom row. Picks territory by querying procgen_regions
 * WHERE faction_id matches.
 */
export function seedKingdomsFromFactions(db, factions = null) {
  if (!db) return { ok: false, reason: "no_db" };
  if (!Array.isArray(factions)) factions = [];
  return seedSync(db, factions);
}

function seedSync(db, factions) {
  let inserted = 0, skipped = 0;
  // Hoist prepared statements out of the per-faction loop so we don't
  // re-prepare on every iteration (perf-hotspot N+1 pattern).
  const insertRealmStmt = db.prepare(`
    INSERT INTO realms (id, name, world_id, faction_id, ruler_kind, ruler_id, legitimacy, treasury, tax_rate)
    VALUES (?, ?, ?, ?, 'npc', ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `);
  let selectRegionsStmt = null;
  let insertTerritoryStmt = null;
  try {
    selectRegionsStmt = db.prepare(`SELECT id FROM procgen_regions WHERE faction_id = ? LIMIT 50`);
    insertTerritoryStmt = db.prepare(`INSERT INTO realm_territories (kingdom_id, region_id) VALUES (?, ?) ON CONFLICT DO NOTHING`);
  } catch { /* procgen_regions / realm_territories optional */ }

  for (const f of factions || []) {
    if (!f?.id) continue;
    const leaderId = f.leader_npc_id || f.leader || null;
    if (!leaderId) { skipped++; continue; }
    const worldId = f.home_world || f.world_id || "concordia-hub";
    const id = `kd_${stableHash(f.id)}`;
    try {
      const r = insertRealmStmt.run(id, f.name || f.id, worldId, f.id, leaderId, DEFAULT_LEGITIMACY, DEFAULT_TREASURY, DEFAULT_TAX);
      if (r.changes > 0) inserted++; else skipped++;

      // Best-effort: assign existing procgen_regions with this faction_id
      // as kingdom territory.
      if (selectRegionsStmt && insertTerritoryStmt) {
        try {
          const regions = selectRegionsStmt.all(f.id);
          for (const reg of regions) {
            insertTerritoryStmt.run(id, reg.id);
          }
        } catch { /* procgen_regions optional */ }
      }
    } catch (err) {
      try { logger.debug?.("kingdom_seed_failed", { factionId: f.id, error: err?.message }); } catch { /* noop */ }
    }
  }
  return { ok: true, inserted, skipped };
}

function stableHash(input) {
  return crypto.createHash("sha1").update(String(input)).digest("hex").slice(0, 16);
}

/** Look up a kingdom by id. */
export function getKingdom(db, kingdomId) {
  if (!db || !kingdomId) return null;
  return db.prepare(`SELECT * FROM realms WHERE id = ?`).get(kingdomId) || null;
}

/** List all kingdoms in a world. */
export function listKingdomsForWorld(db, worldId) {
  if (!db || !worldId) return [];
  return db.prepare(`SELECT * FROM realms WHERE world_id = ? ORDER BY name`).all(worldId);
}

/** Set or change a kingdom's ruler. */
export function assignRuler(db, kingdomId, { rulerKind, rulerId, legitimacy = DEFAULT_LEGITIMACY }) {
  if (!db || !kingdomId || !rulerKind) return { ok: false, reason: "missing_inputs" };
  if (!["npc", "player", "interregnum"].includes(rulerKind)) return { ok: false, reason: "invalid_ruler_kind" };
  const r = db.prepare(`
    UPDATE realms SET ruler_kind = ?, ruler_id = ?, legitimacy = ?, updated_at = unixepoch()
    WHERE id = ?
  `).run(rulerKind, rulerId || null, legitimacy, kingdomId);
  return { ok: true, changes: r.changes };
}

/**
 * Recompute citizen loyalty for a kingdom. Loyalty derives from each
 * citizen NPC's opinion of the ruler + faction alignment + tax pressure.
 * Returns { ok, refreshed, count }.
 */
export function recomputeCitizenLoyalty(db, kingdomId) {
  if (!db || !kingdomId) return { ok: false };
  const k = getKingdom(db, kingdomId);
  if (!k) return { ok: false, reason: "kingdom_not_found" };

  // Citizens: NPCs whose region_id is in realm_territories. Best-effort:
  // if procgen_regions / world_npcs lacks a region link, fall back to
  // matching faction membership.
  let citizens = [];
  try {
    citizens = db.prepare(`
      SELECT DISTINCT n.id FROM world_npcs n
      WHERE n.faction = ? AND COALESCE(n.is_dead, 0) = 0
      LIMIT 500
    `).all(k.faction_id || "");
  } catch { /* table absent */ }

  let refreshed = 0;
  for (const c of citizens) {
    // Citizen's opinion of the ruler (if NPC ruler) is the strongest signal.
    let opinionOfRuler = 0;
    if (k.ruler_id) {
      try {
        const r = db.prepare(`
          SELECT score FROM character_opinions WHERE npc_id = ? AND target_kind = ? AND target_id = ?
        `).get(c.id, k.ruler_kind === "player" ? "player" : "npc", k.ruler_id);
        opinionOfRuler = r?.score ?? 0;
      } catch { /* opinions optional */ }
    }
    // Tax pressure: high tax_rate (>0.20) drags loyalty.
    const taxPenalty = Math.max(0, (Number(k.tax_rate) - 0.20) * 100);
    const loyalty = Math.max(0, Math.min(100, 50 + Math.round(opinionOfRuler / 2) - taxPenalty));
    db.prepare(`
      INSERT INTO realm_citizens (npc_id, kingdom_id, loyalty)
      VALUES (?, ?, ?)
      ON CONFLICT(npc_id, kingdom_id) DO UPDATE SET loyalty = excluded.loyalty, last_review_at = unixepoch()
    `).run(c.id, kingdomId, loyalty);
    refreshed++;
  }
  return { ok: true, refreshed, count: citizens.length };
}

/** Decrees that apply at a given region (lookup helper for dialogue/quest engines). */
export function decreesActiveForRegion(db, regionId) {
  if (!db || !regionId) return [];
  try {
    return db.prepare(`
      SELECT d.* FROM realm_decrees d
      JOIN realm_territories t ON t.kingdom_id = d.kingdom_id
      WHERE t.region_id = ? AND d.effect_state = 'active'
        AND (d.expires_at IS NULL OR d.expires_at > unixepoch())
      ORDER BY d.issued_at DESC LIMIT 20
    `).all(regionId);
  } catch { return []; }
}

/** Aggregate kingdom citizen loyalty (avg + count). */
export function kingdomLoyaltySummary(db, kingdomId) {
  if (!db || !kingdomId) return { avg: 0, count: 0, low: 0, high: 0 };
  try {
    const r = db.prepare(`
      SELECT AVG(loyalty) AS avg, COUNT(*) AS count, MIN(loyalty) AS low, MAX(loyalty) AS high
      FROM realm_citizens WHERE kingdom_id = ?
    `).get(kingdomId);
    return {
      avg: Math.round(r?.avg ?? 50),
      count: r?.count ?? 0,
      low: r?.low ?? 0,
      high: r?.high ?? 0,
    };
  } catch { return { avg: 50, count: 0, low: 0, high: 0 }; }
}

/** Adjust legitimacy + log via kingdom row. */
export function adjustLegitimacy(db, kingdomId, delta, _reason) {
  if (!db || !kingdomId || !delta) return { ok: false };
  const k = getKingdom(db, kingdomId);
  if (!k) return { ok: false, reason: "kingdom_not_found" };
  const next = Math.max(0, Math.min(100, k.legitimacy + delta));
  db.prepare(`UPDATE realms SET legitimacy = ?, updated_at = unixepoch() WHERE id = ?`).run(next, kingdomId);
  return { ok: true, legitimacy: next };
}

/** Update treasury (for tax/decree economics). */
export function adjustTreasury(db, kingdomId, delta) {
  if (!db || !kingdomId) return { ok: false };
  // Fail-closed numeric guard: a poisoned/derived delta (env-sourced
  // CONCORD_CIVIC_INHOUSE_FACTOR, computed loot, Infinity/NaN/1e308) must
  // never corrupt the realm treasury. Reject anything non-finite or
  // absurdly large in magnitude before it reaches the SQL write. This runs
  // BEFORE the no-op short-circuit so callers always get a clear reason.
  const n = Number(delta);
  if (!Number.isFinite(n) || Math.abs(n) > 1e9) return { ok: false, reason: "invalid_delta" };
  if (n === 0) return { ok: false, reason: "noop" };
  db.prepare(`UPDATE realms SET treasury = MAX(0, treasury + ?), updated_at = unixepoch() WHERE id = ?`).run(n, kingdomId);
  return { ok: true };
}

export const KINGDOM_CONSTANTS = Object.freeze({
  DEFAULT_LEGITIMACY,
  DEFAULT_TAX,
  DEFAULT_TREASURY,
});

// Cascade helper: opinion-of-ruler shift for all citizens (used by decree
// pipeline). delta is per-citizen.
export function cascadeOpinionToCitizens(db, kingdomId, delta, reason) {
  if (!db || !kingdomId) return { ok: false };
  const k = getKingdom(db, kingdomId);
  if (!k?.ruler_id) return { ok: false, reason: "no_ruler" };
  const citizens = db.prepare(`SELECT npc_id FROM realm_citizens WHERE kingdom_id = ?`).all(kingdomId);
  let touched = 0;
  for (const c of citizens) {
    recordOpinionEvent(db,
      { npcId: c.npc_id, targetKind: k.ruler_kind === "player" ? "player" : "npc", targetId: k.ruler_id },
      delta, reason);
    touched++;
  }
  return { ok: true, touched };
}

export { aggregateOpinionsToTarget };
