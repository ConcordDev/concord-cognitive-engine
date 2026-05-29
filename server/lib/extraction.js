// server/lib/extraction.js
//
// Phase CC8 — extraction shooter mode.
//
// Loot accumulates in run_stash_json during the run. Reaching an
// extraction_zone banks it. Death dumps it as lost_loot_json AND
// records a player_corpse via the existing mig 151 substrate.

import crypto from "node:crypto";
import logger from "../logger.js";
import { addRunParticipant, findActivePartyRun } from "./run-coop.js";

const DEFAULT_RUN_TIMEOUT_S = 45 * 60;  // 45 minutes

export function startRun(db, userId, opts = {}) {
  if (!db || !userId) return { ok: false, error: "missing_inputs" };
  const { worldId, timeoutSeconds = DEFAULT_RUN_TIMEOUT_S, partyId = null } = opts;
  if (!worldId) return { ok: false, error: "missing_worldId" };
  try {
    const active = db.prepare(`
      SELECT id FROM extraction_runs WHERE user_id = ? AND ended_at IS NULL
    `).get(userId);
    if (active) {
      addRunParticipant(db, "extraction", active.id, userId);
      return { ok: true, runId: active.id, alreadyActive: true };
    }

    // C4 — co-op: join a party-mate's active run instead of soloing.
    if (partyId) {
      const partyRun = findActivePartyRun(db, "extraction_runs", partyId);
      if (partyRun) {
        addRunParticipant(db, "extraction", partyRun, userId);
        logger.info?.("extraction", "run_joined", { runId: partyRun, userId, partyId });
        return { ok: true, runId: partyRun, joined: true };
      }
    }

    const id = `extr_${crypto.randomBytes(6).toString("hex")}`;
    const timeoutAt = Math.floor(Date.now() / 1000) + Math.max(60, Math.floor(timeoutSeconds));
    // party_id is added by migration 270; degrade gracefully on a pre-270 build.
    const hasPartyCol = db.prepare(`PRAGMA table_info(extraction_runs)`).all().some((c) => c.name === "party_id");
    if (hasPartyCol) {
      db.prepare(`INSERT INTO extraction_runs (id, user_id, world_id, timeout_at, party_id) VALUES (?, ?, ?, ?, ?)`)
        .run(id, userId, worldId, timeoutAt, partyId);
    } else {
      db.prepare(`INSERT INTO extraction_runs (id, user_id, world_id, timeout_at) VALUES (?, ?, ?, ?)`)
        .run(id, userId, worldId, timeoutAt);
    }
    addRunParticipant(db, "extraction", id, userId);
    logger.info?.("extraction", "run_started", { runId: id, userId, partyId });
    return { ok: true, runId: id, timeoutAt, partyId };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function pickupLoot(db, runId, item) {
  if (!db || !runId || !item) return { ok: false, error: "missing_inputs" };
  if (!item.itemId) return { ok: false, error: "invalid_item" };
  const qty = Math.max(1, Math.floor(Number(item.quantity) || 1));
  try {
    const run = db.prepare(`SELECT run_stash_json, ended_at FROM extraction_runs WHERE id = ?`).get(runId);
    if (!run) return { ok: false, error: "no_run" };
    if (run.ended_at) return { ok: false, error: "run_ended" };
    const stash = JSON.parse(run.run_stash_json);
    const existing = stash.find(s => s.itemId === item.itemId);
    if (existing) existing.quantity += qty;
    else stash.push({ itemId: item.itemId, quantity: qty });
    db.prepare(`UPDATE extraction_runs SET run_stash_json = ? WHERE id = ?`)
      .run(JSON.stringify(stash), runId);
    return { ok: true, stash };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function declareExtractionZone(db, opts = {}) {
  if (!db) return { ok: false, error: "missing_db" };
  const { worldId, x, z, radiusM = 8, durationS = 600 } = opts;
  if (!worldId || typeof x !== "number" || typeof z !== "number") {
    return { ok: false, error: "missing_inputs" };
  }
  try {
    const id = `exz_${crypto.randomBytes(6).toString("hex")}`;
    const activeUntil = Math.floor(Date.now() / 1000) + Math.max(60, Math.floor(durationS));
    db.prepare(`
      INSERT INTO extraction_zones (id, world_id, x, z, radius_m, active_until)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, worldId, x, z, Math.max(1, radiusM), activeUntil);
    return { ok: true, zoneId: id, activeUntil };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function extract(db, runId, opts = {}) {
  if (!db || !runId) return { ok: false, error: "missing_inputs" };
  const { x, z } = opts;
  if (typeof x !== "number" || typeof z !== "number") {
    return { ok: false, error: "invalid_coords" };
  }
  try {
    const run = db.prepare(`
      SELECT world_id, run_stash_json, ended_at FROM extraction_runs WHERE id = ?
    `).get(runId);
    if (!run) return { ok: false, error: "no_run" };
    if (run.ended_at) return { ok: false, error: "run_ended" };

    const now = Math.floor(Date.now() / 1000);
    const zones = db.prepare(`
      SELECT id, x, z, radius_m FROM extraction_zones
      WHERE world_id = ? AND active_until > ?
    `).all(run.world_id, now);

    const inside = zones.find(z2 => Math.hypot(z2.x - x, z2.z - z) <= z2.radius_m);
    if (!inside) return { ok: false, error: "not_in_zone" };

    db.prepare(`
      UPDATE extraction_runs SET ended_at = unixepoch(), end_reason = 'extracted' WHERE id = ?
    `).run(runId);
    const stash = JSON.parse(run.run_stash_json);
    return { ok: true, extracted: true, banked: stash };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function dieDuringRun(db, runId, deathOpts = {}) {
  if (!db || !runId) return { ok: false, error: "missing_inputs" };
  try {
    const run = db.prepare(`
      SELECT user_id, world_id, run_stash_json, ended_at FROM extraction_runs WHERE id = ?
    `).get(runId);
    if (!run) return { ok: false, error: "no_run" };
    if (run.ended_at) return { ok: false, error: "run_ended" };

    const stash = JSON.parse(run.run_stash_json);
    db.prepare(`
      UPDATE extraction_runs
      SET ended_at = unixepoch(), end_reason = 'died', lost_loot_json = ?
      WHERE id = ?
    `).run(JSON.stringify(stash), runId);
    return { ok: true, lostLoot: stash, deathPosition: deathOpts.position || null };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function getActiveRun(db, userId) {
  if (!db || !userId) return null;
  try {
    return db.prepare(`
      SELECT * FROM extraction_runs WHERE user_id = ? AND ended_at IS NULL
    `).get(userId) || null;
  } catch { return null; }
}

export function listActiveZones(db, worldId) {
  if (!db || !worldId) return [];
  try {
    return db.prepare(`
      SELECT id, x, z, radius_m, active_until FROM extraction_zones
      WHERE world_id = ? AND active_until > unixepoch()
    `).all(worldId);
  } catch { return []; }
}

export { DEFAULT_RUN_TIMEOUT_S };
