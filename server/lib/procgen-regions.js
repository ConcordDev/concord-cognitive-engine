// server/lib/procgen-regions.js
//
// Phase 5e — Procgen Wilderness.
//
// Drift findings (Phase 4c) → physical regions in the world. The
// lattice's cognitive failure modes get geographic expression so the
// player can literally walk into the substrate's discomfort.
//
// drift_type → region_kind mapping:
//   memetic_drift     → haunted_glade
//   goodhart          → corrupt_market
//   self_reference    → hollow_chamber
//   capability_creep  → overgrown_wild
//   echo_chamber      → silent_field
//   metric_divergence → hollow_chamber (catch-all)
//
// Each region biases env signals (Layer 7) within its radius. The
// env-sensor heartbeat reads applyRegionBiases() to layer these on top
// of seasonal + authored climate.

import crypto from "node:crypto";
import logger from "../logger.js";
import { spawnRegionCache } from "./discovery-nodes.js";

const DRIFT_TO_REGION = Object.freeze({
  memetic_drift:     "haunted_glade",
  goodhart:          "corrupt_market",
  self_reference:    "hollow_chamber",
  capability_creep:  "overgrown_wild",
  echo_chamber:      "silent_field",
  metric_divergence: "hollow_chamber",
});

const REGION_BIASES = Object.freeze({
  haunted_glade:    { tempBias: -3,  humidityBias: +5, lightBias: -8000,  airQualityBias: -0.05 },
  corrupt_market:   { tempBias: 0,   humidityBias: 0,  lightBias: 0,      airQualityBias: -0.1 },
  hollow_chamber:   { tempBias: -5,  humidityBias: -10, lightBias: -12000, airQualityBias: -0.05 },
  overgrown_wild:   { tempBias: +1,  humidityBias: +12, lightBias: -3000,  airQualityBias: 0 },
  silent_field:     { tempBias: 0,   humidityBias: 0,  lightBias: 0,      airQualityBias: 0,
                      sonicBias: -10 },
});

const REGION_NARRATIVES = Object.freeze({
  haunted_glade:    "The trees here repeat themselves. Footsteps don't echo back the way they came.",
  corrupt_market:   "Coins keep coming up heads. The scales are honest and yet the count drifts.",
  hollow_chamber:   "A door circles back to itself. Words spoken here outrun their meaning.",
  overgrown_wild:   "What was the path is now the bramble. The bramble is somewhere else.",
  silent_field:     "No bird, no wind, no dispute. Only one voice fits in this air.",
});

const DEFAULT_RADIUS_M = 35;

/**
 * Generate a region from a drift alert. Idempotent by drift_alert_signature
 * (UNIQUE in schema). Anchor position chosen deterministically from the
 * signature so the same drift always materializes in the same place.
 *
 * Returns { ok, action: 'created' | 'already_exists', regionId? }.
 */
export function generateRegionFromAlert(db, { worldId, alert, signature }) {
  if (!db || !worldId || !alert?.type || !signature) return { ok: false, reason: "missing_inputs" };
  const regionKind = DRIFT_TO_REGION[alert.type];
  if (!regionKind) return { ok: false, reason: "drift_type_not_geographic" };

  // Already exists?
  try {
    const existing = db.prepare(`SELECT id FROM procgen_regions WHERE drift_alert_signature = ?`).get(signature);
    if (existing) return { ok: true, action: "already_exists", regionId: existing.id };
  } catch { /* table optional */ }

  // Anchor: derive (x, z) deterministically from sha1(signature). Place
  // them in a 2km × 2km box around (0, 0) so they don't bunch.
  const seed = crypto.createHash("sha1").update(`${worldId}|${signature}|anchor`).digest();
  const ax = (((seed[0] << 8) + seed[1]) / 65536) * 2000 - 1000;
  const az = (((seed[2] << 8) + seed[3]) / 65536) * 2000 - 1000;

  const id = `pgr_${crypto.randomUUID()}`;
  try {
    db.prepare(`
      INSERT INTO procgen_regions
        (id, world_id, drift_alert_signature, drift_type, region_kind,
         anchor_x, anchor_z, radius_m, narrative, composed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
    `).run(id, worldId, signature, alert.type, regionKind,
           ax, az, DEFAULT_RADIUS_M,
           REGION_NARRATIVES[regionKind] || null);
  } catch (err) {
    if (String(err?.message || "").includes("UNIQUE")) {
      const existing = db.prepare(`SELECT id FROM procgen_regions WHERE drift_alert_signature = ?`).get(signature);
      return { ok: true, action: "already_exists", regionId: existing?.id };
    }
    try { logger.warn?.("procgen-regions", "insert_failed", { error: err?.message }); }
    catch { /* ignore */ }
    return { ok: false, reason: "insert_failed" };
  }

  // G5 — exploration cache: the new region hides a rare cache at its anchor,
  // keyed to its character (haunted glade → soul essence, corrupt market → gold…).
  // Found through normal gathering. Best-effort; CONCORD_EXPLORATION_CACHE=0 disables.
  try {
    spawnRegionCache(db, { worldId, regionId: id, regionKind, x: ax, z: az });
  } catch { /* cache best-effort — never blocks region creation */ }

  // Realtime: emit world:region-spawned for the EmergentEventFeed.
  try {
    if (globalThis?.__CONCORD_REALTIME__?.io) {
      globalThis.__CONCORD_REALTIME__.io.to(`world:${worldId}`).emit("world:region-spawned", {
        regionId: id, worldId, regionKind,
        anchor: { x: ax, z: az }, radius: DEFAULT_RADIUS_M,
        narrative: REGION_NARRATIVES[regionKind],
        ts: Date.now(),
      });
    }
  } catch { /* socket optional */ }

  return { ok: true, action: "created", regionId: id, anchor: { x: ax, z: az } };
}

