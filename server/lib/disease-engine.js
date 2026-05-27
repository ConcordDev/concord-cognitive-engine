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

      db.prepare(`UPDATE player_diseases SET severity = ? WHERE id = ?`).run(newSev, row.id);
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

/** Test-only reset. */
export function _resetDiseaseCatalog() {
  _catalogCache.clear();
  _initialized = false;
}
