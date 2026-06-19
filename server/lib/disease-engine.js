// @sync-fs-ok: one-time disease-content catalog load at init. Sync fs in this file is intentional and not on the user request path (audited 2026-06).
// server/lib/disease-engine.js
//
// Phase W — disease engine.
//
// Builds on the player_diseases table (migration 204) which already has
// contagion_radius_m + severity + symptoms_json. The engine adds:
//   - Disease catalog loader (content/diseases/*.json).
//   - contractDisease — INSERT a new infection.
//   - tickDiseases — advance severity per the curve, spread to nearby
//     uninfected players, check for natural recovery.
//   - curePartial — drop severity; below threshold → recovered + immunity.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import logger from "../logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = path.resolve(__dirname, "..", "..", "content", "diseases");

const DISEASE_RECOVERY_BELOW_SEVERITY = 0.02;
const PLAGUE_INFECTION_RATIO = Number(process.env.CONCORD_PLAGUE_THRESHOLD) || 0.15;

/** @type {Map<string, object>} */
const _catalogCache = new Map();
let _initialized = false;

export function initDiseaseCatalog() {
  if (_initialized) return { ok: true, count: _catalogCache.size };
  _initialized = true;
  try {
    const files = fs.readdirSync(CONTENT_DIR).filter(f => f.endsWith(".json"));
    for (const file of files) {
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, file), "utf8"));
        for (const d of parsed.diseases || []) {
          if (!d.id) continue;
          _catalogCache.set(d.id, { ...d, tier: parsed.tier || "common" });
        }
      } catch (err) {
        logger.warn?.("disease-engine", "catalog_load_failed", { file, error: err?.message });
      }
    }
    logger.info?.("disease-engine", "catalog_loaded", { count: _catalogCache.size });
  } catch (err) {
    logger.warn?.("disease-engine", "content_dir_unreadable", { error: err?.message });
  }
  return { ok: true, count: _catalogCache.size };
}

export function getDisease(id) { return _catalogCache.get(id) || null; }
export function listCatalog() { return [..._catalogCache.values()]; }
export function listEndemicTo(worldId) {
  return [..._catalogCache.values()].filter(d =>
    (d.endemicWorlds || []).includes(worldId) ||
    (d.endemicWorlds || []).includes("all"));
}

/**
 * Contract a disease. INSERT into player_diseases (idempotent on
 * already-active same disease for same user — re-contracting just
 * bumps severity).
 */
