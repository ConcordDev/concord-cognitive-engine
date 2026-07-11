// @sync-fs-ok: lazy, memoized one-time crop-catalog content load. Sync fs in this file is intentional and not on the user request path (audited 2026-06).
// server/lib/farming.js
//
// Phase CB3 — farm plots.
//
// Plant a seed on a (claim, tile) → 4 growth stages over the crop's
// growth_days. Crops only advance during their planted season (the
// design constraint from seasons.js Phase 5c). Wrong-season planting
// halts at growth_stage=0 until the season returns. Harvest credits
// player_inventory with the crop yield.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import logger from "../logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_FILE = path.resolve(__dirname, "..", "..", "content", "crops.json");

// Watering: a real player action (waterCrop) stamps watered_at. A crop
// watered within WATER_RECENCY_S of the growth tick gets a flat elapsed-days
// bonus, so watering measurably speeds ripening instead of being a dead
// write. Unwatered crops still grow at the base seasonal-elapsed-days rate
// (unchanged) — watering is a bonus, not a requirement, so a plot with no
// player attention doesn't stall.
const WATER_BONUS_DAYS = Number(process.env.CONCORD_WATER_BONUS_DAYS) || 1;
const WATER_RECENCY_S = Number(process.env.CONCORD_WATER_RECENCY_S) || 172800; // 48h

let _catalog = null;
function _loadCatalog() {
  if (_catalog) return _catalog;
  try {
    _catalog = JSON.parse(fs.readFileSync(CONTENT_FILE, "utf8"));
  } catch {
    _catalog = [];
  }
  return _catalog;
}

export function getCropDef(cropKind) {
  return _loadCatalog().find(c => c.id === cropKind) || null;
}

export function listCrops() {
  return _loadCatalog().slice();
}

/**
 * Plant a seed at (claim_id, tile_x, tile_y). Idempotent on the PK —
 * re-plant updates the row only if the prior crop was harvested
 * (deleted). Ownership gate via caller-supplied isOwner predicate.
 */
