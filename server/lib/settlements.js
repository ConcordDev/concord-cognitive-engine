// server/lib/settlements.js
//
// Living Society — Phase 1.5: settlement composition + role vacancy.
//
// A settlement needs a full occupation taxonomy to operate. This module knows
// the required roles, maps archetypes ↔ roles ↔ buildings, detects coverage
// gaps, and makes every role LOAD-BEARING: a killed critical role opens a
// vacancy that a recruit-cycle fills or, unfilled, accrues resentment + a
// grievance against the killer (Phase 4/5 fuel).

import crypto from "node:crypto";
import { recordAuthorityGrievance } from "./npc-asymmetry.js";

// The taxonomy a settlement needs to function. role → { min, ideal, building }.
export const SETTLEMENT_COMPOSITION = Object.freeze({
  farmer:     { min: 1, ideal: 3, building: "farm" },
  blacksmith: { min: 1, ideal: 1, building: "forge" },
  miller:     { min: 0, ideal: 1, building: "mill" },
  healer:     { min: 1, ideal: 1, building: "clinic" },
  merchant:   { min: 1, ideal: 2, building: "market" },
  guard:      { min: 1, ideal: 3, building: "tower" },
  builder:    { min: 1, ideal: 2, building: "construction" },
  innkeeper:  { min: 0, ideal: 1, building: "inn" },
  miner:      { min: 0, ideal: 2, building: "mine" },
  logger:     { min: 0, ideal: 2, building: "wilds" },
});

// Archetype → settlement role. Civilians (Phase 1) map 1:1; martial/other map
// onto the role they fill.
const ARCHETYPE_ROLE = {
  farmer: "farmer", builder: "builder", miner: "miner", logger: "logger",
  miller: "miller", fisher: "farmer", cook: "innkeeper", laborer: "builder",
  warrior: "guard", guard: "guard", trader: "merchant", healer: "healer",
  scholar: "blacksmith", mystic: "healer", hunter: "logger",
};

export function roleForArchetype(archetype) {
  return ARCHETYPE_ROLE[String(archetype || "").toLowerCase()] || "laborer";
}

export function createSettlement(db, { worldId, name, centerX = 0, centerZ = 0, radius = 200, factionId = null, realmId = null } = {}) {
  if (!db || !worldId || !name) return { ok: false, reason: "missing_inputs" };
  const id = `stl_${crypto.randomUUID()}`;
  try {
    db.prepare(`INSERT INTO settlements (id, world_id, name, center_x, center_z, radius_m, faction_id, realm_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, worldId, name, centerX, centerZ, radius, factionId, realmId);
    return { ok: true, id };
  } catch (e) { return { ok: false, reason: "insert_failed", error: e?.message }; }
}

/** Count NPCs per role currently staffing a settlement. */
export function roleCounts(db, settlementId) {
  const counts = {};
  try {
    const rows = db.prepare(`SELECT settlement_role AS role, COUNT(*) AS n FROM world_npcs WHERE settlement_id = ? AND COALESCE(is_dead,0)=0 AND settlement_role IS NOT NULL GROUP BY settlement_role`).all(settlementId);
    for (const r of rows) counts[r.role] = r.n;
  } catch { /* column absent */ }
  return counts;
}

/**
 * Coverage report: which required roles are below `min` (gaps) — itself a
 * symptom the Chronicle/ruler reads.
 * @returns { ok, covered, gaps:[{role, have, min}], understaffed:[{role, have, ideal}] }
 */
export function checkCoverage(db, settlementId) {
  const counts = roleCounts(db, settlementId);
  const gaps = [], understaffed = [];
  for (const [role, spec] of Object.entries(SETTLEMENT_COMPOSITION)) {
    const have = counts[role] || 0;
    if (have < spec.min) gaps.push({ role, have, min: spec.min });
    else if (have < spec.ideal) understaffed.push({ role, have, ideal: spec.ideal });
  }
  return { ok: true, covered: gaps.length === 0, gaps, understaffed, counts };
}

/**
 * Open a vacancy for a role in a settlement (e.g. its holder was killed). If a
 * killer is named, record a standing grievance the settlement (its other
 * members) holds — but at minimum stamp the killer on the vacancy so the
 * recruit-cycle can escalate resentment if it goes unfilled.
 */
export function openVacancy(db, { settlementId, worldId, role, buildingId = null, killerId = null, killerKind = null } = {}) {
  if (!db || !settlementId || !worldId || !role) return { ok: false, reason: "missing_inputs" };
  const id = `vac_${crypto.randomUUID()}`;
  try {
    db.prepare(`
      INSERT INTO settlement_vacancies (id, settlement_id, world_id, role, building_id, killer_id, killer_kind)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, settlementId, worldId, role, buildingId, killerId, killerKind);
  } catch (e) { return { ok: false, reason: "insert_failed", error: e?.message }; }
  return { ok: true, id, role };
}

