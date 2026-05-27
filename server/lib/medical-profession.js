// server/lib/medical-profession.js
//
// Phase W2 — diagnose + treat. Healer skill XP affects accuracy and
// success curves. Failed treatment hits the patient's faction opinion.

import { curePartial, getDisease, listActiveDiseases } from "./disease-engine.js";
import logger from "../logger.js";

const BASE_DIAGNOSE_ACCURACY = 0.5;
const BASE_TREAT_SUCCESS = 0.4;
const XP_PER_DIAGNOSE = 5;
const XP_PER_SUCCESSFUL_TREAT = 15;

export function getDiagnoseXp(db, userId) {
  if (!db || !userId) return { xp: 0, level: 0 };
  try {
    const r = db.prepare(`SELECT xp, level FROM diagnose_skill_xp WHERE user_id = ?`).get(userId);
    return { xp: Number(r?.xp) || 0, level: Number(r?.level) || 0 };
  } catch {
    return { xp: 0, level: 0 };
  }
}

function _addXp(db, userId, amount) {
  try {
    db.prepare(`
      INSERT INTO diagnose_skill_xp (user_id, xp, level)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        xp = xp + excluded.xp,
        level = CAST((xp + excluded.xp) / 100 AS INTEGER),
        updated_at = unixepoch()
    `).run(userId, amount, Math.floor(amount / 100));
  } catch { /* table optional */ }
}

/**
 * Diagnose a patient's active diseases. Returns revealed info weighted
 * by accuracy.
 *
 * Accuracy = BASE_DIAGNOSE_ACCURACY + (healerLevel * 0.05), capped at 0.95.
 * If random > accuracy, severity is reported as a range instead of exact.
 */
export function diagnose(db, healerId, patientId) {
  if (!db || !healerId || !patientId) return { ok: false, error: "missing_inputs" };
  const diseases = listActiveDiseases(db, patientId);
  if (diseases.length === 0) return { ok: true, healthy: true, diseases: [] };

  const healerXp = getDiagnoseXp(db, healerId);
  const accuracy = Math.min(0.95, BASE_DIAGNOSE_ACCURACY + healerXp.level * 0.05);

  const revealed = diseases.map(d => {
    const accurate = Math.random() < accuracy;
    if (accurate) {
      return {
        diseaseId: d.diseaseId, name: d.name,
        severity: Math.round(d.severity * 100) / 100,
        contagionRadiusM: d.contagionRadiusM,
        symptoms: d.symptoms,
        transmissionVector: getDisease(d.diseaseId)?.transmissionVector,
      };
    }
    return {
      diseaseId: "unknown",
      name: "Unknown illness",
      severity: d.severity > 0.5 ? "severe" : d.severity > 0.2 ? "moderate" : "mild",
      symptoms: d.symptoms,
    };
  });

  // Award XP per diagnose.
  _addXp(db, healerId, XP_PER_DIAGNOSE);

  return { ok: true, diseases: revealed, accuracy };
}

/**
 * Treat a patient with a cure recipe. Success curve based on healer
 * level + cure-recipe match. Failed treatment writes negative opinion.
 */
export function treatPatient(db, healerId, patientId, diseaseId, cureRecipeId) {
  if (!db || !healerId || !patientId || !diseaseId) return { ok: false, error: "missing_inputs" };
  const disease = getDisease(diseaseId);
  if (!disease) return { ok: false, error: "unknown_disease" };

  const healerXp = getDiagnoseXp(db, healerId);
  const validRecipe = (disease.cureRecipeIds || []).includes(cureRecipeId);
  const baseSuccess = validRecipe ? 0.7 : BASE_TREAT_SUCCESS;
  const successProb = Math.min(0.95, baseSuccess + healerXp.level * 0.03);
  const success = Math.random() < successProb;

  if (success) {
    // Apply severity reduction proportional to recipe quality + skill.
    const reduction = validRecipe ? 0.4 : 0.15;
    const r = curePartial(db, patientId, diseaseId, reduction);
    _addXp(db, healerId, XP_PER_SUCCESSFUL_TREAT);
    try {
      globalThis._concordRealtimeEmit?.("disease:cured", {
        userId: patientId, diseaseId, byOther: true, healerId,
        recovered: !!r.recovered, severityNow: r.severity,
      });
    } catch { /* emit best-effort */ }
    return { ok: true, success: true, severityReduction: reduction, recovered: !!r.recovered };
  }

  // Failed treatment — record negative opinion if patient is an NPC, OR
  // a small reputation hit if patient is a player.
  try {
    db.prepare(`
      INSERT INTO character_opinions (npc_id, target_kind, target_id, score, kind, decay_per_day, last_event_at)
      VALUES (?, 'player', ?, -10, 'failed_treatment', 0.5, unixepoch())
      ON CONFLICT DO NOTHING
    `).run(patientId, healerId);
  } catch { /* table optional or different schema */ }

  return { ok: true, success: false };
}