export function plantSeed(db, userId, opts = {}) {
  if (!db || !userId) return { ok: false, error: "missing_inputs" };
  const { claimId, tileX, tileY, cropKind, currentSeasonIdx, currentDay } = opts;
  if (!claimId || tileX == null || tileY == null || !cropKind) {
    return { ok: false, error: "missing_inputs" };
  }
  if (typeof opts.isOwner === "function" && !opts.isOwner(userId, claimId)) {
    return { ok: false, error: "not_claim_owner" };
  }
  const def = getCropDef(cropKind);
  if (!def) return { ok: false, error: "unknown_crop" };

  try {
    const existing = db.prepare(`
      SELECT crop_kind, growth_stage FROM claim_crops
      WHERE claim_id = ? AND tile_x = ? AND tile_y = ?
    `).get(claimId, tileX, tileY);
    if (existing) return { ok: false, error: "tile_occupied" };

    db.prepare(`
      INSERT INTO claim_crops
        (claim_id, tile_x, tile_y, crop_kind, planted_season_idx,
         planted_day, planted_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(claimId, tileX, tileY, cropKind, currentSeasonIdx ?? 0, currentDay ?? 0, userId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

/**
 * Water a planted (not-yet-ripe) crop. Owner-gated, idempotent (re-watering
 * just refreshes the timestamp). This is the real player action that makes
 * `watered_at` meaningful — advanceGrowth() below grants a growth-rate
 * bonus to crops watered within WATER_RECENCY_S of the tick.
 */
export function waterCrop(db, userId, opts = {}) {
  if (!db || !userId) return { ok: false, error: "missing_inputs" };
  const { claimId, tileX, tileY } = opts;
  if (!claimId || tileX == null || tileY == null) {
    return { ok: false, error: "missing_inputs" };
  }
  if (typeof opts.isOwner === "function" && !opts.isOwner(userId, claimId)) {
    return { ok: false, error: "not_claim_owner" };
  }
  try {
    const row = db.prepare(`
      SELECT growth_stage FROM claim_crops
      WHERE claim_id = ? AND tile_x = ? AND tile_y = ?
    `).get(claimId, tileX, tileY);
    if (!row) return { ok: false, error: "no_crop" };
    if (row.growth_stage >= 3) return { ok: false, error: "already_ripe" };

    db.prepare(`
      UPDATE claim_crops SET watered_at = unixepoch()
      WHERE claim_id = ? AND tile_x = ? AND tile_y = ?
    `).run(claimId, tileX, tileY);
    return { ok: true, wateredAt: Math.floor(Date.now() / 1000) };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

/**
 * Heartbeat-driven growth tick. Advances all crops whose current
 * season matches their seasons[] affinity AND whose elapsed days
 * cross the next stage boundary. A crop watered within WATER_RECENCY_S
 * (real wall-clock seconds) of `nowUnix` gets a flat +WATER_BONUS_DAYS
 * added to its effective elapsed days — a genuine growth-rate bonus,
 * not just a stamp. Unwatered crops are unaffected (base rate unchanged).
 */
export function advanceGrowth(db, currentSeasonIdx, currentDay, nowUnix = Math.floor(Date.now() / 1000)) {
  if (!db) return { ok: false, error: "missing_db" };
  try {
    const rows = db.prepare(`
      SELECT claim_id, tile_x, tile_y, crop_kind, growth_stage,
             planted_season_idx, planted_day, watered_at
      FROM claim_crops WHERE growth_stage < 3
    `).all();

    let advanced = 0;
    let waterBonusApplied = 0;
    for (const r of rows) {
      const def = getCropDef(r.crop_kind);
      if (!def) continue;
      if (!def.seasons.includes(currentSeasonIdx)) continue;

      // Compute days elapsed since planting (mod 42-day Concordia year).
      const plantedAbsDay = r.planted_season_idx * 7 + r.planted_day;
      const currentAbsDay = currentSeasonIdx * 7 + currentDay;
      const elapsedDays = (currentAbsDay - plantedAbsDay + 42) % 42;

      const wateredRecently = r.watered_at != null && (nowUnix - r.watered_at) <= WATER_RECENCY_S;
      const effectiveElapsedDays = wateredRecently ? elapsedDays + WATER_BONUS_DAYS : elapsedDays;

      const stagesElapsed = Math.floor((effectiveElapsedDays / def.growth_days) * 3);
      const targetStage = Math.min(3, Math.max(r.growth_stage, stagesElapsed));
      if (targetStage > r.growth_stage) {
        db.prepare(`
          UPDATE claim_crops SET growth_stage = ?, updated_at = unixepoch()
          WHERE claim_id = ? AND tile_x = ? AND tile_y = ?
        `).run(targetStage, r.claim_id, r.tile_x, r.tile_y);
        advanced++;
        if (wateredRecently) waterBonusApplied++;
      }
    }
    if (advanced > 0) logger.info?.("farming", "growth_tick", { advanced, waterBonusApplied });
    return { ok: true, advanced, waterBonusApplied };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

/**
 * Harvest a ripe crop (growth_stage = 3). Credits player_inventory
 * with the crop yield × seasonal-yield multiplier (caller-supplied).
 * Returns { ok, harvested: { itemId, quantity } } and deletes the row.
 */
export function harvestCrop(db, userId, opts = {}) {
  if (!db || !userId) return { ok: false, error: "missing_inputs" };
  const { claimId, tileX, tileY, seasonalMultiplier = 1.0 } = opts;
  if (typeof opts.isOwner === "function" && !opts.isOwner(userId, claimId)) {
    return { ok: false, error: "not_claim_owner" };
  }
  try {
    const row = db.prepare(`
      SELECT crop_kind, growth_stage FROM claim_crops
      WHERE claim_id = ? AND tile_x = ? AND tile_y = ?
    `).get(claimId, tileX, tileY);
    if (!row) return { ok: false, error: "no_crop" };
    if (row.growth_stage < 3) return { ok: false, error: "not_ripe" };

    const def = getCropDef(row.crop_kind);
    if (!def) return { ok: false, error: "unknown_crop_def" };
    const quantity = Math.max(1, Math.floor(def.yield * seasonalMultiplier));

    db.prepare(`
      DELETE FROM claim_crops WHERE claim_id = ? AND tile_x = ? AND tile_y = ?
    `).run(claimId, tileX, tileY);

    return { ok: true, harvested: { itemId: row.crop_kind, quantity } };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function listCropsOnClaim(db, claimId) {
  if (!db || !claimId) return [];
  try {
    return db.prepare(`
      SELECT claim_id, tile_x, tile_y, crop_kind, growth_stage,
             planted_season_idx, planted_day, planted_by, updated_at, watered_at
      FROM claim_crops WHERE claim_id = ?
    `).all(claimId);
  } catch { return []; }
}
