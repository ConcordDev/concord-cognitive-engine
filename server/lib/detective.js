// server/lib/detective.js
//
// Phase CA5 — detective deduction board.
//
// Players play detective on the existing `crime_events` ledger. Each
// crime has evidence_items pointing to a culprit (links_to_id). The
// Obra-Dinn-style lock-in: pick three correct facts (suspectId,
// weapon = crime_type proxy, motive = derived) and the case resolves.
//
// Idempotent on (user, crime). Doesn't require the player to BE the
// detective NPC — anyone can submit a deduction; matching three locks
// in solves the crime via crime-engine.

import crypto from "node:crypto";
import logger from "../logger.js";
import { spawnInvestigationNode } from "./discovery-nodes.js";

export function listOpenCrimes(db, worldId, limit = 50) {
  if (!db || !worldId) return [];
  try {
    return db.prepare(`
      SELECT id, crime_type, location_type, location_id, victim_id,
             confidence, occurred_at
      FROM crime_events
      WHERE world_id = ? AND status = 'open'
      ORDER BY occurred_at DESC LIMIT ?
    `).all(worldId, Math.max(1, Math.min(200, limit)));
  } catch { return []; }
}

export function listEvidenceForCrime(db, crimeId) {
  if (!db || !crimeId) return [];
  try {
    return db.prepare(`
      SELECT id, evidence_type, description, links_to_id, links_to_type,
             confidence_boost, collected_at, decay_at
      FROM evidence_items
      WHERE crime_event_id = ?
      ORDER BY collected_at ASC
    `).all(crimeId);
  } catch { return []; }
}

export function lockInDeduction(db, userId, crimeId, opts = {}) {
  if (!db || !userId || !crimeId) return { ok: false, error: "missing_inputs" };
  const { suspectId, weapon, motive } = opts;
  if (!suspectId) return { ok: false, error: "missing_suspect" };

  try {
    const crime = db.prepare(`
      SELECT id, world_id, crime_type, criminal_id, status, location_id FROM crime_events WHERE id = ?
    `).get(crimeId);
    if (!crime) return { ok: false, error: "no_crime" };
    if (crime.status !== "open") return { ok: false, error: "case_closed" };

    // Score the deduction. Suspect-match is the hard constraint; weapon
    // (~ crime_type) and motive boost confidence.
    let correctCount = 0;
    const reasons = [];

    // For "real" criminal — sometimes set (when crime was committed by a
    // known entity), sometimes null (cold case). When null, the player
    // is the first to nominate a suspect; we don't auto-solve in that
    // path.
    if (crime.criminal_id && suspectId === crime.criminal_id) {
      correctCount++;
      reasons.push("suspect_match");
    }
    if (weapon && weapon === crime.crime_type) {
      correctCount++;
      reasons.push("weapon_match");
    }
    if (motive && String(motive).length > 0) {
      // Motive is freeform; the lock-in is whether the player offered
      // one (the journal-style detective game tradition).
      correctCount++;
      reasons.push("motive_offered");
    }

    const deductionId = `ded_${crypto.randomBytes(6).toString("hex")}`;
    // Persist the deduction attempt for the leaderboard / audit trail.
    try {
      db.prepare(`
        INSERT INTO trial_records
          (id, world_id, crime_event_id, detective_id, suspect_id, suspect_type,
           charges, evidence_summary, verdict, sentence_type, sentence_data,
           processed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
      `).run(
        deductionId, crime.world_id, crimeId, userId,
        suspectId, "unknown",
        JSON.stringify([weapon, motive].filter(Boolean)),
        JSON.stringify(reasons),
        correctCount >= 2 ? "guilty" : "pending",
        "deduction",
        JSON.stringify({ correctCount }),
      );
    } catch (err) {
      logger.debug?.("detective", "trial_record_insert_failed", { error: err?.message });
    }

    // 2-of-3 correct + matching suspect → resolve the case.
    const solved = correctCount >= 2 && reasons.includes("suspect_match");
    if (solved) {
      db.prepare(`
        UPDATE crime_events SET status = 'solved', resolved_at = unixepoch()
        WHERE id = ?
      `).run(crimeId);
    }

    // G4 — solving the case turns the lead into a material: a rare node at the
    // crime scene (idempotent; best-effort; CONCORD_INVESTIGATION_LOOT=0 to disable).
    let discovery = null;
    if (solved) {
      try {
        const sv = spawnInvestigationNode(db, { worldId: crime.world_id, crimeId, locationId: crime.location_id });
        if (sv.ok) discovery = { nodeId: sv.nodeId };
      } catch { /* discovery loot best-effort */ }
    }

    return {
      ok: true,
      deductionId,
      correctCount,
      reasons,
      solved,
      discovery,
    };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

/**
 * Fetch a single open/closed crime by id (the public-safe columns the
 * board shows) together with its collected evidence. Returns null when
 * the crime doesn't exist. Never throws. Note: `criminal_id` (the answer)
 * is deliberately NOT selected — the board must not leak the culprit.
 */
export function getCrimeWithEvidence(db, crimeId) {
  if (!db || !crimeId) return null;
  try {
    const crime = db.prepare(`
      SELECT id, world_id, crime_type, location_type, location_id, victim_id,
             status, confidence, occurred_at, resolved_at
      FROM crime_events WHERE id = ?
    `).get(crimeId);
    if (!crime) return null;
    return { crime, evidence: listEvidenceForCrime(db, crimeId) };
  } catch { return null; }
}

export function getDeductionsByUser(db, userId, limit = 20) {
  if (!db || !userId) return [];
  try {
    return db.prepare(`
      SELECT id, crime_event_id AS crime_id, suspect_id, verdict, sentence_data, processed_at
      FROM trial_records
      WHERE detective_id = ?
      ORDER BY processed_at DESC LIMIT ?
    `).all(userId, Math.max(1, Math.min(200, limit)));
  } catch { return []; }
}
