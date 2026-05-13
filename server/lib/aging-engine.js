// server/lib/aging-engine.js
//
// Concordia Phase 12 — aging + natural death.
//
// Per-archetype expected lifespan in Concordia years (1 year = 42
// days, matching the seasons.js calendar):
//
//   scholar:  60..80
//   warrior:  40..60
//   mystic:   70..90
//   trader:   55..75
//   healer:   55..75
//   guard:    45..65
//   hunter:   50..70
//   default:  50..70
//
// `setBirth(npcId, archetype, currentConcordiaDay)` seeds an aging row
// with deterministic expected_death_concordia_day from sha1(npc_id).
// `advanceAging(db, currentConcordiaDay)` finds NPCs whose
// expected_death_concordia_day ≤ currentDay and isn't already dead,
// and fires onNpcDeath. Returns counts.

import crypto from "node:crypto";
import logger from "../logger.js";

const ARCHETYPE_LIFESPAN_YEARS = Object.freeze({
  scholar: [60, 80],
  warrior: [40, 60],
  mystic:  [70, 90],
  trader:  [55, 75],
  healer:  [55, 75],
  guard:   [45, 65],
  hunter:  [50, 70],
});
const DEFAULT_LIFESPAN_YEARS = [50, 70];
const DAYS_PER_YEAR = 42;

function lifespanFor(archetype) {
  return ARCHETYPE_LIFESPAN_YEARS[archetype] || DEFAULT_LIFESPAN_YEARS;
}

function deterministicLifespanDays(npcId, archetype) {
  const [min, max] = lifespanFor(archetype);
  const span = max - min;
  const h = crypto.createHash("sha1").update(npcId).digest();
  const r = h[0] / 256;
  const years = min + r * span;
  return Math.floor(years * DAYS_PER_YEAR);
}

export function setBirth(db, npcId, archetype, currentConcordiaDay) {
  if (!db || !npcId) return { ok: false, reason: "missing_inputs" };
  const birthDay = Math.floor(currentConcordiaDay || 0);
  const lifespan = deterministicLifespanDays(npcId, archetype);
  // Deterministic offset by sha1 so the death day is spread evenly.
  const offsetDays = 0; // born today; could randomise birth historically
  const deathDay = birthDay + lifespan + offsetDays;
  try {
    db.prepare(`
      INSERT INTO npc_ages (npc_id, birth_concordia_day, expected_death_concordia_day, archetype)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(npc_id) DO UPDATE
        SET birth_concordia_day = excluded.birth_concordia_day,
            expected_death_concordia_day = excluded.expected_death_concordia_day,
            archetype = excluded.archetype
    `).run(npcId, birthDay, deathDay, archetype || null);
    return { ok: true, npcId, birthDay, expected_death_day: deathDay };
  } catch (err) {
    try { logger.warn?.("aging_setBirth_failed", { npcId, error: err?.message }); } catch { /* noop */ }
    return { ok: false, reason: "insert_failed" };
  }
}

export function getAge(db, npcId, currentConcordiaDay) {
  if (!db || !npcId) return null;
  try {
    const row = db.prepare(`
      SELECT npc_id, birth_concordia_day, expected_death_concordia_day, archetype
      FROM npc_ages WHERE npc_id = ?
    `).get(npcId);
    if (!row) return null;
    const ageDays = Math.max(0, Math.floor(currentConcordiaDay || 0) - row.birth_concordia_day);
    const ageYears = ageDays / DAYS_PER_YEAR;
    return { ...row, ageDays, ageYears };
  } catch { return null; }
}

/**
 * Advance the aging cycle. Returns counts of NPCs that crossed their
 * expected death day this pass. Caller (heartbeat) is responsible
 * for invoking onNpcDeath via npc-legacy.js — we just emit the list
 * here so this module stays unit-testable in isolation.
 */
export function advanceAging(db, currentConcordiaDay) {
  if (!db) return { ok: false, reason: "no_db" };
  const day = Math.floor(currentConcordiaDay || 0);
  try {
    const rows = db.prepare(`
      SELECT a.npc_id, a.expected_death_concordia_day
      FROM npc_ages a
      LEFT JOIN world_npcs w ON w.id = a.npc_id
      WHERE a.expected_death_concordia_day <= ?
        AND COALESCE(w.is_dead, 0) = 0
    `).all(day);
    return { ok: true, dueForDeath: rows.map((r) => ({ npcId: r.npc_id, expected_death: r.expected_death_concordia_day })) };
  } catch {
    // world_npcs may be missing on minimal builds.
    try {
      const rows = db.prepare(`
        SELECT npc_id, expected_death_concordia_day
        FROM npc_ages WHERE expected_death_concordia_day <= ?
      `).all(day);
      return { ok: true, dueForDeath: rows.map((r) => ({ npcId: r.npc_id, expected_death: r.expected_death_concordia_day })) };
    } catch { return { ok: false, reason: "query_failed" }; }
  }
}

export const AGING_CONSTANTS = Object.freeze({
  ARCHETYPE_LIFESPAN_YEARS,
  DEFAULT_LIFESPAN_YEARS,
  DAYS_PER_YEAR,
});