export function contractDisease(db, userId, diseaseId, opts = {}) {
  if (!db || !userId || !diseaseId) return { ok: false, error: "missing_inputs" };
  if (!_initialized) initDiseaseCatalog();
  const disease = _catalogCache.get(diseaseId);
  if (!disease) return { ok: false, error: "unknown_disease" };
  const severity = Math.min(1, Math.max(0.01, Number(opts.severity) || 0.1));
  const source = String(opts.source || "unknown");
  const worldId = opts.worldId || null;

  try {
    // Check existing active infection.
    const existing = db.prepare(`
      SELECT id, severity FROM player_diseases
      WHERE user_id = ? AND disease_id = ? AND recovered_at IS NULL
    `).get(userId, diseaseId);

    if (existing) {
      // Bump severity (capped at 1.0).
      const newSeverity = Math.min(1, existing.severity + severity);
      db.prepare(`UPDATE player_diseases SET severity = ? WHERE id = ?`).run(newSeverity, existing.id);
      return { ok: true, id: existing.id, newSeverity, alreadyInfected: true };
    }

    // Check immunity.
    try {
      const immune = db.prepare(`SELECT 1 FROM disease_immunity WHERE user_id = ? AND disease_id = ?`).get(userId, diseaseId);
      if (immune) return { ok: false, error: "immune" };
    } catch { /* immunity table optional pre-migration 223 */ }

    const id = `pd_${crypto.randomBytes(6).toString("hex")}`;
    db.prepare(`
      INSERT INTO player_diseases
        (id, user_id, disease_id, severity, contagion_radius_m, contracted_at, symptoms_json)
      VALUES (?, ?, ?, ?, ?, unixepoch(), ?)
    `).run(id, userId, diseaseId, severity, disease.contagionRadiusM || 0, JSON.stringify(disease.symptoms || []));

    // Emit realtime so the UI shows the icon.
    try {
      globalThis._concordRealtimeEmit?.("disease:contracted", {
        userId, diseaseId, severity, source, worldId,
        name: disease.name, symptoms: disease.symptoms,
      });
    } catch { /* emit best-effort */ }

    return { ok: true, id, severity, name: disease.name };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

/**
 * Tick all active diseases for a user. Returns counts of affected rows.
 */
export function tickDiseases(db, userId, opts = {}) {
  if (!db || !userId) return { ticked: 0 };
  if (!_initialized) initDiseaseCatalog();
  let ticked = 0;
  try {
    const active = db.prepare(`
      SELECT id, disease_id, severity, contracted_at
      FROM player_diseases
      WHERE user_id = ? AND recovered_at IS NULL
    `).all(userId);

    const setSeverity = db.prepare(`UPDATE player_diseases SET severity = ? WHERE id = ?`);
    for (const row of active) {
      const disease = _catalogCache.get(row.disease_id);
      if (!disease) continue;

      // Advance severity per the configured increase. Counterbalanced by
      // the half-life decay (treated as a slow recovery floor).
      const inc = Number(disease.severityIncreasePerTick) || 0.005;
      let newSev = Math.min(1, row.severity + inc);

      // Mortality check (rare, but possible at high severity).
      const risk = Number(disease.mortalityRisk) || 0;
      if (newSev > 0.7 && risk > 0 && Math.random() < risk * 0.1) {
        try {
          globalThis._concordRealtimeEmit?.("disease:lethal-progression", {
            userId, diseaseId: row.disease_id, severity: newSev,
          });
        } catch { /* emit best-effort */ }
        // Don't kill the player directly — just push severity to max.
        // Combat / death systems handle the actual death event.
        newSev = 1.0;
      }

      setSeverity.run(newSev, row.id);
      ticked++;
    }
  } catch (err) {
    logger.debug?.("disease-engine", "tick_failed", { userId, error: err?.message });
  }
  return { ticked };
}

/**
 * Reduce severity of a specific infection. Below threshold → recovered +
 * immunity row.
 */
export function curePartial(db, userId, diseaseId, severityReduction) {
  if (!db || !userId || !diseaseId) return { ok: false, error: "missing_inputs" };
  const reduction = Math.max(0, Number(severityReduction) || 0);
  try {
    const row = db.prepare(`
      SELECT id, severity FROM player_diseases
      WHERE user_id = ? AND disease_id = ? AND recovered_at IS NULL
    `).get(userId, diseaseId);
    if (!row) return { ok: false, error: "not_infected" };
    const newSev = Math.max(0, row.severity - reduction);
    if (newSev < DISEASE_RECOVERY_BELOW_SEVERITY) {
      db.prepare(`UPDATE player_diseases SET severity = ?, recovered_at = unixepoch() WHERE id = ?`).run(newSev, row.id);
      try {
        db.prepare(`
          INSERT INTO disease_immunity (user_id, disease_id, acquired_at)
          VALUES (?, ?, unixepoch())
          ON CONFLICT DO NOTHING
        `).run(userId, diseaseId);
      } catch { /* immunity table optional */ }
      try {
        globalThis._concordRealtimeEmit?.("disease:cured", { userId, diseaseId, byOther: false });
      } catch { /* emit best-effort */ }
      return { ok: true, recovered: true, severity: newSev };
    }
    db.prepare(`UPDATE player_diseases SET severity = ? WHERE id = ?`).run(newSev, row.id);
    return { ok: true, recovered: false, severity: newSev };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

/** List all active infections for a user. */
export function listActiveDiseases(db, userId) {
  if (!db || !userId) return [];
  try {
    return db.prepare(`
      SELECT id, disease_id AS diseaseId, severity, contracted_at AS contractedAt,
             contagion_radius_m AS contagionRadiusM, symptoms_json
      FROM player_diseases
      WHERE user_id = ? AND recovered_at IS NULL
      ORDER BY contracted_at DESC
    `).all(userId).map(r => {
      const d = _catalogCache.get(r.diseaseId);
      let symptoms = [];
      try { symptoms = JSON.parse(r.symptoms_json) || []; } catch { /* ignore */ }
      return { ...r, name: d?.name || r.diseaseId, symptoms, tier: d?.tier };
    });
  } catch {
    return [];
  }
}

/** Compute infection ratio for plague detection. */
export function getInfectionRatio(db, worldId) {
  if (!db || !worldId) return 0;
  try {
    const inf = db.prepare(`
      SELECT COUNT(DISTINCT pd.user_id) AS n
      FROM player_diseases pd
      WHERE pd.recovered_at IS NULL AND pd.severity > 0.3
    `).get();
    const total = db.prepare(`
      SELECT COUNT(DISTINCT user_id) AS n FROM world_visits WHERE world_id = ?
    `).get(worldId);
    const infectedCount = Number(inf?.n) || 0;
    const totalCount = Math.max(1, Number(total?.n) || 1);
    return infectedCount / totalCount;
  } catch {
    return 0;
  }
}

export { DISEASE_RECOVERY_BELOW_SEVERITY, PLAGUE_INFECTION_RATIO };

// ──────────────────────────────────────────────────────────────────────
// Phase AD — per-vector transmission probability + substrate gates.
// ──────────────────────────────────────────────────────────────────────

// PZ-style base rates; each disease can override via
// `transmissionProbabilities` + `vectorRequirements` in its JSON.
export const DEFAULT_TRANSMISSION = Object.freeze({
  airborne:    { base: 0.15, distanceFalloffPerM: 0.04 }, // per 1m within radius
  touch:       { base: 0.30 },                            // hygiene-modulated
  foodborne:   { base: 0.40, minContamination: 0.2 },
  bloodborne:  { base: 0.60 },                            // requires open wound
  waterborne:  { base: 0.25 },                            // requires contaminated source
});

/**
 * Compute contraction probability for a given vector.
 * @param {object} disease  — catalog entry (with optional `transmissionProbabilities`).
 * @param {'airborne'|'touch'|'foodborne'|'bloodborne'|'waterborne'} vector
 * @param {object} opts     — vector-specific signals (distance, hygiene, etc.)
 * @returns {number}        — [0, 1]
 */
export function getTransmissionProbability(disease, vector, opts = {}) {
  if (!disease) return 0;
  const userOverrides = disease.transmissionProbabilities || {};
  const reqs = disease.vectorRequirements || {};
  const baseDef = DEFAULT_TRANSMISSION[vector];
  if (!baseDef) return 0;

  // Per-disease base for this vector (override the default if present).
  const baseRaw = userOverrides[vector];
  const base = typeof baseRaw === "number" ? baseRaw : baseDef.base;
  if (base <= 0) return 0;

  let p = base;

  switch (vector) {
    case "airborne": {
      const distance = Math.max(0, Number(opts.distanceM) || 0);
      const radius = Number(disease.contagionRadiusM) || 5;
      if (distance > radius) return 0;
      const falloff = baseDef.distanceFalloffPerM;
      p = Math.max(0, base - distance * falloff);
      // Hygiene shifts the receiver's susceptibility (clean = halved).
      const hygiene = Math.max(0, Math.min(1, Number(opts.hygiene ?? 1)));
      p *= (1 - hygiene * 0.5);
      break;
    }
    case "touch": {
      const distance = Math.max(0, Number(opts.distanceM) || 0);
      if (distance > 0) return 0; // touch requires zero distance
      const hygiene = Math.max(0, Math.min(1, Number(opts.hygiene ?? 1)));
      p *= (1 - hygiene * 0.5);
      break;
    }
    case "foodborne": {
      const contamination = Math.max(0, Math.min(1, Number(opts.contaminationLevel) || 0));
      const min = baseDef.minContamination;
      if (contamination < min) return 0;
      p *= contamination;
      break;
    }
    case "bloodborne": {
      const requiresWound = reqs.needsOpenWound !== false; // default true
      if (requiresWound && !opts.openWound) return 0;
      break;
    }
    case "waterborne": {
      const contamination = Math.max(0, Math.min(1, Number(opts.waterContamination) || 0));
      if (contamination <= 0) return 0;
      p *= contamination;
      break;
    }
  }

  return Math.max(0, Math.min(1, p));
}

/**
 * Mark a food DTU as contaminated by a disease. Idempotent on
 * (food_dtu_id, disease_id) — re-marking raises level (capped at 1).
 */
export function contaminateFood(db, { foodDtuId, diseaseId, level, sourceUserId } = {}) {
  if (!db || !foodDtuId || !diseaseId) return { ok: false, error: "missing_inputs" };
  const lvl = Math.max(0, Math.min(1, Number(level) || 0.5));
  try {
    const existing = db.prepare(`
      SELECT contamination_level FROM food_contamination
      WHERE food_dtu_id = ? AND disease_id = ?
    `).get(foodDtuId, diseaseId);
    if (existing) {
      const next = Math.min(1, existing.contamination_level + lvl);
      db.prepare(`
        UPDATE food_contamination SET contamination_level = ?
        WHERE food_dtu_id = ? AND disease_id = ?
      `).run(next, foodDtuId, diseaseId);
      return { ok: true, contaminationLevel: next };
    }
    db.prepare(`
      INSERT INTO food_contamination
        (food_dtu_id, disease_id, contamination_level, source_user_id)
      VALUES (?, ?, ?, ?)
    `).run(foodDtuId, diseaseId, lvl, sourceUserId || null);
    return { ok: true, contaminationLevel: lvl };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function getFoodContamination(db, foodDtuId) {
  if (!db || !foodDtuId) return [];
  try {
    return db.prepare(`
      SELECT disease_id AS diseaseId, contamination_level AS level
      FROM food_contamination WHERE food_dtu_id = ?
    `).all(foodDtuId);
  } catch { return []; }
}

export function contaminateWaterSource(db, opts = {}) {
  if (!db) return { ok: false, error: "missing_inputs" };
  const { worldId, x, z, radiusM, diseaseId, level, ttlSeconds = 86400 } = opts;
  if (!worldId || !diseaseId || typeof x !== "number" || typeof z !== "number") {
    return { ok: false, error: "missing_inputs" };
  }
  const lvl = Math.max(0, Math.min(1, Number(level) || 0.5));
  const radius = Math.max(1, Number(radiusM) || 10);
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  try {
    const id = `wc_${crypto.randomBytes(6).toString("hex")}`;
    db.prepare(`
      INSERT INTO water_source_contamination
        (id, world_id, x, z, radius_m, disease_id, level, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, worldId, x, z, radius, diseaseId, lvl, expiresAt);
    return { ok: true, id };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

/**
 * Look up any active contaminated water source the given point sits inside.
 * Returns first hit (most contaminated wins via ORDER BY level DESC).
 */
export function waterContaminationAt(db, worldId, x, z) {
  if (!db || !worldId) return null;
  try {
    const now = Math.floor(Date.now() / 1000);
    const sources = db.prepare(`
      SELECT id, disease_id AS diseaseId, level, x, z, radius_m AS radiusM
      FROM water_source_contamination
      WHERE world_id = ? AND expires_at > ?
      ORDER BY level DESC
    `).all(worldId, now);
    for (const s of sources) {
      const d = Math.hypot(x - s.x, z - s.z);
      if (d <= s.radiusM) return { ...s, distanceM: d };
    }
    return null;
  } catch { return null; }
}

/** Sweep expired water contamination rows. */
export function sweepWaterContamination(db) {
  try {
    const r = db.prepare(`
      DELETE FROM water_source_contamination WHERE expires_at <= unixepoch()
    `).run();
    return { ok: true, removed: r.changes || 0 };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

/** Test-only reset. */
export function _resetDiseaseCatalog() {
  _catalogCache.clear();
  _initialized = false;
}