/**
 * Find the (most-relevant) region a point falls inside. Returns null
 * if the point isn't in any active region.
 */
export function regionAt(db, worldId, x, z) {
  if (!db || !worldId) return null;
  try {
    const regions = db.prepare(`
      SELECT id, region_kind, anchor_x, anchor_z, radius_m, narrative, drift_type
      FROM procgen_regions
      WHERE world_id = ? AND decayed_at IS NULL
    `).all(worldId);
    for (const r of regions) {
      const dx = r.anchor_x - x;
      const dz = r.anchor_z - z;
      if (Math.hypot(dx, dz) <= r.radius_m) return r;
    }
    return null;
  } catch { return null; }
}

/**
 * Apply region biases to a base set of env signals. Caller passes the
 * (worldId, x, z) and the base signals object; this returns the biased
 * version. If the point isn't in a region, returns the base unchanged.
 */
export function applyRegionBiases(db, worldId, x, z, baseSignals) {
  const r = regionAt(db, worldId, x, z);
  if (!r) return baseSignals;
  const bias = REGION_BIASES[r.region_kind] || {};
  const out = { ...baseSignals, _regionKind: r.region_kind };
  if (bias.tempBias != null && out.temperature != null) out.temperature += bias.tempBias;
  if (bias.humidityBias != null && out.humidity != null) out.humidity += bias.humidityBias;
  if (bias.lightBias != null && out.light != null) out.light = Math.max(0, out.light + bias.lightBias);
  if (bias.airQualityBias != null && out.airQuality != null) out.airQuality = Math.max(0, Math.min(1, out.airQuality + bias.airQualityBias));
  if (bias.sonicBias != null && out.noise != null) out.noise = Math.max(0, out.noise + bias.sonicBias);
  return out;
}

/**
 * Record a player visit. Multi-purpose: quest engine reads visits to
 * realise lattice-born quests; analytics reads density. Only writes
 * one row per (region, user, hour) to avoid log spam.
 */
export function recordRegionVisit(db, regionId, userId) {
  if (!db || !regionId || !userId) return { ok: false, reason: "missing_inputs" };
  // Throttle by hour bucket.
  const hourBucket = Math.floor(Date.now() / 3600000);
  const seenKey = `${regionId}|${userId}|${hourBucket}`;
  try {
    db.prepare(`
      INSERT INTO procgen_region_visits (id, region_id, user_id, visited_at)
      VALUES (?, ?, ?, unixepoch())
    `).run(`pgrv_${seenKey}_${Math.random().toString(36).slice(2, 6)}`, regionId, userId);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
}

/**
 * Decay a region — called when its underlying lattice-born quest is
 * realised (the substrate said "this is fixed", so the geography
 * resolves). Idempotent.
 */
export function decayRegion(db, regionId, reason = "drift_resolved") {
  if (!db || !regionId) return { ok: false, reason: "missing_inputs" };
  try {
    db.prepare(`
      UPDATE procgen_regions SET decayed_at = unixepoch(), decay_reason = ?
      WHERE id = ? AND decayed_at IS NULL
    `).run(reason, regionId);
    return { ok: true };
  } catch (err) { return { ok: false, reason: "update_failed", error: err?.message }; }
}

/** UI list. */
export function listActiveRegions(db, worldId, limit = 50) {
  if (!db || !worldId) return [];
  try {
    return db.prepare(`
      SELECT * FROM procgen_regions
      WHERE world_id = ? AND decayed_at IS NULL
      ORDER BY composed_at DESC LIMIT ?
    `).all(worldId, limit);
  } catch { return []; }
}

export const _internal = {
  DRIFT_TO_REGION, REGION_BIASES, REGION_NARRATIVES, DEFAULT_RADIUS_M,
};