/** Fill a vacancy by relocating/assigning an NPC into the role. */
export function fillVacancy(db, vacancyId, npcId) {
  try {
    const vac = db.prepare(`SELECT settlement_id, role FROM settlement_vacancies WHERE id = ? AND filled_at IS NULL`).get(vacancyId);
    if (!vac) return { ok: false, reason: "not_open" };
    db.prepare(`UPDATE settlement_vacancies SET filled_at = unixepoch(), filled_by = ? WHERE id = ?`).run(npcId, vacancyId);
    try { db.prepare(`UPDATE world_npcs SET settlement_id = ?, settlement_role = ? WHERE id = ?`).run(vac.settlement_id, vac.role, npcId); } catch { /* optional */ }
    return { ok: true, filledBy: npcId, role: vac.role };
  } catch (e) { return { ok: false, reason: "fill_failed", error: e?.message }; }
}

/**
 * Try to fill an open vacancy from a same-role candidate already in the world
 * (not already settled). Returns filled or unfilled (with escalated resentment
 * + a grievance against the killer when one is named).
 */
export function recruitForVacancy(db, vacancy) {
  // Candidate: a living NPC in the world with the same archetype-role, not in a settlement.
  let cand = null;
  try {
    const roleArchetypes = Object.entries(ARCHETYPE_ROLE).filter(([, r]) => r === vacancy.role).map(([a]) => a);
    if (roleArchetypes.length) {
      const ph = roleArchetypes.map(() => "?").join(",");
      cand = db.prepare(`
        SELECT id FROM world_npcs
        WHERE world_id = ? AND COALESCE(is_dead,0)=0 AND settlement_id IS NULL AND archetype IN (${ph})
        LIMIT 1
      `).get(vacancy.world_id, ...roleArchetypes);
    }
  } catch { cand = null; }

  if (cand) {
    const r = fillVacancy(db, vacancy.id, cand.id);
    if (r.ok) return { ok: true, filled: true, by: cand.id };
  }

  // Unfilled → escalate resentment + grievance vs the killer.
  try { db.prepare(`UPDATE settlement_vacancies SET resentment = resentment + 1 WHERE id = ?`).run(vacancy.id); } catch { /* noop */ }
  if (vacancy.killer_id) {
    // The settlement's other members hold it against the killer. Pick a witness.
    let witness = null;
    try { witness = db.prepare(`SELECT id FROM world_npcs WHERE settlement_id = ? AND COALESCE(is_dead,0)=0 LIMIT 1`).get(vacancy.settlement_id); } catch { witness = null; }
    if (witness) {
      recordAuthorityGrievance(db, witness.id, {
        targetKind: vacancy.killer_kind === "player" ? "player" : "npc",
        targetId: vacancy.killer_id,
        eventKind: "kin_killed_by_enforcer",
        narrative: `they took our ${vacancy.role} and left the work undone.`,
      });
    }
  }
  return { ok: true, filled: false, resentmentBumped: true };
}

export function listOpenVacancies(db, worldId) {
  try { return db.prepare(`SELECT * FROM settlement_vacancies WHERE world_id = ? AND filled_at IS NULL`).all(worldId); }
  catch { return []; }
}

/**
 * Hook for onNpcDeath: if the deceased held a settlement role, open a vacancy.
 */
export function handleNpcDeathVacancy(db, npc, { killerId = null, killerKind = null } = {}) {
  if (!db || !npc?.id) return { ok: false, reason: "no_npc" };
  let row = null;
  try { row = db.prepare(`SELECT settlement_id, settlement_role, world_id FROM world_npcs WHERE id = ?`).get(npc.id); } catch { row = null; }
  if (!row?.settlement_id || !row.settlement_role) return { ok: false, reason: "no_role" };
  return openVacancy(db, {
    settlementId: row.settlement_id, worldId: row.world_id || npc.world_id,
    role: row.settlement_role, killerId, killerKind,
  });
}

export const SETTLEMENT_ROLES = Object.freeze(Object.keys(SETTLEMENT_COMPOSITION));
